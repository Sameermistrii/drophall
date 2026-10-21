/**
 * Lighting shared by every surface in the lab.
 *
 * Grass and ground must agree exactly on sun, sky, shadow and fog, otherwise
 * the blades look pasted onto the terrain instead of growing out of it — which
 * is the single most common tell in browser grass demos. So all of it lives
 * here and both materials include the same text and share the same uniform
 * objects.
 */

export const GLSL_LIGHT_UNIFORMS = /* glsl */ `
uniform vec3  uSunDir;          // points toward the sun
uniform vec3  uSunColor;
uniform vec3  uSkyColor;
uniform vec3  uGroundBounce;
uniform float uAmbient;

uniform vec3  uFogColor;
uniform vec3  uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;

uniform float uCloudShadow;
uniform float uCloudScale;
uniform vec2  uCloudDir;

uniform sampler2D uShadowMap0;
uniform sampler2D uShadowMap1;
uniform mat4  uShadowMat0;
uniform mat4  uShadowMat1;
uniform vec4  uShadowData0;     // x texelUV, y texelMetres, z penumbraScale, w depthBias
uniform vec4  uShadowData1;
uniform vec4  uShadowCtl;       // x enabled, y intensity, z softness, w normalBias
uniform float uShadowSplit;
uniform float uShadowMaxPenumbra;
`;

export const GLSL_BRDF = /* glsl */ `
float d_ggx(float ndh, float a){
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

// Anisotropic GGX. A grass blade's waxy cuticle stretches its highlight along
// the leaf; without this, backlit grass reads as plastic.
float d_ggx_aniso(vec3 h, vec3 t, vec3 b, vec3 n, float ax, float ay){
  float ht = dot(h, t) / max(ax, 1e-4);
  float hb = dot(h, b) / max(ay, 1e-4);
  float hn = dot(h, n);
  float d = ht * ht + hb * hb + hn * hn;
  return 1.0 / max(PI * ax * ay * d * d, 1e-7);
}

float v_smith(float ndv, float ndl, float a){
  float k = a * 0.5;
  return 0.25 / max((ndv * (1.0 - k) + k) * (ndl * (1.0 - k) + k), 1e-6);
}

vec3 f_schlick(vec3 f0, float u){
  return f0 + (1.0 - f0) * pow5(1.0 - u);
}
`;

export const GLSL_SHADOW = /* glsl */ `
#ifndef PCSS_SEARCH
#define PCSS_SEARCH 8
#endif
#ifndef PCSS_TAPS
#define PCSS_TAPS 16
#endif

// Vogel / sunflower disk. Evenly covers the disk at any tap count, which is
// what a square PCF grid cannot do — a 3x3 grid is why undersampled shadows
// come out looking like blocky patches rather than soft edges.
vec2 vogelDisk(int i, int count, float ang){
  float fi = float(i) + 0.5;
  float r = sqrt(fi / float(count));
  float a = fi * 2.39996323 + ang;   // golden angle
  return vec2(cos(a), sin(a)) * r;
}

/**
 * One cascade of percentage-closer soft shadows.
 * Returns -1 when the fragment falls outside this cascade.
 *
 * Two things here are specific to a *sun* rather than a lamp, and both matter:
 *
 *  - Penumbra width comes from the sun's angular diameter times the
 *    caster-to-receiver distance. The textbook PCSS ratio
 *    (separation / distanceToLight) is for point lights; for a directional
 *    light "distance to light" is meaningless, and using it makes the divisor
 *    the absolute depth inside the map — a number set by how much world the
 *    cascade covers rather than by any geometry. On a wide map that pins every
 *    shadow to the maximum blur and small objects lose their shadow entirely.
 *
 *  - The sample rotation is anchored in light space, not screen space. A point
 *    on the ground then keeps the same rotation as the camera moves, so the
 *    pattern does not crawl across the surface. The interleaved-gradient hash
 *    varies continuously *within* a texel too: one angle per texel would make
 *    every fragment in a texel agree, and the sampling error would stack on top
 *    of the map's own quantisation into visible square stair-steps.
 */
float pcssCascade(sampler2D map, mat4 lightMat, vec4 data, vec3 world, vec3 N, float ndl){
  // Normal-offset bias. Depth bias alone cannot fix self-occlusion on geometry
  // finer than a shadow texel, and a grass blade always is: the texel holds
  // some neighbouring blade's depth, so the comparison fails at random and the
  // result is black speckle. Stepping the receiver off its own surface by
  // roughly a texel of world space is the actual cure.
  //
  // The scale is sin(theta), not tan(theta). Both peak where the light grazes
  // the surface, but tan runs to infinity there, and an offset that large slides
  // the whole shadow sideways — which is exactly the gap you see between an
  // object and its shadow under a low sun. sin saturates at one texel-ish and
  // moves the sample across the map without moving it along the light ray.
  float sinT = sqrt(max(1.0 - ndl * ndl, 0.0));
  vec3 wp = world + N * data.y * uShadowCtl.w * (0.4 + sinT);

  vec4 sc = lightMat * vec4(wp, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x < 0.003 || p.x > 0.997 || p.y < 0.003 || p.y > 0.997 || p.z > 1.0 || p.z < 0.0) return -1.0;

  // Depth bias is in normalised map units, so it is worth remembering what it
  // buys in metres: data.w is authored as a couple of centimetres of the
  // cascade's depth range. A "harmless-looking" 0.01 here is 60 cm on a 60 m
  // range, and under a 12-degree sun 60 cm of depth is nearly 3 m of lateral
  // slide. Slope scaling is capped for the same reason.
  float slopeScale = min(sinT / max(abs(ndl), 0.15), 2.5);
  float receiver = p.z - data.w * (1.0 + slopeScale);
  float texel = data.x;

  vec2 lightPixel = p.xy / texel;
  float ang = TAU * fract(52.9829189 *
    fract(dot(lightPixel, vec2(0.06711056, 0.00583715))));

  // Search radius is the widest penumbra we allow. Narrower and the blocker
  // that should be softening this edge is never found; wider and we average in
  // blockers that never shaded this fragment at all.
  float searchR = max(2.0, uShadowMaxPenumbra);
  float blockerSum = 0.0;
  float blockers = 0.0;
  for (int i = 0; i < PCSS_SEARCH; i++){
    float z = textureLod(map, p.xy + vogelDisk(i, PCSS_SEARCH, ang) * texel * searchR, 0.0).r;
    if (z < receiver){ blockerSum += z; blockers += 1.0; }
  }
  if (blockers < 0.5) return 1.0;

  float separation = max(receiver - blockerSum / blockers, 0.0);
  // The lower clamp is not just a divide guard: below one texel every sample
  // lands in the same one or two texels, the average has only a few levels, and
  // the edge locks to the map's grid. Two texels spreads the disk over 4x4 and
  // gives dozens of levels — a few centimetres in world units, so contact stays
  // tight.
  float penumbra = clamp(separation * data.z * uShadowCtl.z, 2.0, uShadowMaxPenumbra);

  float lit = 0.0;
  for (int i = 0; i < PCSS_TAPS; i++){
    float z = textureLod(map, p.xy + vogelDisk(i, PCSS_TAPS, ang + 0.73) * texel * penumbra, 0.0).r;
    lit += step(receiver, z);
  }
  return lit / float(PCSS_TAPS);
}

float sampleShadow(vec3 world, vec3 N, float ndl, vec3 camPos){
  if (uShadowCtl.x < 0.5) return 1.0;
  float d = distance(world, camPos);

  float s = -1.0;
  if (d < uShadowSplit * 1.35) s = pcssCascade(uShadowMap0, uShadowMat0, uShadowData0, world, N, ndl);

  if (s < 0.0 || d > uShadowSplit){
    float far = pcssCascade(uShadowMap1, uShadowMat1, uShadowData1, world, N, ndl);
    if (far < 0.0) far = 1.0;
    s = s < 0.0 ? far : mix(s, far, sat((d - uShadowSplit) / max(uShadowSplit * 0.35, 0.01)));
  }

  return mix(1.0, s, uShadowCtl.y);
}

// Drifting cloud cover. Nearly free, and it does more for the sense of an
// outdoor space than any amount of extra geometry.
float cloudShadow(vec3 world, float time){
  if (uCloudShadow <= 0.001) return 1.0;
  float c = noiseTapUV((world.xz + uCloudDir * time * 3.0) / uCloudScale).b;
  return 1.0 - sat((c - 0.44) * 2.6) * uCloudShadow;
}
`;

// three's dithering chunk depends on <common>, which would collide with our own
// PI / pow2 / saturate definitions. One line of our own is cheaper than pulling
// that whole chunk in.
export const GLSL_DITHER = /* glsl */ `
vec3 dither8(vec3 c, vec2 fragXY){
  return c + (hash21(floor(fragXY)) - 0.5) * (1.0 / 255.0);
}
`;

export const GLSL_FOG = /* glsl */ `
// Exponential height fog with the vertical term integrated analytically, plus
// forward Mie scattering so haze brightens toward the sun.
//
// Split into "how much" and "what colour" on purpose: the amount costs no
// texture fetches, so a surface can ask for it first and skip its entire
// shading path when the answer is "all of it". On a ground plane that runs to
// the horizon, that is most of the pixels on screen.
float fogFactor(vec3 world, vec3 camPos){
  float dist = length(world - camPos);
  float h = world.y - camPos.y;
  float t = uFogDensity * dist * exp(-uFogHeightFalloff * max(camPos.y, 0.0));
  float hf = uFogHeightFalloff * h;
  if (abs(hf) > 1e-4) t *= (1.0 - exp(-hf)) / hf;
  return sat(1.0 - exp(-max(t, 0.0)));
}

vec3 fogColour(vec3 viewDir){
  float mie = pow(sat(dot(viewDir, uSunDir)), 7.0);
  return mix(uFogColor, uFogSunColor, mie * 0.9);
}

vec3 applyFog(vec3 col, vec3 world, vec3 camPos, vec3 viewDir){
  return mix(col, fogColour(viewDir), fogFactor(world, camPos));
}
`;

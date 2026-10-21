/**
 * Terrain.
 *
 * Two jobs, and the second one matters more than it sounds:
 *
 *  1. Be the ground the blades stand on — same field texture, same height, so
 *     nothing floats.
 *  2. Look like grass from above. Beyond ~40 m the blade geometry only supplies
 *     silhouette and breakup; the actual coverage comes from here. If the
 *     ground under a thinning sward reads as bare soil, the whole field goes
 *     bald in the middle distance — the classic failure of browser grass.
 *
 * The mesh is an exponential polar grid locked to the camera: fine spacing
 * underfoot (~2 cm), coarse at the horizon (~60 m), constant vertex count, and
 * no streaming.
 */

import { GLSL_MATH, GLSL_HASH, GLSL_NOISE_RT } from './lib.js';
import { GLSL_FIELD } from './field.js';
import { GLSL_LIGHT_UNIFORMS, GLSL_BRDF, GLSL_SHADOW, GLSL_FOG } from './lighting.js';
import { GLSL_MOTION_VERT, GLSL_MOTION_FRAG } from './taa.js';

export const TERRAIN_VERT = /* glsl */ `
precision highp float;
precision highp int;

${GLSL_MATH}
${GLSL_HASH}
${GLSL_NOISE_RT}
${GLSL_FIELD}

uniform vec2 uCenter;      // camera XZ; the mesh itself never leaves the origin
uniform float uGroundY;

${GLSL_MOTION_VERT}

varying vec3 vWorld;
varying vec3 vNormal;
varying float vSoil;
varying float vSlope;

void main(){
  vec2 xz = position.xz + uCenter;
  Ground g = sampleGround(xz);

  vWorld  = vec3(xz.x, g.h + uGroundY, xz.y);
  vNormal = g.n;
  vSoil   = g.soil;
  vSlope  = g.slope;

  // The ground is static in world space, so the surface point a pixel lands
  // on has not moved; all of the velocity here comes from the camera.
  writeMotion(vWorld, vWorld);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
precision highp int;

${GLSL_MATH}
${GLSL_HASH}
${GLSL_NOISE_RT}
${GLSL_LIGHT_UNIFORMS}
${GLSL_BRDF}
${GLSL_SHADOW}
${GLSL_FOG}
${GLSL_MOTION_FRAG}

uniform sampler2D uGroundA;   // rgb soil albedo, a litter/moss cover
uniform sampler2D uGroundB;   // rg normal, b roughness, a AO
uniform vec3  uCamPos;
uniform float uTime;

uniform vec3  uSwardColor;    // average colour of the species mix
uniform vec3  uSwardDeep;     // colour down inside the canopy
uniform float uSwardCover;    // 0..1 how completely grass hides the soil
uniform float uGroundTile;    // metres per soil texture repeat
uniform float uDetailRatio;   // second tile scale, as a fraction of the first
uniform float uDetailBlend;   // how much of the second scale is allowed in
uniform float uTileWarp;      // metres of macro UV displacement
uniform float uDetailFade;
uniform float uNormalStrength;
// x: metres where the canopy paint starts, y: where it is complete, z: strength
uniform vec3  uSwardFar;
uniform int   uDebug;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vSoil;
varying float vSlope;

/* ------------------------------------------------------------ anti-tiling --

   Two defences, cheap, attacking different halves of the problem.

   1. Two tile scales, cross-faded by a macro mask. The blend's own period is
      the macro noise's — tens of metres — so the underlying 1.4 m grid never
      gets a chance to establish itself. Both scales are always sampled: a
      texture fetch inside a branch that differs between neighbouring pixels
      leaves the UV derivatives undefined, and the band of wrong-mip pixels you
      get along that boundary is a worse artefact than the repetition it was
      meant to hide.

   2. A UV warp taken only from the longest wavelength available. What matters
      is not how far the coordinate moves but how fast the displacement
      changes: the gradient of the offset is texture stretch, one for one.
      Warping by a metre-scale field paints marble swirls; warping by a 90 m
      field with a one-metre amplitude is invisible and still breaks the grid.
*/
float gTileMix;

vec4 tileSample(sampler2D tex, vec2 uv){
  vec4 fine = texture2D(tex, uv);
  vec4 coarse = texture2D(tex, uv * uDetailRatio + vec2(0.37, 0.71));
  return mix(fine, coarse, gTileMix);
}

void main(){
  // Keep the stone path, the steps and the building footprint clear.
  if (abs(vWorld.x) < 16.5 && vWorld.z < 6.9) discard;
  if (abs(vWorld.x) < 2.45 && vWorld.z < 40.0) discard;

  vec2 p = vWorld.xz;
  float dist = length(vWorld - uCamPos);
  float detail = 1.0 - sat(dist / max(uDetailFade * 2.0, 1.0));

  // The ground disc runs to 1.6 km, and from eye level most of the screen's
  // lower half is ground that fog has already swallowed whole. Asking the fog
  // first costs no texture fetches and lets those pixels skip the twenty that
  // the full surface would have cost. The branch is screen-coherent — entire
  // bands of the frame take the same side — so it is nearly free on the GPU.
  vec3 viewDirEarly = normalize(vWorld - uCamPos);
  float fogAmt = fogFactor(vWorld, uCamPos);
  if (uDebug == 0 && fogAmt > 0.995){
    gl_FragColor = vec4(fogColour(viewDirEarly), 1.0);
    writeVelocity();
    return;
  }

  vec2 warp = (noiseTapUV(p / 90.0).rg - 0.5) * uTileWarp;
  vec2 uv0 = (p + warp) / uGroundTile;
  gTileMix = uDetailBlend * smootherstep(0.40, 0.60, noiseTapUV(rot2(p, 1.27) / 23.0).r);

  vec4 A0 = tileSample(uGroundA, uv0);
  vec4 B0 = tileSample(uGroundB, uv0);
  float macro = noiseTapUV(rot2(p, 0.9) / 9.0).r;
  vec3 soilAlbedo = A0.rgb * mix(0.72, 1.32, macro);
  float soilRough = B0.b;
  float soilAO = B0.a;

  // ---------------------------------------------------------------- sward --
  // How much ground one pixel covers, in metres. Procedurally evaluated detail
  // has no mip chain, so it has to be faded out by hand as soon as a pixel is
  // wide enough to straddle a feature. Skip this and the fine detail turns into
  // radial moire across the middle distance — which looks like a mesh bug and
  // is actually just undersampled noise.
  float px = max(length(dFdx(p)), length(dFdy(p)));
  float grainFade = sat(1.0 - px / 0.028);
  float tuftFade = sat(1.0 - px / 0.22);

  // Fading a term to zero still pays for its texture fetch, so the fades are
  // branches rather than multiplies. Every tap below is an explicit-LOD
  // textureLod, which is what makes it legal to skip them per-pixel: an
  // implicit-LOD fetch inside divergent control flow has undefined derivatives.
  float patchy = noiseTapUV(rot2(p, -0.7) / 13.0).b;
  float mottle = 0.5;
  if (tuftFade > 0.002){
    float tuft  = noiseTapUV(p / 0.22).a;
    float tuft2 = noiseTapUV(rot2(p, 2.3) / 0.9).r;
    mottle = mix(0.5, sat(tuft * 0.5 + tuft2 * 0.5), tuftFade);
  }

  float cover = sat(vSoil * uSwardCover * mix(0.8, 1.2, patchy));
  cover *= 1.0 - sat((vSlope - 0.45) * 2.0);

  // Keep the swing gentle: this stands in for grass seen from above, and a
  // canopy varies in tone, not from black to bright.
  // Sward grain: blade-scale streaks, ~3 cm across and ~40 cm long, laid down
  // along a slowly turning direction field. This is the detail that makes the
  // ground read as a mat of grass rather than as green paint — without it the
  // gaps between the real blades look like a pond.
  float grainAng = 0.0;
  vec2 guv = vec2(0.0);
  float grainMix = 0.5;
  if (grainFade > 0.002){
    grainAng = noiseTapUV(p / 3.5).b * TAU;
    vec2 gp = rot2(p, grainAng);
    guv = vec2(gp.x / 0.032, gp.y / 0.42);
    float grain = noiseTapUV(guv).r;
    float grain2 = noiseTapUV(guv * 2.7 + 11.3).b;
    grainMix = mix(0.5, sat(grain * 0.72 + grain2 * 0.38 - 0.05), grainFade);
  }

  // Distance canopy.
  //
  // Two things go missing as the ground recedes and both of them make it
  // brighter. The blade geometry stops contributing — measured top-down, it
  // darkens the ground by 16 luma underfoot and by 1.5 at eighteen metres — and
  // the normal-map and tuft relief above are faded out to stop them aliasing,
  // which brightens the surface because N.L is clamped at zero and so the mean
  // response to a perturbed normal is always below the flat one.
  //
  // Both are the same shape: detail disappears with distance, so the mean has
  // to be pulled back down by hand. Without this the field brightens steadily
  // outwards and the eye reads the result as a bald ring that follows you.
  // Two ramps, because the two losses happen over different distances and one
  // smootherstep cannot serve both. The blades are gone by about fourteen
  // metres; the ground's own relief keeps washing out for tens of metres past
  // that, because the terrain mesh is a camera-locked polar grid whose spacing
  // grows with radius and the surface normal is a vertex varying. Fitting a
  // single ramp to the far term leaves the near one barely engaged exactly
  // where the blades disappear — which is the ring you can still see.
  float far = uSwardFar.z * (
      0.75 * smootherstep(uSwardFar.x, uSwardFar.y, dist)
    + 0.25 * smootherstep(uSwardFar.y, uSwardFar.y * 5.0, dist));

  vec3 sward = mix(uSwardDeep, uSwardColor, sat(0.35 + mottle * 0.8 - far * 0.5));
  sward *= mix(0.70, 1.26, grainMix);
  // Gaps between tufts sit in the canopy's own shadow.
  float swardAO = mix(0.66, 1.0, mottle) * mix(0.78, 1.05, grainMix) * mix(1.0, 0.72, far);

  vec3 albedo = mix(soilAlbedo, sward, cover);
  float rough = mix(soilRough, 0.78, cover);
  float ao = mix(soilAO, swardAO, cover);

  // ---------------------------------------------------------------- normal --
  vec3 N = normalize(vNormal);
  vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)) + vec3(1e-5));
  vec3 Bt = normalize(cross(N, T));
  // Where the sward is thick, the soil's own relief is buried under it — let
  // almost none of the crack pattern through, or the ground reads as cracked
  // mud wearing a green coat.
  vec2 nxy = (B0.rg * 2.0 - 1.0) * uNormalStrength * detail * (1.0 - cover * 0.92);
  // Tufts push the surface normal around too, which is what makes a distant
  // sward catch raking light in patches instead of shading like a flat plane.
  // Six more taps, and they only matter where the sward is both thick and close
  // enough to resolve. Behind the same gates as the colour detail above.
  if (tuftFade > 0.002 && cover > 0.01){
    float e = 0.05;
    vec2 tg = vec2(
      noiseTapUV((p + vec2(e, 0.0)) / 0.9).r - noiseTapUV((p - vec2(e, 0.0)) / 0.9).r,
      noiseTapUV((p + vec2(0.0, e)) / 0.9).r - noiseTapUV((p - vec2(0.0, e)) / 0.9).r
    );
    nxy += tg * 0.9 * cover * tuftFade;
  }

  // Grain relief, in the grain's own frame, rotated back into world axes. Two
  // taps: the streaks only need a cross-grain slope to catch the light.
  if (grainFade > 0.002 && cover > 0.01){
    float ge = 0.011;
    float gs = noiseTapUV(guv + vec2(ge / 0.032, 0.0)).r - noiseTapUV(guv - vec2(ge / 0.032, 0.0)).r;
    nxy += rot2(vec2(gs, 0.0), -grainAng) * 1.6 * cover * grainFade;
  }
  N = normalize(N + T * nxy.x + Bt * nxy.y);

  // -------------------------------------------------------------- lighting --
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float ndv = sat(dot(N, V)) + 1e-4;

  float shadow = sampleShadow(vWorld, N, ndl, uCamPos) * cloudShadow(vWorld, uTime);

  vec3 dNx = dFdx(N), dNy = dFdy(N);
  rough = sqrt(clamp(rough * rough + (dot(dNx, dNx) + dot(dNy, dNy)) * 0.5, 0.0, 1.0));

  // Grass in the canopy scatters, soil does not — so wrap the diffuse in
  // proportion to how vegetated this spot is.
  float wrap = mix(0.05, 0.3, cover);
  float diff = sat((ndl + wrap) / (1.0 + wrap));

  vec3 direct = uSunColor * diff * shadow;
  vec3 ambient = mix(uGroundBounce, uSkyColor, N.y * 0.5 + 0.5) * uAmbient * ao;

  vec3 H = normalize(L + V);
  float a = rough * rough;
  vec3 F = f_schlick(vec3(0.028), sat(dot(V, H)));
  vec3 spec = uSunColor * d_ggx(sat(dot(N, H)), a) * v_smith(ndv, sat(ndl), a) * F * sat(ndl) * shadow;

  vec3 color = albedo * (direct + ambient) + spec;

  if (uDebug == 1) color = N * 0.5 + 0.5;
  else if (uDebug == 2) color = vec3(rough);
  else if (uDebug == 3) color = vec3(ao);
  else if (uDebug == 4) color = albedo;
  else if (uDebug == 5) color = vec3(cover);
  else if (uDebug == 6) color = vec3(0.15);
  else if (uDebug == 7) color = vec3(shadow);

  if (uDebug == 0) color = mix(color, fogColour(-V), fogAmt);

  gl_FragColor = vec4(color, 1.0);
  writeVelocity();
}
`;

/* ================================================================= sky == */

export const SKY_VERT = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uCamPosPrev;
varying vec3 vDir;

${GLSL_MOTION_VERT}

void main(){
  // Drawn last and depth-tested, at a radius beyond the terrain disc, so the
  // dome only shades the pixels the ground did not already cover. Drawing it
  // first without a depth test meant paying a full-screen sky shader and then
  // painting over most of it.
  vDir = position;
  // The sky sits at infinity, so only the camera's rotation moves it: the
  // previous position is the same direction taken from where the camera was.
  writeMotion(position * 2500.0 + uCamPos, position * 2500.0 + uCamPosPrev);
  gl_Position = projectionMatrix * viewMatrix * vec4(position * 2500.0 + uCamPos, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
precision highp int;

${GLSL_MATH}
${GLSL_HASH}
${GLSL_NOISE_RT}
${GLSL_MOTION_FRAG}

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyZenith;
uniform vec3  uSkyHorizon;
uniform vec3  uFogColor;
uniform float uTime;
uniform float uCloudScale;
uniform vec2  uCloudDir;
uniform float uCloudCover;

varying vec3 vDir;

void main(){
  vec3 d = normalize(vDir);
  float up = sat(d.y);

  // Rayleigh-ish vertical gradient: the horizon is brighter and less saturated
  // because you are looking through far more atmosphere.
  float grad = pow(1.0 - up, 3.2);
  vec3 sky = mix(uSkyZenith, uSkyHorizon, grad);

  // Aerial band just above the ground line, matched to the fog colour so the
  // terrain never cuts a hard edge against the sky.
  sky = mix(sky, uFogColor, pow(1.0 - up, 14.0) * 0.85);

  float mu = dot(d, normalize(uSunDir));

  // Mie glow around the sun, then the disc itself.
  sky += uSunColor * pow(sat(mu), 8.0) * 0.16;
  sky += uSunColor * pow(sat(mu), 900.0) * 4.0;
  float disc = smootherstep(0.99965, 0.99992, mu);
  sky += uSunColor * disc * 26.0;

  // A thin, drifting cloud sheet projected onto the dome. Cheap, and it gives
  // the sky the parallax cue that a plain gradient never has.
  if (uCloudCover > 0.001 && d.y > 0.005){
    vec2 cp = d.xz / max(d.y, 0.005) * 90.0 + uCloudDir * uTime * 3.0;
    float c = noiseTapUV(cp / uCloudScale).b;
    float c2 = noiseTapUV(rot2(cp, 1.1) / (uCloudScale * 0.37)).r;
    float f = sat((c * 0.7 + c2 * 0.3 - (1.0 - uCloudCover) * 0.62) * 3.4);
    f *= sat(d.y * 4.0);
    vec3 lit = mix(uFogColor * 1.05, uSunColor * 0.55 + uSkyHorizon * 0.6, sat(mu * 0.5 + 0.5));
    sky = mix(sky, lit, f * 0.85);
  }

  // Below the horizon the dome shows the haze colour so a low camera never
  // sees a hole under the terrain.
  sky = mix(sky, uFogColor, sat(-d.y * 6.0));

  gl_FragColor = vec4(sky, 1.0);
  writeVelocity();
}
`;

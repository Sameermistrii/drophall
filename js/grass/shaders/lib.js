/**
 * Shared GLSL building blocks.
 *
 * three.js (r169) always emits `#version 300 es` for ShaderMaterial, so integer
 * ops, `gl_InstanceID` and `textureLod` are available even though we keep using
 * the classic `attribute` / `varying` / `gl_FragColor` spelling that three
 * aliases for us.
 *
 * Naming note: three injects `tonemapping_pars_fragment` (which #defines
 * `saturate`) and `getLuminanceFunction()` (`luminance`) into every fragment
 * shader that has tone mapping enabled. We therefore never use those two names
 * and go with `sat` / `luma` instead.
 */

/* ------------------------------------------------------------------ math -- */

export const GLSL_MATH = /* glsl */ `
#ifndef GLAB_MATH
#define GLAB_MATH

#define TAU 6.2831853071795864
#define PI  3.1415926535897932

float sat(float x){ return clamp(x, 0.0, 1.0); }
vec2  sat(vec2  x){ return clamp(x, 0.0, 1.0); }
vec3  sat(vec3  x){ return clamp(x, 0.0, 1.0); }
vec4  sat(vec4  x){ return clamp(x, 0.0, 1.0); }

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float remap(float v, float a, float b, float c, float d){
  return c + (d - c) * sat((v - a) / max(b - a, 1e-6));
}

float smootherstep(float e0, float e1, float x){
  float t = sat((x - e0) / max(e1 - e0, 1e-6));
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Smooth, C1-continuous replacement for pow() that stays cheap for small n.
float pow2(float x){ return x * x; }
float pow3(float x){ return x * x * x; }
float pow4(float x){ float y = x * x; return y * y; }
float pow5(float x){ float y = x * x; return y * y * x; }

vec2 rot2(vec2 p, float a){
  float s = sin(a), c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Rodrigues rotation. \`axis\` must be normalised.
vec3 rotAxis(vec3 v, vec3 axis, float a){
  float s = sin(a), c = cos(a);
  return v * c + cross(axis, v) * s + axis * (dot(axis, v) * (1.0 - c));
}

// Builds an orthonormal frame around n without a branch.
void frameFromNormal(vec3 n, out vec3 t, out vec3 b){
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float c = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
  b = vec3(c, s + n.y * n.y * a, -n.y);
}

vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), sat(p - 1.0), c.y);
}

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

// Perceptual-ish hue/sat/value nudge used for per-blade colour variation.
vec3 tweakHSV(vec3 rgb, float dh, float ds, float dv){
  vec3 h = rgb2hsv(rgb);
  h.x = fract(h.x + dh);
  h.y = sat(h.y * (1.0 + ds));
  h.z = max(h.z * (1.0 + dv), 0.0);
  return hsv2rgb(h);
}

#endif
`;

/* ------------------------------------------------------------------ hash -- */

export const GLSL_HASH = /* glsl */ `
#ifndef GLAB_HASH
#define GLAB_HASH

// Jarzynski & Olano, "Hash Functions for GPU Rendering". Cheap, high quality,
// and — crucially — stable across drivers because it is pure integer maths.
uint pcg(uint v){
  uint state = v * 747796405u + 2891336453u;
  uint word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uvec2 pcg2d(uvec2 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= (v >> 16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= (v >> 16u);
  return v;
}

uvec3 pcg3d(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= (v >> 16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

uvec4 pcg4d(uvec4 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= (v >> 16u);
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}

const float U2F = 1.0 / 4294967296.0;
float toF(uint  u){ return float(u) * U2F; }
vec2  toF(uvec2 u){ return vec2(u)  * U2F; }
vec3  toF(uvec3 u){ return vec3(u)  * U2F; }
vec4  toF(uvec4 u){ return vec4(u)  * U2F; }

// Reinterpret signed cell coordinates as unsigned (two's complement is
// well-defined in GLSL) so negative world cells hash just as well.
uvec2 asU(ivec2 v){ return uvec2(v); }
uvec3 asU(ivec3 v){ return uvec3(v); }

float hash11(float p){ return toF(pcg(floatBitsToUint(p))); }
float hash21(vec2 p){  return toF(pcg2d(floatBitsToUint(p)).x); }
vec2  hash22(vec2 p){  return toF(pcg2d(floatBitsToUint(p))); }
vec3  hash23(vec2 p){  return toF(pcg3d(uvec3(floatBitsToUint(p), 0x9e3779b9u))); }

// 1D value noise with a smootherstep ramp — used for blade-edge serration where
// a texture fetch would be overkill.
float vnoise1(float x){
  float i = floor(x), f = x - i;
  float a = toF(pcg(uint(int(i))));
  float b = toF(pcg(uint(int(i) + 1)));
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(a, b, f);
}

float fbm1(float x, int oct){
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < oct; i++){
    s += a * vnoise1(x * f);
    f *= 2.0;
    a *= 0.5;
  }
  return s;
}

#endif
`;

/* --------------------------------------------------- analytic noise (bake) -- */
/*  Only used by the one-off baking passes, so it can afford to be pretty.     */

export const GLSL_NOISE_BAKE = /* glsl */ `
#ifndef GLAB_NOISE_BAKE
#define GLAB_NOISE_BAKE

// Tileable gradient noise. \`per\` is the integer repeat period, which lets the
// baked results wrap seamlessly in both axes.
vec2 gradAt(ivec2 c, ivec2 per, uint seed){
  c = ivec2(mod(vec2(c), vec2(per)));
  float a = toF(pcg3d(uvec3(asU(c), seed)).x) * TAU;
  return vec2(cos(a), sin(a));
}

float pnoise2(vec2 p, ivec2 per, uint seed){
  vec2 pi = floor(p), pf = p - pi;
  ivec2 i = ivec2(pi);
  vec2 u = pf * pf * pf * (pf * (pf * 6.0 - 15.0) + 10.0);
  float a = dot(gradAt(i + ivec2(0, 0), per, seed), pf - vec2(0.0, 0.0));
  float b = dot(gradAt(i + ivec2(1, 0), per, seed), pf - vec2(1.0, 0.0));
  float c = dot(gradAt(i + ivec2(0, 1), per, seed), pf - vec2(0.0, 1.0));
  float d = dot(gradAt(i + ivec2(1, 1), per, seed), pf - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

float pfbm2(vec2 p, ivec2 per, int oct, float gain, float lac, uint seed){
  float s = 0.0, a = 0.5, norm = 0.0;
  vec2 q = p;
  ivec2 pr = per;
  for (int i = 0; i < oct; i++){
    s += a * pnoise2(q, pr, seed + uint(i) * 131u);
    norm += a;
    q *= lac;
    pr = ivec2(vec2(pr) * lac);
    a *= gain;
  }
  return s / max(norm, 1e-5);
}

// Ridged multifractal — the sharp creases read as gust fronts and as the
// crumpled micro-relief on a dry leaf.
float pridge2(vec2 p, ivec2 per, int oct, uint seed){
  float s = 0.0, a = 0.5, norm = 0.0, prev = 1.0;
  vec2 q = p;
  ivec2 pr = per;
  for (int i = 0; i < oct; i++){
    float n = 1.0 - abs(pnoise2(q, pr, seed + uint(i) * 977u));
    n *= n;
    s += a * n * prev;
    prev = n;
    norm += a;
    q *= 2.0;
    pr *= 2;
    a *= 0.5;
  }
  return s / max(norm, 1e-5);
}

// Tileable Worley. Returns (F1, F2, cellRandom).
vec3 pworley2(vec2 p, ivec2 per, uint seed){
  vec2 pi = floor(p), pf = p - pi;
  ivec2 i = ivec2(pi);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      ivec2 c = i + ivec2(x, y);
      ivec2 cw = ivec2(mod(vec2(c), vec2(per)));
      vec3 r = toF(pcg3d(uvec3(asU(cw), seed)));
      vec2 pt = vec2(x, y) + r.xy - pf;
      float d = dot(pt, pt);
      if (d < f1){ f2 = f1; f1 = d; id = r.z; }
      else if (d < f2){ f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

#endif
`;

/* --------------------------------------------- runtime noise (texture LUT) -- */
/*  The render loop reads noise from a small baked atlas instead of evaluating  */
/*  it analytically — one bilinear fetch beats twenty ALU ops in a shader that  */
/*  runs a few million times per frame.                                         */

export const GLSL_NOISE_RT = /* glsl */ `
#ifndef GLAB_NOISE_RT
#define GLAB_NOISE_RT

// uNoiseTex layout (all channels tile seamlessly over uNoiseWorldSize metres):
//   R = fbm            0..1   general purpose / terrain octaves
//   G = ridged         0..1   gust fronts, erosion creases
//   B = warped fbm     0..1   decorrelated second field
//   A = worley F2-F1   0..1   patchiness, clump masks
uniform sampler2D uNoiseTex;
uniform float uNoiseWorldSize;

vec4 noiseTap(vec2 worldXZ, float scale){
  return textureLod(uNoiseTex, worldXZ * (scale / uNoiseWorldSize), 0.0);
}

vec4 noiseTapUV(vec2 uv){
  return textureLod(uNoiseTex, uv, 0.0);
}

#endif
`;

/* ------------------------------------------------------- shared preamble -- */

export const GLSL_COMMON = GLSL_MATH + GLSL_HASH;

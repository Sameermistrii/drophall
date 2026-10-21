/**
 * Temporal antialiasing.
 *
 * Grass is the hard case for AA: a blade is a couple of millimetres across, so
 * past a few metres it is thinner than a pixel and MSAA has nothing to average.
 * What you get instead is per-frame coverage flicker — the "sparkle" that makes
 * a still frame look fine and a moving one look cheap. Accumulating over frames
 * is the only thing that actually fixes it.
 *
 * The usual objection to TAA on foliage is that wind-driven geometry has no
 * motion vectors, so history gets rejected and the grass smears. That does not
 * apply here: wind is a pure function of time and every blade is generated in
 * the vertex shader, so the same vertex can be evaluated at `uTime` and at
 * `uTimePrev` in one invocation. The motion vectors are exact, wind included.
 */

/**
 * Motion vectors, vertex side.
 *
 * Both clip positions are computed with the *unjittered* projection. Feeding
 * the sub-pixel jitter into the velocity would make the resolve chase its own
 * offset: history would be fetched from wherever this frame happened to be
 * nudged, and the accumulation would never settle.
 */
export const GLSL_MOTION_VERT = /* glsl */ `
uniform mat4 uViewProjNow;    // unjittered, this frame
uniform mat4 uViewProjPrev;   // unjittered, last frame

varying vec4 vClipNow;
varying vec4 vClipPrev;

void writeMotion(vec3 worldNow, vec3 worldPrev){
  vClipNow  = uViewProjNow  * vec4(worldNow,  1.0);
  vClipPrev = uViewProjPrev * vec4(worldPrev, 1.0);
}
`;

/**
 * Motion vectors, fragment side. Written to the second colour attachment, so
 * geometry is rasterised once for both shading and velocity.
 */
export const GLSL_MOTION_FRAG = /* glsl */ `
layout(location = 1) out vec4 outVelocity;

varying vec4 vClipNow;
varying vec4 vClipPrev;

void writeVelocity(){
  vec2 a = vClipNow.xy  / max(vClipNow.w,  1e-6);
  vec2 b = vClipPrev.xy / max(vClipPrev.w, 1e-6);
  outVelocity = vec4((a - b) * 0.5, 0.0, 1.0);   // NDC delta -> UV delta
}
`;

export const FS_QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HELPERS = /* glsl */ `
float sat(float x){ return clamp(x, 0.0, 1.0); }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Work in YCoCg. Chroma and luma have very different tolerances, and a
// neighbourhood box in RGB clamps all three by the same amount — which either
// leaves luma flicker in or crushes colour detail out.
vec3 rgb2ycocg(vec3 c){
  return vec3( 0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
               0.5  * c.r            - 0.5  * c.b,
              -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 ycocg2rgb(vec3 c){
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// Reversible tone map for the blend itself. Averaging in linear HDR lets a
// single bright sub-pixel highlight dominate nine frames of history, which is
// how TAA turns specular glints on wet-looking blades into crawling fireflies.
vec3 tmap(vec3 c){ return c / (1.0 + lum(c)); }
vec3 untmap(vec3 c){ return c / max(1.0 - lum(c), 1e-4); }

// Clip the history toward the neighbourhood centre instead of clamping it.
// Clamping snaps to the nearest box face and shifts hue; clipping keeps the
// direction of the colour and only shortens it.
vec3 clipAABB(vec3 lo, vec3 hi, vec3 q){
  vec3 centre = 0.5 * (hi + lo);
  vec3 extent = 0.5 * (hi - lo) + 1e-7;
  vec3 v = q - centre;
  vec3 unit = abs(v / extent);
  float m = max(unit.x, max(unit.y, unit.z));
  return m > 1.0 ? centre + v / m : q;
}

// Bicubic (Catmull-Rom) history fetch in nine taps. Bilinear reprojection
// blurs a little every frame, and over a long history that compounds into
// permanent softness — the single most common reason TAA gets called "smeary".
vec4 catmullRom(sampler2D tex, vec2 uv, vec2 size){
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / size;
  vec2 t3 = (c + 2.0) / size;
  vec2 t12 = (c + w2 / w12) / size;

  vec4 r = vec4(0.0);
  r += textureLod(tex, vec2(t0.x,  t0.y),  0.0) * (w0.x  * w0.y);
  r += textureLod(tex, vec2(t12.x, t0.y),  0.0) * (w12.x * w0.y);
  r += textureLod(tex, vec2(t3.x,  t0.y),  0.0) * (w3.x  * w0.y);
  r += textureLod(tex, vec2(t0.x,  t12.y), 0.0) * (w0.x  * w12.y);
  r += textureLod(tex, vec2(t12.x, t12.y), 0.0) * (w12.x * w12.y);
  r += textureLod(tex, vec2(t3.x,  t12.y), 0.0) * (w3.x  * w12.y);
  r += textureLod(tex, vec2(t0.x,  t3.y),  0.0) * (w0.x  * w3.y);
  r += textureLod(tex, vec2(t12.x, t3.y),  0.0) * (w12.x * w3.y);
  r += textureLod(tex, vec2(t3.x,  t3.y),  0.0) * (w3.x  * w3.y);
  return max(r, vec4(0.0));
}
`;

export const TAA_RESOLVE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uScene;      // linear HDR, jittered
uniform sampler2D uVelocity;   // RG: this pixel's UV movement since last frame
uniform sampler2D uHistory;    // resolved output of the previous frame
uniform vec2  uTexSize;
uniform float uFeedback;       // history weight at rest, 0..1
uniform float uVarianceGamma;  // neighbourhood tolerance, in std deviations
uniform float uReset;          // 1 on the first frame after a resize or rebuild

${HELPERS}

void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 cur = texelFetch(uScene, px, 0).rgb;

  if (uReset > 0.5){
    gl_FragColor = vec4(cur, 1.0);
    return;
  }

  // Neighbourhood statistics of the current frame, in tone-mapped YCoCg.
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec3 s = rgb2ycocg(tmap(texelFetch(uScene, px + ivec2(x, y), 0).rgb));
      m1 += s;
      m2 += s * s;
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  vec3 lo = mean - uVarianceGamma * sigma;
  vec3 hi = mean + uVarianceGamma * sigma;

  vec2 vel = texelFetch(uVelocity, px, 0).rg;
  vec2 hUv = vUv - vel;

  // Off-screen history is genuinely absent, not merely stale: this is the
  // disocclusion band you see crawling along the edge of frame in temporal
  // renderers that fade it in instead of dropping it.
  if (hUv.x < 0.0 || hUv.x > 1.0 || hUv.y < 0.0 || hUv.y > 1.0){
    gl_FragColor = vec4(cur, 1.0);
    return;
  }

  vec3 hist = catmullRom(uHistory, hUv, uTexSize).rgb;
  vec3 rawY  = rgb2ycocg(tmap(hist));
  vec3 histY = clipAABB(lo, hi, rawY);
  vec3 curY  = rgb2ycocg(tmap(cur));

  // How far the history had to be pulled tells us how wrong it was. Trust it
  // less in proportion, which is what keeps ghosting off fast-moving blade tips
  // without softening the still parts of the frame.
  float rejected = length(histY - rawY);
  float speed = length(vel * uTexSize);
  float feedback = uFeedback;
  feedback *= 1.0 - sat(rejected * 3.0);
  feedback *= 1.0 - sat((speed - 2.0) / 24.0) * 0.35;

  vec3 outY = mix(curY, histY, sat(feedback));
  gl_FragColor = vec4(untmap(ycocg2rgb(outY)), 1.0);
}
`;

export const TAA_OUTPUT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTex;
uniform vec2  uTexSize;
uniform float uSharpen;

${HELPERS}

void main(){
  vec3 c = textureLod(uTex, vUv, 0.0).rgb;

  // A small unsharp mask against the residual softness of any reprojection
  // filter. Deliberately tiny — oversharpening a grass field turns every blade
  // edge into a bright rim and looks worse than the softness it fixed.
  if (uSharpen > 0.001){
    vec2 t = 1.0 / uTexSize;
    vec3 blur =
      textureLod(uTex, vUv + vec2( t.x, 0.0), 0.0).rgb +
      textureLod(uTex, vUv + vec2(-t.x, 0.0), 0.0).rgb +
      textureLod(uTex, vUv + vec2(0.0,  t.y), 0.0).rgb +
      textureLod(uTex, vUv + vec2(0.0, -t.y), 0.0).rgb;
    c = max(c + (c * 4.0 - blur) * (uSharpen * 0.25), vec3(0.0));
  }

  gl_FragColor = vec4(c, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Dither after encoding: banding lives in the 8-bit output, not in the HDR
  // buffer we have been accumulating.
  gl_FragColor.rgb += (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}
`;

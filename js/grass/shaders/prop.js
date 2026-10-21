/**
 * Material for solid props (the interaction ball).
 *
 * It exists for two reasons. First, once the scene renders into a
 * multi-attachment target, *every* material drawn into it has to write every
 * attachment — a stock MeshStandardMaterial writes only colour, and the draw
 * call fails with "active draw buffers with missing fragment shader outputs".
 * Second, it lets the prop read the same sun, sky, shadow and fog uniforms as
 * the grass, so it sits in the scene instead of being lit by a parallel set of
 * three.js lights that have to be kept in sync by hand.
 */

import { GLSL_MATH, GLSL_HASH, GLSL_NOISE_RT } from './lib.js';
import { GLSL_LIGHT_UNIFORMS, GLSL_BRDF, GLSL_SHADOW, GLSL_FOG } from './lighting.js';
import { GLSL_MOTION_VERT, GLSL_MOTION_FRAG } from './taa.js';

export const PROP_VERT = /* glsl */ `
precision highp float;

uniform vec3  uObjPos;
uniform vec3  uObjPosPrev;
uniform float uObjScale;

varying vec3 vWorld;
varying vec3 vNormal;

${GLSL_MOTION_VERT}

void main(){
  vec3 w = position * uObjScale + uObjPos;
  vWorld  = w;
  vNormal = normalize(normal);

  // The prop only translates, so its previous position is the same local point
  // taken from where the object was last frame.
  writeMotion(w, position * uObjScale + uObjPosPrev);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const PROP_FRAG = /* glsl */ `
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

uniform vec3  uCamPos;
uniform float uTime;
uniform vec3  uPropColor;
uniform float uPropRough;
uniform int   uDebug;

varying vec3 vWorld;
varying vec3 vNormal;

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);

  float ndl = dot(N, L);
  float ndv = sat(dot(N, V)) + 1e-4;
  float shadow = sampleShadow(vWorld, N, ndl, uCamPos) * cloudShadow(vWorld, uTime);

  vec3 direct  = uSunColor * sat(ndl) * shadow;
  vec3 ambient = mix(uGroundBounce, uSkyColor, N.y * 0.5 + 0.5) * uAmbient;

  vec3 H = normalize(L + V);
  float a = uPropRough * uPropRough;
  vec3 F = f_schlick(vec3(0.04), sat(dot(V, H)));
  vec3 spec = uSunColor * d_ggx(sat(dot(N, H)), a) * v_smith(ndv, sat(ndl), a) * F * sat(ndl) * shadow;

  vec3 color = uPropColor * (direct + ambient) + spec;

  if (uDebug == 1) color = N * 0.5 + 0.5;
  else if (uDebug == 2) color = vec3(uPropRough);
  else if (uDebug == 7) color = vec3(shadow);
  if (uDebug == 0) color = applyFog(color, vWorld, uCamPos, -V);

  gl_FragColor = vec4(color, 1.0);
  writeVelocity();
}
`;

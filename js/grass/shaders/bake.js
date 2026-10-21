/**
 * One-off baking passes. Everything the renderer samples at runtime is
 * generated here from shader code — there is not a single image file in this
 * project.
 *
 *   bakeNoiseAtlas  → tiling multi-channel noise LUT used by the render loop
 *   bakeField       → terrain height + analytic gradient + soil mask
 *   bakeBladeA/B    → the blade's PBR set (albedo, translucency, normal,
 *                     roughness, AO), authored from leaf anatomy rather than
 *                     from abstract patterns
 *   bakeGroundA/B   → soil / thatch PBR for the terrain underneath
 */

import { GLSL_MATH, GLSL_HASH, GLSL_NOISE_BAKE } from './lib.js';

const PRE = GLSL_MATH + GLSL_HASH + GLSL_NOISE_BAKE;

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* =========================================================== noise atlas == */

export const NOISE_ATLAS_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeed;
${PRE}

void main(){
  uint seed = uint(uSeed);
  ivec2 per = ivec2(8);
  vec2 p = vUv * 8.0;

  // R — general purpose fbm
  float f = pfbm2(p, per, 6, 0.5, 2.0, seed) * 0.5 + 0.5;

  // G — ridged: sharp creases, used for gust fronts and erosion
  float r = pridge2(p * 0.75, ivec2(6), 5, seed + 7717u);

  // B — domain-warped fbm, decorrelated from R so two lookups never rhyme
  vec2 w = vec2(
    pfbm2(p * 0.5 + vec2(3.1, 1.7), ivec2(4), 3, 0.5, 2.0, seed + 331u),
    pfbm2(p * 0.5 + vec2(8.3, 5.9), ivec2(4), 3, 0.5, 2.0, seed + 733u)
  );
  float b = pfbm2(p + w * 1.6, per, 5, 0.55, 2.0, seed + 1091u) * 0.5 + 0.5;

  // A — worley ridges: cell-ish patchiness for clumping masks
  vec3 wo = pworley2(p * 1.5, ivec2(12), seed + 421u);
  float a = sat((wo.y - wo.x) * 1.35);

  gl_FragColor = vec4(sat(f), sat(r), sat(b), a);
}
`;

/* ================================================================= field == */

export const FIELD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uSeed;
uniform float uTileMetres;
uniform float uRelief;      // overall vertical scale multiplier
uniform float uPathWidth;   // metres; 0 disables the trail
${PRE}

// Tileable 1D helper built on the 2D noise so the trail wraps with the tile.
float wig(float t, float per, uint seed){
  return pnoise2(vec2(t, 0.5), ivec2(int(per), 2), seed);
}

// All in tile-normalised space (0..1 covers uTileMetres).
float heightAt(vec2 q, out float pathMask){
  uint seed = uint(uSeed);

  // Macro relief: broad rolling ground, ~1 feature per tile.
  float macro = pfbm2(q * 1.0, ivec2(1), 3, 0.5, 2.0, seed) * 9.0;

  // A shallow basin so the camera has somewhere to look down into.
  float basin = pnoise2(q * 2.0 + vec2(0.31, 0.77), ivec2(2), seed + 51u) * 3.4;

  // Mid undulations — the scale you actually walk over.
  float mid = pfbm2(q * 6.0, ivec2(6), 4, 0.5, 2.0, seed + 211u) * 1.35;

  // Erosion creases: ridged noise subtracted so gullies bite in rather than
  // bulge out. This is what stops the terrain reading as "blobby fbm".
  float ero = (1.0 - pridge2(q * 9.0, ivec2(9), 4, seed + 313u)) * -0.85;

  // Tussock-scale bumpiness, the reason a real meadow is never smooth.
  float bump = pfbm2(q * 34.0, ivec2(34), 3, 0.5, 2.0, seed + 617u) * 0.22;
  float tuss = (pworley2(q * 26.0, ivec2(26), seed + 887u).x - 0.45) * 0.18;

  float h = (macro + basin + mid + ero + bump + tuss) * uRelief;

  // Meandering trail. Distance to a wandering line in x, worn ~12 cm deep.
  float cx = 0.5 + wig(q.y * 3.0, 3.0, seed + 1231u) * 0.28
                 + wig(q.y * 7.0, 7.0, seed + 1553u) * 0.09;
  float dx = abs(fract(q.x - cx + 0.5) - 0.5) * uTileMetres;
  float halfW = max(uPathWidth, 1e-4) * (0.75 + 0.5 * (wig(q.y * 11.0, 11.0, seed + 97u) * 0.5 + 0.5));
  pathMask = 1.0 - sat((dx - halfW * 0.45) / max(halfW * 0.75, 1e-4));
  pathMask *= step(0.001, uPathWidth);
  h -= pathMask * pathMask * 0.13;

  return h;
}

void main(){
  float eps = 1.0 / 512.0;               // in tile-normalised units
  float epsM = eps * uTileMetres;        // …and in metres
  float pm;
  float h  = heightAt(vUv, pm);
  float hx0, hx1, hz0, hz1, t;
  hx0 = heightAt(vUv - vec2(eps, 0.0), t);
  hx1 = heightAt(vUv + vec2(eps, 0.0), t);
  hz0 = heightAt(vUv - vec2(0.0, eps), t);
  hz1 = heightAt(vUv + vec2(0.0, eps), t);

  float dhdx = (hx1 - hx0) / (2.0 * epsM);
  float dhdz = (hz1 - hz0) / (2.0 * epsM);

  // Soil mask: bare on the trail, thin on steep ground and on dry crests,
  // lush in the hollows where water collects.
  float slope = sat(length(vec2(dhdx, dhdz)) * 0.85);
  float wet = sat(0.5 - h * 0.06);
  float patchy = pfbm2(vUv * 13.0, ivec2(13), 4, 0.5, 2.0, uint(uSeed) + 4441u) * 0.5 + 0.5;
  float soil = sat(1.15 - slope * 1.5) * mix(0.55, 1.0, patchy) * mix(0.75, 1.15, wet);
  soil *= 1.0 - sat(pm * 1.35);
  // A few genuinely bald scrapes keep the sward from looking sprayed on.
  soil *= 1.0 - sat((pworley2(vUv * 7.0, ivec2(7), uint(uSeed) + 5501u).x - 0.62) * 5.0);

  gl_FragColor = vec4(h, dhdx, dhdz, sat(soil));
}
`;

/* ============================================================ blade PBR == */

/**
 * Shared anatomy of a grass leaf, evaluated in blade UV space:
 *   u = 0..1 across the width (0.5 is the midrib)
 *   v = 0..1 from sheath to tip
 *
 * The important structural facts we reproduce:
 *  - a single raised midrib that flattens out toward the tip
 *  - parallel longitudinal veins at irregular spacing, primaries and secondaries
 *  - files of elongated epidermal cells, ~10x longer than wide
 *  - stomatal rows tucked between the veins
 *  - a pale, slightly swollen sheath at the base
 *  - accumulated damage: creases, transverse kinks, feeding scars, rust spots
 */
const BLADE_ANATOMY = /* glsl */ `
uniform float uMicroDetail;   // 0..2 amplitude of all micro relief
uniform float uMicroScale;    // 0.5..2 frequency multiplier
uniform float uSeed;
uniform float uAspect;        // blade length / blade width, for correct normals
uniform float uDryness;       // 0 = fresh, 1 = fully cured
uniform float uLayer;         // atlas slot; every slot is a different blade
uniform float uLayerCount;

// Each slot gets its own seed and its own stage of curing, so a field never
// shows the same leaf twice in a row.
uint slotSeed(){ return uint(uSeed) + uint(uLayer) * 7919u + 13u; }
float slotDryness(){
  float j = toF(pcg(uint(uLayer) * 2711u + 91u));
  return sat(uDryness * mix(0.35, 1.85, j));
}

struct Leaf {
  float h;        // relief height, arbitrary units
  float dry;      // 0..1 local senescence
  float damage;   // 0..1 mechanical / biological damage
  float vein;     // 0..1 on a vein crown
  float groove;   // 0..1 in a vein trough
  float sheath;   // 0..1 basal sheath region
  float thin;     // 0..1 how thin the lamina is here (drives translucency)
};

float veinField(float u, float v, uint seed, out float crown, out float id){
  // Irregular spacing: perturb the comb, then read a per-vein rank so some
  // veins come out primary and some barely register.
  float n = float(int(9.0 + toF(pcg(seed)) * 7.0));
  float jitter = pnoise2(vec2(u * 3.0, 0.5), ivec2(3, 2), seed + 11u) * 0.55;
  float vp = u * n + jitter;
  id = floor(vp);
  float f = fract(vp) - 0.5;
  float rank = toF(pcg(uint(int(id) + 977) ^ seed));
  // Primary veins are wider and taller; secondaries fade out toward the tip
  // where the lamina narrows and veins converge.
  float primary = step(0.62, rank);
  float amp = mix(0.35, 1.0, primary) * mix(1.0, 0.45, sat(v * 1.4 - 0.35) * (1.0 - primary));
  float w = mix(0.30, 0.46, primary);
  crown = exp(-(f * f) / (w * w * 0.5));
  return crown * amp;
}

Leaf leafAt(vec2 uv, uint seed){
  Leaf L;
  float u = uv.x, v = uv.y;
  float cu = u - 0.5;                       // signed distance from midrib
  float ms = uMicroScale;

  // --- sheath: the pale, slightly inflated base -------------------------
  L.sheath = 1.0 - smootherstep(0.02, 0.16, v);

  // --- midrib -----------------------------------------------------------
  float midW = mix(0.075, 0.032, sat(v * 1.25));
  float midrib = exp(-(cu * cu) / (midW * midW * 0.5)) * mix(1.0, 0.22, sat(v * 1.15));
  midrib += L.sheath * exp(-(cu * cu) / 0.010) * 0.5;

  // --- longitudinal veins ----------------------------------------------
  float crown, vid;
  float veins = veinField(u, v, seed, crown, vid);

  // --- epidermal cell files: long, thin, brick-like ---------------------
  vec3 cells = pworley2(vec2(u * 26.0, v * 3.1) * ms, ivec2(26, 3), seed + 55u);
  float cellRelief = (cells.y - cells.x);
  // Rows of stomata sit in the grooves between veins.
  float stomRow = sat(1.0 - crown * 1.6);
  vec3 stom = pworley2(vec2(u * 34.0, v * 40.0) * ms, ivec2(34, 40), seed + 71u);
  float stomata = sat(1.0 - stom.x * 5.0) * stomRow;

  // --- faint cross veins (the ladder between primaries) -----------------
  float cross = sat(pnoise2(vec2(u * 4.0, v * 90.0) * ms, ivec2(4, 90), seed + 91u) * 1.4) * 0.35 * (1.0 - crown);

  // --- micro grain, stretched along the blade ---------------------------
  float grain = pfbm2(vec2(u * 7.0, v * 55.0) * ms, ivec2(7, 55), 4, 0.55, 2.0, seed + 131u);

  // --- damage: creases, kinks, feeding scars ----------------------------
  // Longitudinal crease: a blade that has been folded once, permanently.
  float creaseSeed = toF(pcg(seed + 1777u));
  float creasePos = mix(0.2, 0.8, toF(pcg(seed + 1801u)));
  float crease = exp(-pow2((u - creasePos) / 0.045)) * step(0.55, creaseSeed)
               * smootherstep(0.05, 0.35, v);
  // Transverse kink: where the blade got bent over and never recovered.
  float kinkAt = mix(0.35, 0.9, toF(pcg(seed + 1901u)));
  float kink = exp(-pow2((v - kinkAt) / 0.018)) * step(0.62, toF(pcg(seed + 1913u)));
  // Insect feeding / weathering scars: sparse, elongated, edge-biased.
  vec3 scarCell = pworley2(vec2(u * 3.0, v * 9.0), ivec2(3, 9), seed + 2003u);
  float scar = sat(1.0 - scarCell.x * 3.2) * step(0.80, scarCell.z) * (0.35 + 0.65 * abs(cu) * 2.0);

  L.damage = sat(crease * 0.55 + kink * 0.9 + scar);

  // --- assemble relief --------------------------------------------------
  float micro = (cellRelief * 0.45 - stomata * 0.30 + cross + grain * 0.55) * uMicroDetail;
  L.h = midrib * 1.00
      + veins * 0.42
      + micro * 0.22
      - crease * 0.55
      - kink * 0.42
      - scar * 0.30;

  // Lamina thins toward the edges and the tip.
  float edge = sat((abs(cu) - 0.34) / 0.16);
  L.thin = sat(0.35 + edge * 0.55 + v * 0.35 - midrib * 0.55 - veins * 0.2);

  // --- senescence -------------------------------------------------------
  // Grass cures from the tip and the edges inward, in irregular tongues.
  float dryness = slotDryness();
  float tongue = pfbm2(vec2(u * 2.5, v * 3.0), ivec2(3, 3), 4, 0.5, 2.0, seed + 2311u) * 0.5 + 0.5;
  float tipDry = smootherstep(mix(1.15, 0.05, dryness), 1.0, v + tongue * 0.28 - 0.14);
  float edgeDry = edge * mix(0.15, 0.9, dryness);
  L.dry = sat(max(tipDry, edgeDry) + L.damage * 0.45 + (dryness - 0.5) * 0.35);

  L.vein = sat(veins + midrib * 0.8);
  L.groove = sat(1.0 - crown * 1.5) * (1.0 - L.sheath);
  return L;
}
`;

export const BLADE_A_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${PRE}
${BLADE_ANATOMY}

// RGB = albedo *detail* (near-neutral; the species tint multiplies it at
// runtime so one atlas serves every profile). A = translucency.
void main(){
  vec2 uv = vUv;
  uint seed = slotSeed();

  Leaf L = leafAt(uv, seed);

  // --- base detail colour ------------------------------------------------
  // Start neutral, then apply the hue/value shifts that actually exist on a
  // living blade. Values hover around 1.0 so the runtime tint stays in charge.
  vec3 c = vec3(1.0);

  // Vein crowns catch light and carry less chlorophyll: paler, a touch yellow.
  c *= mix(vec3(1.0), vec3(1.10, 1.13, 0.94), L.vein * 0.55);
  // Grooves hold shadow and more pigment.
  c *= mix(vec3(1.0), vec3(0.80, 0.86, 0.78), L.groove * 0.45);

  // Sheath: pale, yellow-green, sometimes purple-flushed at the very base.
  vec3 sheathCol = mix(vec3(1.22, 1.20, 0.88), vec3(1.05, 0.86, 0.95),
                       step(0.66, toF(pcg(seed + 33u))));
  c = mix(c, c * sheathCol, L.sheath * 0.85);

  // Senescence: chlorophyll goes first, carotenoids stay, then everything
  // browns. Two-stage so drying grass passes through straw yellow. Kept
  // deliberately modest — this multiplies the species tint, and a hot straw
  // factor here turns every lit blade white the moment the sun is warm.
  vec3 straw = vec3(1.32, 1.14, 0.60);
  vec3 brown = vec3(0.98, 0.72, 0.46);
  vec3 dryCol = mix(straw, brown, sat(L.dry * 1.4 - 0.45));
  c = mix(c, c * dryCol, sat(L.dry * 1.05));

  // Rust pustules — small, sparse, orange, unmistakably organic.
  vec3 rc = pworley2(uv * vec2(4.0, 13.0), ivec2(4, 13), seed + 3301u);
  float rust = sat(1.0 - rc.x * 6.0) * step(0.90, rc.z);
  c = mix(c, vec3(0.95, 0.55, 0.28), rust * 0.75);

  // Chlorotic streaks: pale lines that follow the venation.
  float chl = sat(pnoise2(vec2(uv.x * 11.0, uv.y * 1.5), ivec2(11, 2), seed + 3607u) * 2.4 - 1.35);
  c = mix(c, c * vec3(1.28, 1.30, 1.02), chl * 0.5);

  // Fine mottling — chloroplast density is never uniform.
  float mot = pfbm2(vec2(uv.x * 5.0, uv.y * 26.0), ivec2(5, 26), 4, 0.5, 2.0, seed + 401u);
  c *= 1.0 + mot * 0.14 * uMicroDetail;

  // Very edge of the blade: thin, so it reads brighter and warmer.
  float rim = sat((abs(uv.x - 0.5) - 0.43) / 0.07);
  c = mix(c, c * vec3(1.18, 1.16, 0.98), rim * 0.7);

  // --- translucency -------------------------------------------------------
  // Thin lamina transmits; midrib, veins and cured tissue do not.
  float trans = L.thin;
  trans *= mix(1.0, 0.35, L.dry);
  trans = sat(trans * 1.15 + rim * 0.25 - L.damage * 0.2);

  gl_FragColor = vec4(c * 0.5, trans);   // /2 so 1.0 sits mid-range in 8-bit
}
`;

export const BLADE_B_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${PRE}
${BLADE_ANATOMY}

// RG = tangent-space normal xy, B = roughness, A = ambient occlusion.
void main(){
  vec2 uv = vUv;
  uint seed = slotSeed();

  Leaf L = leafAt(uv, seed);

  // Height derivatives. The blade is far longer than it is wide, so a step in
  // v covers uAspect times more world distance than the same step in u —
  // without that correction every normal map on a blade looks wrong.
  float e = 1.0 / 512.0;
  float hx1 = leafAt(uv + vec2(e, 0.0), seed).h;
  float hx0 = leafAt(uv - vec2(e, 0.0), seed).h;
  float hy1 = leafAt(uv + vec2(0.0, e), seed).h;
  float hy0 = leafAt(uv - vec2(0.0, e), seed).h;

  float dhdu = (hx1 - hx0) / (2.0 * e);
  float dhdv = (hy1 - hy0) / (2.0 * e) / max(uAspect, 1e-3);

  float strength = 0.055 * uMicroDetail;
  vec3 nrm = normalize(vec3(-dhdu * strength, -dhdv * strength, 1.0));

  // --- roughness ----------------------------------------------------------
  // A fresh blade is coated in epicuticular wax: smooth on the vein crowns
  // where it is thickest, rougher in the grooves, and it degrades as the leaf
  // cures until dead tissue is fully matte.
  float rough = 0.46;
  rough -= L.vein * 0.20;
  rough += L.groove * 0.14;
  rough += L.dry * 0.34;
  rough += L.damage * 0.22;
  rough += (pfbm2(vec2(uv.x * 9.0, uv.y * 44.0), ivec2(9, 44), 3, 0.5, 2.0, seed + 811u) - 0.0) * 0.10 * uMicroDetail;
  rough = clamp(rough, 0.12, 0.95);

  // --- ambient occlusion --------------------------------------------------
  float ao = 1.0;
  ao -= L.groove * 0.18;
  ao -= sat(-L.h) * 0.25;
  ao -= L.damage * 0.30;
  ao -= L.sheath * 0.12;
  ao = clamp(ao, 0.35, 1.0);

  gl_FragColor = vec4(nrm.xy * 0.5 + 0.5, rough, ao);
}
`;

/* =========================================================== ground PBR == */

const GROUND_BODY = /* glsl */ `
uniform float uSeed;
uniform float uMicroDetail;

/**
 * No pebbles.
 *
 * Scattered stones are the single worst thing you can put in a tiling soil
 * texture. Every other feature here is noise, and noise repeating is hard to
 * see; a stone is a distinct object at a fixed spot in the tile, and the eye
 * locks onto it and reads the whole grid at once. The soil is better without
 * them.
 */
struct Soil {
  float h;
  float crumb;    // aggregate structure — this is the base, not cells
  float thatch;   // dead stem litter
  float moss;
  float crack;    // shrinkage fractures, only where the ground is dry and bare
  float shatter;  // 0..1 how fractured this patch is at all
};

/**
 * Shrinkage fracture network.
 *
 * A plain Worley network makes very convincing dry cracked earth and very
 * unconvincing everything else: the cells come out the same size everywhere,
 * the borders are dead straight, and across a whole terrain the eye reads it as
 * paving rather than soil. So it is never the base here. Three corrections keep
 * it useful:
 *
 *   1. the sampling coordinate is domain-warped *before* the Worley lookup, so
 *      borders curve the way real shrinkage fractures do instead of meeting at
 *      straight polygon edges;
 *   2. the whole network is gated behind a low-frequency shatter mask, so most
 *      of the ground stays intact crumb and only some patches have fractured;
 *   3. individual fractures are broken along their length, so you never see a
 *      complete closed cell outline.
 */
float fractureNet(vec2 uv, uint seed, out float shatter){
  shatter = smootherstep(0.46, 0.78,
    pfbm2(uv * 3.0 + 17.0, ivec2(3), 3, 0.5, 2.0, seed + 1201u) * 0.5 + 0.5);
  if (shatter <= 0.001) return 0.0;

  vec2 warp = vec2(
    pfbm2(uv * 19.0, ivec2(19), 3, 0.5, 2.0, seed + 311u),
    pfbm2(uv * 19.0 + 41.0, ivec2(19), 3, 0.5, 2.0, seed + 733u)
  );
  vec3 v = pworley2(uv * 9.0 + warp * 0.55, ivec2(9), seed + 101u);

  float line = sat(1.0 - (v.y - v.x) * 11.0);
  // Break each fracture along its own length: a continuous outline is the tell.
  float breakUp = pfbm2(uv * 26.0, ivec2(26), 3, 0.5, 2.0, seed + 907u) * 0.5 + 0.5;
  line *= smootherstep(0.30, 0.62, breakUp);
  return line * shatter;
}

Soil soilAt(vec2 uv){
  Soil S;
  uint seed = uint(uSeed);

  // --- crumb: soil is aggregated lumps across several scales. This, not a
  //     cell pattern, is what the base has to be built from.
  float c0 = pfbm2(uv * 4.0,  ivec2(4),  4, 0.55, 2.0, seed)        * 0.5 + 0.5;
  float c1 = pfbm2(uv * 13.0, ivec2(13), 4, 0.50, 2.0, seed + 13u)  * 0.5 + 0.5;
  float c2 = pfbm2(uv * 47.0, ivec2(47), 3, 0.50, 2.0, seed + 29u)  * 0.5 + 0.5;
  // A ridged octave gives the clods edges rather than leaving them as blobs.
  float clod = pridge2(uv * 8.0, ivec2(8), 3, seed + 41u);
  S.crumb = sat(c0 * 0.42 + c1 * 0.30 + c2 * 0.16 + clod * 0.20);

  // --- litter: short broken stems, scattered, each with its own direction.
  //     Sampling one long rotated wave instead reads as wood grain.
  vec3 lc = pworley2(uv * 22.0, ivec2(22), seed + 53u);
  float lang = lc.z * TAU;
  vec2 lu = rot2(uv * 22.0 - lc.z, lang);
  float stem = sat(1.0 - abs(fract(lu.y * 1.7) - 0.5) * 7.0);
  S.thatch = stem * step(0.55, lc.z) * sat(1.0 - lc.x * 2.2)
           * (pfbm2(uv * 5.0, ivec2(5), 3, 0.5, 2.0, seed + 67u) * 0.5 + 0.5);

  // --- moss in the damp hollows.
  S.moss = sat((pfbm2(uv * 9.0, ivec2(9), 4, 0.5, 2.0, seed + 83u) * 0.5 + 0.5) * 1.7 - 0.75);

  S.crack = fractureNet(uv, seed, S.shatter) * (1.0 - S.moss);

  S.h = S.crumb * 0.72
      + c2 * 0.16 * uMicroDetail
      + S.thatch * 0.14
      - S.crack * 0.42;
  return S;
}
`;

export const GROUND_A_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${PRE}
${GROUND_BODY}

// Soil palette, ramped by surface height rather than picked per feature.
// Measured on real soil photographs the relation is consistent: raised, sunlit
// crust desaturates toward a pale mineral tone, while recesses both darken and
// gain saturation. Driving colour from height reproduces that automatically and
// keeps albedo and normal talking about the same surface.
vec3 soilPalette(float h){
  const vec3 P0 = vec3(0.028, 0.021, 0.016);   // deep crevice, damp
  const vec3 P1 = vec3(0.055, 0.041, 0.030);   // shaded humus
  const vec3 P2 = vec3(0.093, 0.071, 0.051);   // mid earth
  const vec3 P3 = vec3(0.142, 0.114, 0.083);   // dried crumb
  const vec3 P4 = vec3(0.196, 0.168, 0.134);   // pale mineral crust
  float t = sat(h) * 4.0;
  float i = floor(t);
  float f = smootherstep(0.0, 1.0, t - i);
  if (i < 1.0) return mix(P0, P1, f);
  if (i < 2.0) return mix(P1, P2, f);
  if (i < 3.0) return mix(P2, P3, f);
  return mix(P3, P4, f);
}

void main(){
  Soil S = soilAt(vUv);
  uint seed = uint(uSeed);

  vec3 c = soilPalette(S.h);

  // Inverse value/saturation: crests go pale and chalky, hollows go rich.
  vec3 hsv = rgb2hsv(c);
  hsv.y = sat(hsv.y * mix(1.20, 0.82, sat(S.h)));
  c = hsv2rgb(hsv);

  // Broad damp/dry drift, so the sheet is not one uniform brown.
  float damp = pfbm2(vUv * 3.0, ivec2(3), 4, 0.5, 2.0, seed + 5u) * 0.5 + 0.5;
  c *= mix(0.74, 1.24, damp);

  c = mix(c, vec3(0.205, 0.163, 0.084), S.thatch * 0.55);   // stem litter
  c = mix(c, vec3(0.050, 0.090, 0.035), S.moss * 0.85);     // moss
  c *= 1.0 - S.crack * 0.45;                                // fracture shadow

  // Mineral dust on the fracture rims — the pale halo you always see beside a
  // shrinkage crack, and the thing that stops it reading as a drawn line.
  c = mix(c, vec3(0.170, 0.150, 0.126), sat(S.crack * 2.4 - 1.15) * 0.6);

  // Fine mineral speckle. Deliberately achromatic and low contrast: soil has
  // grain, it does not sparkle.
  float speck = pfbm2(vUv * 190.0, ivec2(190), 2, 0.5, 2.0, seed + 9u) * 0.5 + 0.5;
  c *= mix(0.93, 1.07, speck);

  gl_FragColor = vec4(c, sat(S.thatch * 0.6 + S.moss));
}
`;

export const GROUND_B_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${PRE}
${GROUND_BODY}

void main(){
  float e = 1.0 / 1024.0;
  Soil S = soilAt(vUv);
  float hx = soilAt(vUv + vec2(e, 0.0)).h;
  float hz = soilAt(vUv + vec2(0.0, e)).h;
  vec3 nrm = normalize(vec3(-(hx - S.h) / e * 0.02, -(hz - S.h) / e * 0.02, 1.0));

  // Soil is matte end to end. Nothing here is ever allowed to go glossy —
  // a mineral glint on a tiling ground plane is an instant giveaway.
  float rough = clamp(0.94 - S.moss * 0.08 + S.crack * 0.04, 0.60, 1.0);
  float ao = clamp(1.0 - S.crack * 0.55 - (1.0 - S.crumb) * 0.30 - S.thatch * 0.1, 0.25, 1.0);

  gl_FragColor = vec4(nrm.xy * 0.5 + 0.5, rough, ao);
}
`;

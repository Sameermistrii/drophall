/**
 * The blade shader.
 *
 * A single draw call feeds this with N instances. Nothing about an instance is
 * stored in a buffer: position, species, size, colour, damage and wind phase are
 * all derived in the vertex shader from an integer hash of the *world* cell the
 * blade belongs to. That is what makes the field effectively unbounded — moving
 * the camera changes two integer uniforms and nothing else, so there is no
 * streaming, no re-upload and no CPU cost proportional to world size.
 *
 * Geometry is a flat strip; every bit of shape is computed here:
 *   - a botanical width profile (base -> shoulder -> taper -> tip)
 *   - serrated edges and left/right asymmetry, so no two silhouettes match
 *   - a keeled (V) cross-section that flattens toward the tip
 *   - a cubic-Bezier centreline whose segment lengths sum to 1, so bending
 *     never stretches the blade
 *   - axial twist
 *   - broken / blunted tips on a fraction of blades
 */

import { GLSL_MATH, GLSL_HASH, GLSL_NOISE_RT } from './lib.js';
import { GLSL_FIELD } from './field.js';
import { GLSL_LIGHT_UNIFORMS, GLSL_BRDF, GLSL_SHADOW, GLSL_FOG } from './lighting.js';
import { GLSL_MOTION_VERT, GLSL_MOTION_FRAG } from './taa.js';

export const SPECIES_STRIDE = 12;

const SHARED = /* glsl */ `
${GLSL_MATH}
${GLSL_HASH}
${GLSL_NOISE_RT}
${GLSL_FIELD}

#define SPS ${SPECIES_STRIDE}
uniform vec4 uSp[NUM_SPECIES * SPS];
vec4 sp(int i, int s){ return uSp[i * SPS + s]; }
`;

/* ============================================================== vertex == */

export const BLADE_VERT = /* glsl */ `
precision highp float;
precision highp int;

${SHARED}

// --- ring / placement -------------------------------------------------------
uniform ivec2 uCamCell;        // camera position quantised to this ring's grid
uniform float uCellSize;
uniform int   uGrid;           // cells per side
uniform int   uPerCell;        // blades per cell (or leaves per bush)
uniform int   uPerTuft;        // blades sharing a tuft
uniform float uTuftRadius;
uniform vec4  uRing;           // x: inner, y: outer, z: fade band, w: width boost
uniform vec3  uThin;           // x: density ratio to the next ring, y: 1 = smooth LOD, z: falloff shape
uniform float uDensity;        // 0..1 global thinning
uniform float uHeightScale;
uniform float uSeed;
uniform float uLodBlend;       // 0 near .. 1 far, drives cheap simplifications

// --- camera / culling -------------------------------------------------------
uniform vec3 uCamPos;          // ring anchor: always the *main* camera
uniform float uGroundY;        // museum plaza: drop the field onto the ground plane
uniform vec4 uCullPlanes[5];   // world-space planes of whatever we render for
uniform vec2 uScreen;          // x: metres per pixel per metre of depth, y: minimum blade width in pixels
uniform vec3 uColumn;          // x: world height min, y: max, z: tallest plant

// --- wind -------------------------------------------------------------------
uniform float uTime;
uniform float uTimePrev;       // last frame's time, for exact motion vectors
uniform vec2  uWindDir;
uniform vec4  uWind;           // x: strength, y: speed, z: frequency, w: gustiness
uniform float uWindScale;      // metres per gust-field period

// --- interaction ------------------------------------------------------------
uniform vec4 uColliders[8];    // xyz centre, w radius
uniform int  uColliderCount;

// --- bush mode --------------------------------------------------------------
#ifdef BUSH
// One entry per shrub model. A bush field carries every model at once and picks
// one per cell, so a scene grows a mixed population out of a single draw call.
uniform vec4  uBushA[NUM_SPECIES];     // clump radius, scale, outward lean, base droop
uniform vec4  uBushB[NUM_SPECIES];     // leaf fraction, mix weight, plume fraction, plume height
uniform vec4  uBushC[NUM_SPECIES];     // plume width, plume lean, -, -
uniform vec3  uBushTint[NUM_SPECIES];  // flower-spike colour
uniform float uBushChance;
uniform vec2  uLeafLod;        // distances over which leaves thin out
#endif

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
varying vec3 vTint;
varying vec4 vMisc;   // x swardAO  y texLayer  z dryness  w translucency
varying vec4 vMisc2;  // x roughMul y sheen     z detail   w facing sign

${GLSL_MOTION_VERT}

// Writing a degenerate clip position is how an instance opts out. Every varying
// still has to be assigned: an unwritten output is undefined, and on some
// drivers that shows up as stray geometry rather than as nothing.
#define EMIT_CULLED() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vWorld = vec3(0.0); vNormal = vec3(0.0, 1.0, 0.0); vTangent = vec3(1.0, 0.0, 0.0); vUv = vec2(0.0); vTint = vec3(0.0); vMisc = vec4(0.0); vMisc2 = vec4(0.0); vClipNow = vec4(0.0, 0.0, 0.0, 1.0); vClipPrev = vec4(0.0, 0.0, 0.0, 1.0); return; }

/* ---------------------------------------------------------------- shape -- */

// Botanical width profile. Four numbers span the shapes that actually occur:
// acicular (fescue), linear (most grasses), lanceolate and ovate (shrub
// leaves), triangular (sedges). Nothing here can produce a letterform.
float widthProfile(float t, vec4 s1){
  float shoulder = max(s1.x, 1e-3);
  float sw       = s1.y;
  float taper    = max(s1.z, 0.05);
  float tipW     = s1.w;

  float rise = smootherstep(0.0, shoulder, t);
  float wUp  = mix(sw * 0.66, sw, rise);

  float k    = sat((t - shoulder) / max(1.0 - shoulder, 1e-3));
  float wDn  = mix(tipW, sw, pow(1.0 - k, taper));

  return mix(wUp, wDn, step(shoulder, t));
}

vec2 bez3(vec2 a, vec2 b, vec2 c, vec2 d, float t){
  float u = 1.0 - t;
  return u*u*u*a + 3.0*u*u*t*b + 3.0*u*t*t*c + t*t*t*d;
}
vec2 bez3d(vec2 a, vec2 b, vec2 c, vec2 d, float t){
  float u = 1.0 - t;
  return 3.0*u*u*(b - a) + 6.0*u*t*(c - b) + 3.0*t*t*(d - c);
}

/* ----------------------------------------------------------------- wind -- */

/**
 * Wind deflection at an absolute time. Three superimposed scales: a slow gust
 * field advected across the world, a mid-frequency sway, and a fast flutter
 * that only the tip really feels.
 *
 * Taking time as an argument rather than reading uTime is the whole reason
 * temporal antialiasing works on this grass. Wind here is a pure function of
 * (position, time), so the same blade can be evaluated at this frame's time and
 * the last one's inside a single vertex shader invocation — which yields exact
 * motion vectors for wind-driven geometry, the thing TAA normally cannot get.
 */
// The gust field is sampled once and shared by both times. It advects at a
// couple of centimetres per frame across a field tens of metres wide, so its
// value is identical to within rounding between one frame and the next — and a
// texture fetch is the most expensive thing in this shader.
float windGust(vec3 base, float tSec){
  vec2 wUV = (base.xz - uWindDir * (tSec * uWind.y * 1.6)) / uWindScale;
  vec4 wn = noiseTapUV(wUV);
  return mix(0.35, 1.0, pow(mix(wn.r, wn.g, 0.55), mix(1.0, 2.6, uWind.w)));
}

float windDeflection(float tSec, vec3 base, float phase, float responsiveness, float gust){
  float sway    = sin(tSec * uWind.z + phase + dot(base.xz, uWindDir) * 0.55);
  float flutter = sin(tSec * uWind.z * 4.3 + phase * 3.7) * 0.35
                + sin(tSec * uWind.z * 7.1 + phase * 5.3) * 0.18;

  float amp = uWind.x * gust * responsiveness;
  return amp * (0.55 + 0.45 * sway) + amp * flutter * 0.22;
}

/* --------------------------------------------------------------- shape --- */

struct Blade {
  vec3 pos;
  vec3 nrm;       // shading normal, tilted by the keel
  vec3 tangent;
  vec3 sideV;     // across the blade, after twist
  vec3 faceN;     // face normal before the keel tilt
};

/**
 * Just the centreline point — no frame, no normal.
 *
 * This is the previous-frame path. Building the full cross-section frame twice
 * per vertex doubles the most expensive part of the shader for a motion vector
 * that is measured in pixels; the blade's twist and keel rotate by a fraction of
 * a degree between two frames, so reusing this frame's frame for last frame's
 * centre is wrong by a few tenths of a millimetre. That is far below the pixel
 * the vector is eventually quantised into.
 */
vec3 bladeCentre(float bendAmt, vec3 fwdDir, vec3 up, vec3 base, float len,
                 float stiff, float sCurve, float t, float fade){
  float a1 = bendAmt * 0.30 * (1.0 - stiff * 0.55);
  float a2 = bendAmt * 0.72;
  float a3 = bendAmt;
  vec2 P0 = vec2(0.0);
  vec2 P1 = P0 + vec2(sin(a1 - sCurve), cos(a1 - sCurve)) * len * 0.355;
  vec2 P2 = P1 + vec2(sin(a2), cos(a2)) * len * 0.340;
  vec2 P3 = P2 + vec2(sin(a3), cos(a3)) * len * 0.305;
  vec2 C = bez3(P0, P1, P2, P3, t);
  return mix(base, base + fwdDir * C.x + up * C.y, fade);
}

/**
 * Places one vertex of a blade, given how far it is bent and which way.
 *
 * Everything time-dependent enters through bendAmt and fwdDir, so calling
 * this twice with the current and previous wind is all it takes to get both
 * positions. Nothing else about the blade — width, twist, keel, damage — moves.
 */
Blade bladeVertex(float bendAmt, vec3 fwdDir, vec3 up, vec3 base, float len,
                  float stiff, float sCurve, float t,
                  float side, float w, float kFold, float twistA, float fade){
  // Arc-length preserving control polygon: the three segments always add to the
  // blade's length, so bending never stretches or shrinks it.
  float a1 = bendAmt * 0.30 * (1.0 - stiff * 0.55);
  float a2 = bendAmt * 0.72;
  float a3 = bendAmt;
  vec2 P0 = vec2(0.0);
  vec2 P1 = P0 + vec2(sin(a1 - sCurve), cos(a1 - sCurve)) * len * 0.355;
  vec2 P2 = P1 + vec2(sin(a2), cos(a2)) * len * 0.340;
  vec2 P3 = P2 + vec2(sin(a3), cos(a3)) * len * 0.305;

  vec2 C  = bez3(P0, P1, P2, P3, t);
  vec2 dC = bez3d(P0, P1, P2, P3, t);

  // Ring fade shrinks blades into the ground instead of popping them.
  vec3 centre  = mix(base, base + fwdDir * C.x + up * C.y, fade);
  vec3 tangent = normalize(fwdDir * dC.x + up * dC.y + vec3(1e-6));

  // Grass leaves are keeled: a shallow V near the base that flattens toward the
  // tip. This single detail does more for the 3D read than any texture.
  vec3 side0 = normalize(cross(up, fwdDir) + vec3(1e-6));
  vec3 sideV = normalize(rotAxis(side0, tangent, twistA));
  vec3 nrm   = normalize(cross(tangent, sideV));

  float x = side * w;
  float fold = kFold * (x * x - w * w * 0.3333);

  Blade b;
  b.pos = centre + sideV * x + nrm * fold;
  b.nrm = normalize(nrm - sideV * (2.0 * kFold * x));
  b.tangent = tangent;
  b.sideV = sideV;
  b.faceN = nrm;
  return b;
}

/* -------------------------------------------------------------- species -- */

float speciesWeight(int i, float bv){
  vec4 s = sp(i, 9);
  float d = (bv - s.x) / max(s.y, 1e-3);
  return exp(-d * d) * max(s.z, 0.0);
}

int pickSpecies(float bv, float r){
  float total = 0.0;
  for (int i = 0; i < NUM_SPECIES; i++) total += speciesWeight(i, bv);
  if (total <= 1e-6) return 0;
  float target = r * total;
  float acc = 0.0;
  int idx = NUM_SPECIES - 1;
  for (int i = 0; i < NUM_SPECIES; i++){
    acc += speciesWeight(i, bv);
    if (target <= acc){ idx = i; break; }
  }
  return idx;
}

#ifdef BUSH
/** Which shrub model grows here, drawn from the per-model mix weights. */
int pickShrub(float r){
  float total = 0.0;
  for (int i = 0; i < NUM_SPECIES; i++) total += max(uBushB[i].y, 0.0);
  if (total <= 1e-6) return 0;
  float target = r * total;
  float acc = 0.0;
  int idx = NUM_SPECIES - 1;
  for (int i = 0; i < NUM_SPECIES; i++){
    acc += max(uBushB[i].y, 0.0);
    if (target <= acc){ idx = i; break; }
  }
  return idx;
}
#endif

/* ------------------------------------------------------------ ring LOD -- */

/**
 * This ring's share of the population at distance d.
 *
 * Adjacent rings hand over on exactly the same interval — ring N's outer band
 * IS ring N+1's inner band — and smootherstep plus its complement sum to one
 * across it. So the shares of all rings add to 1 everywhere, which is what lets
 * the density curve below be read as the total rather than as one ring's slice.
 */
float ringShare(float d){
  float fin  = uRing.x <= 0.0 ? 1.0 : smootherstep(uRing.x - uRing.z, uRing.x, d);
  float fout = 1.0 - smootherstep(uRing.y - uRing.z, uRing.y, d);
  return fin * fout;
}

/**
 * Fraction of this ring's allocation that survives at distance d.
 *
 * A ring is allocated at the density it needs at its INNER edge and is thinned
 * geometrically across its span down to whatever the next ring is allocated at.
 * At the seam both rings are therefore delivering the same blades per square
 * metre, and the staircase — 4.6x at the first seam, 9x at the last — becomes a
 * curve. smootherstep on the parameter flattens the curve at both ends so the
 * seam is C1, not merely continuous: without it the density has a visible kink
 * even though it has no jump.
 */
float ringThin(float d){
  if (uThin.y < 0.5) return 1.0;
  float inner = max(uRing.x, 0.0);
  float s = sat((d - inner) / max(uRing.y - inner, 1e-3));
  // Back-loaded. Raising s to a power before the smootherstep holds the ring
  // near its full allocation across its inner part and spends the whole drop
  // near its outer edge. Interpolating evenly (shape 1) is continuous but
  // throws away more than half the blades in the band you are standing in,
  // which reads as a bald patch around your feet; too high a shape compresses
  // the drop into a narrow annulus and the edge starts to show again.
  //
  // Any shape > 0 keeps the seam C1, because d/ds of smootherstep(s^k) is zero
  // at both ends — the flatness at s = 1 is what makes the handover invisible
  // rather than merely continuous.
  float u = pow(s, max(uThin.z, 0.01));
  return pow(uThin.x, smootherstep(0.0, 1.0, u));
}

/* ----------------------------------------------------------------- main -- */

void main(){
  int id   = gl_InstanceID;
  int cell = id / uPerCell;
  int sub  = id - cell * uPerCell;

  ivec2 loc  = ivec2(cell - (cell / uGrid) * uGrid, cell / uGrid) - ivec2(uGrid / 2);
  ivec2 wc   = uCamCell + loc;
  vec2  cellOrigin = vec2(wc) * uCellSize;

  uint seedU = uint(uSeed);
  vec4 cellR = toF(pcg4d(uvec4(asU(wc), 0u, seedU)));

  // ---------------------------------------------------------- placement --
  vec2  originXZ;
  vec3  base;
  vec3  upDir;
  vec3  fwdRef;
  float sizeMul = 1.0;
  vec4  r;            // per-blade randoms
  vec4  tr;           // per-tuft randoms (shared appearance within a clump)
  float bv;           // biome value
  float soil;
  bool  cull = false;
  // How much of itself a blade is drawing: 1 is full size, 0 is gone. Grass
  // sets this per blade from its own dissolve margin, bushes from the ring
  // band. It shrinks both width and height, so a blade leaves by getting
  // smaller rather than by blinking out.
  float ringFade = 1.0;
  // Shrub-only, folded away to constants for grass.
  float bushLean = 0.0;   // extra outward arc, added to the wind bend
  float widthMul = 1.0;   // flower spikes are narrower than foliage
  float plume    = 0.0;   // 1 = this leaf is a flower spike
  int   bushModel = 0;    // which shrub model this cell grew
  vec3  plumeTint = vec3(1.0);

#ifdef BUSH
  // One plant per cell, built as a tussock: every leaf is rooted ON the ground
  // inside a small rosette and holds itself up by its own length.
  //
  // The skeleton this replaced hung leaves along an aerial branch arc and never
  // drew the branch, so a leaf out near the tip sat in mid-air with nothing
  // beneath it. Tall grass hid that; shorten the sward and the plants visibly
  // float. A tussock has no such failure mode — there is no aerial anchor to
  // lose, because there is no aerial anchor.
  vec4 lr = toF(pcg4d(uvec4(asU(wc), uint(sub) * 17u + 3u, seedU + 313u)));
  r  = lr;
  tr = cellR;                    // the whole plant shares one colour drift

  // Which model grows in this cell. Its own hash, decorrelated from the one
  // that decides whether a plant grows here at all — sharing them would make
  // the sparser scenes systematically favour the first model in the list.
  vec4 pr = toF(pcg4d(uvec4(asU(wc), 7771u, seedU + 4242u)));
  bushModel = pickShrub(pr.x);
  vec4 fA = uBushA[bushModel];
  vec4 fB = uBushB[bushModel];
  vec4 fC = uBushC[bushModel];
  plumeTint = uBushTint[bushModel];

  // Models want different leaf counts. The ring allocates the largest and the
  // rest drop their surplus right here, before a single texture fetch.
  if (float(sub) >= fB.x * float(uPerCell)) EMIT_CULLED();

  vec2 centre = cellOrigin + (cellR.xy * 0.7 + 0.15) * uCellSize;

  float bushScale = mix(0.6, 1.45, cellR.w);
  sizeMul = bushScale * fA.y;

  // Rosette: a centre-biased disc, so the crown is crowded and the skirt thins
  // out the way a real tussock spreads.
  float cAng  = lr.x * TAU;
  float cFrac = lr.y * (0.35 + 0.65 * lr.y);
  float cRad  = fA.x * bushScale * cFrac;
  originXZ = centre + vec2(cos(cAng), sin(cAng)) * cRad;

  Ground gr = sampleGround(originXZ);
  soil = gr.soil;
  bv   = biomeValue(originXZ);
  if (cellR.z > uBushChance * uDensity * sat(soil * 1.6)) cull = true;
  if (gr.slope > 0.55) cull = true;

  // Continuous leaf LOD inside a single draw call: each leaf holds a stable
  // random priority, and the survival threshold drops with distance. Because
  // the priority never changes, a leaf that is culled stays culled — no
  // flicker — and the survivors grow to keep the shrub's volume.
  {
    float dcam = length(originXZ - uCamPos.xz);
    float lodFrac = mix(1.0, 0.16, smootherstep(uLeafLod.x, uLeafLod.y, dcam));
    float prio = fract(lr.x * 3.17 + lr.y * 1.71 + cellR.x * 0.53);
    if (prio > lodFrac) cull = true;
    sizeMul *= mix(1.0, 2.1, sat((1.0 - lodFrac) * 1.05));
  }

  // Flower spikes: taller, narrower, stiffer and pale. Drawn from a hash that
  // shares no terms with the LOD priority above, or thinning the plant at
  // distance would preferentially eat its plumes.
  plume = step(fract(lr.z * 7.13 + lr.w * 3.31 + cellR.y * 1.87), fB.z);
  sizeMul *= mix(1.0, fB.w, plume);
  widthMul = mix(1.0, fC.x, plume);

  // The further out a leaf is rooted, the more it arcs away from the crown.
  // That gradient is what reads as a fountain rather than a hedgehog, and it
  // costs nothing because the bend machinery is already there for the wind.
  bushLean = (fA.z * cFrac * mix(0.65, 1.3, lr.z) + fA.w)
           * mix(1.0, fC.y, plume);

  base  = vec3(originXZ.x, gr.h, originXZ.y);
  upDir = normalize(mix(vec3(0.0, 1.0, 0.0), gr.n, 0.55));
  // Leaves lean outward, away from the plant's own centre. Leaves rooted right
  // at the crown have no outward direction to speak of, so they take a random
  // one and stand nearly upright anyway.
  vec2 out2 = cFrac > 0.02 ? vec2(cos(cAng), sin(cAng))
                           : vec2(cos(lr.w * TAU), sin(lr.w * TAU));
  vec3 outward = vec3(out2.x, 0.0, out2.y);
  fwdRef = normalize(outward - upDir * dot(outward, upDir) + vec3(1e-5));
#else
  // Grass: blades cluster into tufts. Sharing the tuft's colour, height and
  // lean is what separates a meadow from confetti.
  int tuft = sub / max(uPerTuft, 1);
  tr = toF(pcg4d(uvec4(asU(wc), uint(tuft) * 7919u + 13u, seedU)));
  r  = toF(pcg4d(uvec4(asU(wc), uint(sub)  * 2654u + 101u, seedU + 77u)));

  // The two tests that reject the most instances need nothing but XZ, so they
  // run before anything that costs a texture fetch.
  //
  // This ordering is the single most valuable optimisation in the shader. The
  // ground sample, the biome value and the patchiness lookup are four vertex
  // texture fetches, they were being paid *before* the culls, and a vertex
  // texture fetch is expensive. At fourteen vertices per blade and a quarter of
  // a million blades that was fourteen million fetches per frame — most of them
  // to decide that the blade was behind the camera. It also meant turning the
  // density down to zero saved nothing, because the fetches happened before the
  // density test could reject anything.
  vec2 tuftPos = cellOrigin + tr.xy * uCellSize;
  // Far rings use cells many times wider than a real tuft. Holding the clump
  // radius at its close-up value out there leaves structured gaps between
  // cells, and a square grid of gaps resolves into streaks converging on the
  // horizon — the most recognisable failure of grid-placed grass. So a clump
  // spreads to fill whatever cell it was handed; by the distance that happens,
  // the clumping was not readable anyway.
  float tRad   = max(uTuftRadius * mix(0.55, 1.35, tr.z), uCellSize * 0.36);
  float ang    = r.x * TAU;
  float rad    = tRad * r.y * (0.30 + 0.70 * r.y);   // centre-biased disc
  originXZ = tuftPos + vec2(cos(ang), sin(ang)) * rad;

  {
    // Euclidean, not Chebyshev. max(|dx|,|dz|) makes the set of equidistant
    // points a SQUARE, so every ring boundary was a visible box on the ground
    // and the diagonals ran a whole LOD level behind the axes. The cost of the
    // honest metric is that the corners of the square cell grid now fall
    // outside the ring and go to waste — about 21% of the allocation — but they
    // are rejected right here, before a single texture fetch.
    float distXZ = length(originXZ - uCamPos.xz);
    bool early = uDensity <= 0.0
      || (uRing.x > 0.0 && distXZ < uRing.x - uRing.z)
      || distXZ > uRing.y;

    // Conservative frustum test against the vertical column the blade must lie
    // in: the terrain never leaves a known height band, and the blade is never
    // taller than the tallest species. That is enough to reject without knowing
    // where the ground actually is at this point.
    if (!early){
      vec3 c = vec3(originXZ.x, (uColumn.x + uColumn.y) * 0.5, originXZ.y);
      float rad2 = (uColumn.y - uColumn.x) * 0.5 + uColumn.z + uTuftRadius;
      for (int i = 0; i < 5; i++){
        if (dot(uCullPlanes[i].xyz, c) + uCullPlanes[i].w < -rad2){ early = true; break; }
      }
    }

    // Continuous LOD, stochastic and stable.
    //
    // The blade holds a fixed priority hashed from its own randoms, and the
    // survival threshold falls with distance. Because the priority never
    // changes, a blade that is culled stays culled and one that survives never
    // blinks — walking towards it only ever raises its margin, so it grows in
    // rather than popping in. Same mechanism the bush leaves use above; grass
    // simply never had it, which is why its density could only change in ring
    // steps.
    //
    // Decided before the ground sample because it needs nothing but distance
    // and the blade's own randoms, and it rejects more instances than the
    // frustum test does.
    if (!early){
      float keep = ringShare(distXZ) * ringThin(distXZ);
      float prio = fract(r.x * 5.13 + r.y * 2.71 + tr.y * 1.93);
      float m = keep - prio;
      // Same 0.002 floor the ring band used: below it the blade is drawn at
      // roughly zero size, which is a degenerate triangle nobody sees.
      if (m <= 0.002) early = true;
      // Only the blades within a sliver of their own threshold are shrunk; the
      // rest are full size. Widen this and the whole field looks stunted,
      // narrow it and blades snap into existence.
      else ringFade = sat(m * 5.0);
    }

    if (early) EMIT_CULLED();
  }

  Ground gr = sampleGround(originXZ);
  soil = gr.soil;
  bv   = biomeValue(originXZ);

  float dens = uDensity * soil * mix(0.45, 1.25, patchiness(tuftPos));
  dens *= 1.0 - sat((gr.slope - 0.42) * 2.2);
  if (r.z > dens) cull = true;

  base   = vec3(originXZ.x, gr.h, originXZ.y);
  upDir  = normalize(mix(vec3(0.0, 1.0, 0.0), gr.n, 0.55));
  float yaw = r.w * TAU + (tr.w - 0.5) * 1.4;
  fwdRef = normalize(vec3(cos(yaw), 0.0, sin(yaw)) - upDir * dot(vec3(cos(yaw), 0.0, sin(yaw)), upDir));
#endif

  // ------------------------------------------------- ring fade + culling --
#ifdef BUSH
  // Shrubs are one per cell and already thin themselves by leaf priority, so
  // they keep the plain band fade — but on the honest metric, not a square one.
  ringFade = ringShare(length(base.xz - uCamPos.xz));
  if (ringFade <= 0.002) cull = true;
#endif

#ifdef BUSH
  int si = bushModel;             // the model already chose its own leaf
#else
  int si = pickSpecies(bv, tr.w);
#endif
  vec4 s0 = sp(si, 0);
  float height = s0.x * mix(1.0 - s0.y, 1.0 + s0.y, r.y) * uHeightScale * sizeMul;
  height *= mix(0.75, 1.12, tr.z);

  // Cheap conservative sphere test against the active frustum. Kills roughly
  // two thirds of the instances before any of the expensive maths runs.
  {
    vec3 c = base + upDir * height * 0.5;
    float rad = height * 0.75 + uTuftRadius;
    for (int i = 0; i < 5; i++){
      if (dot(uCullPlanes[i].xyz, c) + uCullPlanes[i].w < -rad){ cull = true; break; }
    }
  }

  if (cull) EMIT_CULLED();

  // ------------------------------------------------------------- species --
  vec4 s1 = sp(si, 1);
  vec4 s2 = sp(si, 2);
  vec4 s3 = sp(si, 3);
  vec4 s4 = sp(si, 4);
  vec4 s5 = sp(si, 5);
  vec4 s6 = sp(si, 6);
  vec4 s7 = sp(si, 7);
  vec4 s8 = sp(si, 8);
  vec4 s10 = sp(si, 10);

  float side = position.x;
  float t    = position.y;

  float width = s0.z * mix(1.0 - s0.w, 1.0 + s0.w, r.x) * sizeMul * widthMul;
  width *= mix(1.0, uRing.w, uLodBlend);      // artistic per-ring nudge

  // Screen-space width floor.
  //
  // A real fescue blade is 2-3 mm across, which is under one pixel past about
  // three metres. Sub-pixel geometry does not render as thin grass — it renders
  // as sparkling noise, and it is the reason most browser grass looks like
  // static in the middle distance. So no blade is ever allowed to fall below
  // roughly a pixel: as it recedes it stops shrinking on screen and simply
  // holds its minimum. The LOD ladder thins the population at the same rate, so
  // total coverage stays put and the swap is invisible — there is no distance
  // at which a blade suddenly changes size.
  float camDist = distance(base, uCamPos);
  width = max(width, uScreen.x * camDist * uScreen.y);

  // --------------------------------------------------------- tip damage --
  // A real sward is full of blades that have been grazed, trodden or snapped.
  float dmgRnd  = fract(r.z * 3.71 + r.w * 1.33 + tr.x * 0.57);
  float damaged = step(dmgRnd, s8.w);
  float cutAt   = mix(0.52, 0.93, fract(r.w * 7.31));
  height *= mix(1.0, cutAt, damaged);
  vec4 s1d = s1;
  s1d.w = mix(s1.w, s1.y * 0.62, damaged * 0.85);   // blunt end
  s1d.z = mix(s1.z, s1.z * 0.55, damaged);

  // ------------------------------------------------------------- bending --
  float droop = s3.x * mix(1.0 - s3.y, 1.0 + s3.y, r.x);
  float stiff = clamp(s3.z, 0.0, 0.98);

  float phase = tr.w * TAU + r.x * 1.7;
  float responsiveness = (1.0 - stiff) * s10.x;

  // Evaluated twice: once for where the blade is, once for where it was. The
  // second call is a texture tap and a handful of trig, and it buys motion
  // vectors that include the wind.
  float gust     = windGust(base, uTime);
  float windNow  = windDeflection(uTime, base, phase, responsiveness, gust);
  float windWas  = windDeflection(uTimePrev, base, phase, responsiveness, gust);

#ifdef BUSH
  vec3 fwd = fwdRef;                  // leaves keep their branch frame
  vec3 fwdWas = fwdRef;
  windNow *= 0.55;
  windWas *= 0.55;
#else
  vec2 dirNow = normalize(fwdRef.xz + uWindDir * sat(windNow * 1.1) * 2.0 + vec2(1e-5));
  vec2 dirWas = normalize(fwdRef.xz + uWindDir * sat(windWas * 1.1) * 2.0 + vec2(1e-5));
  vec3 fwd    = normalize(vec3(dirNow.x, 0.0, dirNow.y) - upDir * dot(vec3(dirNow.x, 0.0, dirNow.y), upDir));
  vec3 fwdWas = normalize(vec3(dirWas.x, 0.0, dirWas.y) - upDir * dot(vec3(dirWas.x, 0.0, dirWas.y), upDir));
#endif

  float bend    = droop + windNow + bushLean;
  float bendWas = droop + windWas + bushLean;

  // --------------------------------------------------------- interaction --
  // Colliders are read at their current position for both times. A walker moves
  // a couple of centimetres per frame, so the motion-vector error is a fraction
  // of a pixel and the neighbourhood clamp absorbs it — cheaper than carrying a
  // second collider array just for the previous frame.
  float flatten = 0.0;
  vec2 push = vec2(0.0);
  for (int i = 0; i < 8; i++){
    if (i >= uColliderCount) break;
    vec4 col = uColliders[i];
    vec2 dv = base.xz - col.xz;
    float dl = length(dv);
    if (dl < col.w){
      float k = 1.0 - dl / max(col.w, 1e-3);
      k = k * k;
      push += normalize(dv + vec2(1e-4)) * k;
      flatten = max(flatten, k);
    }
  }
  if (flatten > 0.0){
    vec2 pd = normalize(push + vec2(1e-5));
    vec3 pushDir = vec3(pd.x, 0.0, pd.y);
    float mixAmt = sat(flatten * 1.4);
    float bendAmt = sat(flatten * 1.2) * (1.0 - stiff * 0.5);
    fwd    = normalize(mix(fwd, pushDir, mixAmt));
    fwdWas = normalize(mix(fwdWas, pushDir, mixAmt));
    bend    = mix(bend, 1.45, bendAmt);
    bendWas = mix(bendWas, 1.45, bendAmt);
    height *= mix(1.0, 0.55, flatten);
  }

  bend    = clamp(bend, -0.2, 2.4);
  bendWas = clamp(bendWas, -0.2, 2.4);

  // ---------------------------------------------------- width silhouette --
  float w = widthProfile(t, s1d) * width;

  // Serrated edge: high-frequency, per-blade seeded, so the outline never
  // reads as a smooth mathematical taper.
  float eseed = r.x * 137.0 + float(si) * 31.0;
  float serr = vnoise1(t * s8.y + eseed) - 0.5;
  serr += (vnoise1(t * s8.y * 2.7 + eseed * 1.7) - 0.5) * 0.5;
  w *= 1.0 + serr * s8.x;

  // Asymmetry: one margin is always a little fuller than the other.
  float asym = 1.0 + s8.z * (side > 0.0 ? (r.y - 0.5) : (0.5 - r.y)) * 2.0;
  w *= asym;
  w = max(w, 0.0);
  w *= mix(0.35, 1.0, ringFade);

  float twist = (s2.z * mix(1.0 - s2.w, 1.0 + s2.w, r.y)) * (r.w > 0.5 ? 1.0 : -1.0);
  twist *= t * t;

  float keel = s2.x * pow(max(1.0 - t, 0.0), max(s2.y, 0.01)) / max(width, 1e-4);
  float curl = s3.w * t * t * t * 0.5 / max(width, 1e-4);
  float k = keel + curl;
  float sCurve = s3.w * 0.35;                     // slight reflex near the base

  Blade now = bladeVertex(bend, fwd, upDir, base, height, stiff, sCurve, t,
                          side, w, k, twist, ringFade);

  // Last frame's position: centreline only, reusing this frame's cross-section.
  float xw = side * w;
  vec3 posWas = bladeCentre(bendWas, fwdWas, upDir, base, height, stiff, sCurve, t, ringFade)
              + now.sideV * xw + now.faceN * (k * (xw * xw - w * w * 0.3333));

  vec3 worldPos = now.pos;
  worldPos.y += uGroundY;
  vec3 N = now.nrm;
  vec3 tangent = now.tangent;

  // ------------------------------------------------------------ shading --
  float bladeT = t;
  float swardAO = mix(s7.z, 1.0, pow(bladeT, 0.65));
  swardAO = mix(1.0, swardAO, sat(uDensity * 1.2));

  // Per-blade colour: tuft-shared hue drift plus a little individual variance.
  float hueJ = (tr.x - 0.5) * s4.w * 0.16 + (r.y - 0.5) * s4.w * 0.05;
  float valJ = (tr.y - 0.5) * s4.w * 0.55 + (r.z - 0.5) * s4.w * 0.25;
  vec3 lamina = tweakHSV(s4.rgb, hueJ, (tr.z - 0.5) * s4.w * 0.4, valJ);
  vec3 tip    = mix(lamina, s5.rgb, sat(smootherstep(1.0 - s5.w, 1.0, bladeT)));
  vec3 col    = mix(tip, s6.rgb, sat(smootherstep(s6.w, 0.0, bladeT)));
#ifdef BUSH
  // A flower spike is pale for its whole upper length, not just at the tip.
  col = mix(col, plumeTint, plume * smootherstep(0.12, 0.55, bladeT) * 0.92);
#endif

  // Dryness rises toward the tip, with damaged blades curing faster.
  float dryness = sat(smootherstep(0.55, 1.0, bladeT) * s5.w + damaged * 0.35 + (tr.z - 0.5) * 0.3);

  // Which of the baked blade variants this instance wears. Species nudge the
  // starting slot so a fescue and a sedge rarely share the same leaf detail.
  float layer = mod(sp(si, 9).w + floor(r.z * float(VARIANTS)), float(VARIANTS));

  vTint   = col;
  vWorld  = worldPos;
  vNormal = N;
  vTangent = tangent;
  vUv     = vec2(side * 0.5 + 0.5, bladeT);
  vMisc   = vec4(swardAO, layer, dryness, s7.y);
  vMisc2  = vec4(s7.x, s7.w, 1.0 - uLodBlend, damaged);

  writeMotion(worldPos, posWas);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

/* ============================================================ fragment == */

export const BLADE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

${GLSL_MATH}
${GLSL_HASH}
${GLSL_NOISE_RT}

uniform sampler2DArray uBladeA;   // rgb albedo detail, a translucency
uniform sampler2DArray uBladeB;   // rg normal, b roughness, a AO

uniform vec3  uCamPos;
uniform float uTime;

${GLSL_LIGHT_UNIFORMS}

// --- material tuning --------------------------------------------------------
uniform float uNormalStrength;
uniform float uSpecular;
uniform float uAnisotropy;
uniform float uSSSScale;
uniform float uSSSPower;
uniform float uSSSDistortion;
uniform vec3  uSSSTint;
uniform float uDetailFade;        // metres at which micro detail is gone
uniform vec3  uSwardColor;        // what distant grass averages out to

uniform int uDebug;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec2 vUv;
varying vec3 vTint;
varying vec4 vMisc;
varying vec4 vMisc2;

${GLSL_BRDF}
${GLSL_SHADOW}
${GLSL_FOG}
${GLSL_MOTION_FRAG}

/* ---------------------------------------------------------------- main -- */

void main(){
  // Keep the stone path, the steps and the building footprint clear.
  if (abs(vWorld.x) < 16.5 && vWorld.z < 6.9) discard;
  if (abs(vWorld.x) < 2.45 && vWorld.z < 40.0) discard;

  float layer = vMisc.y;
  vec3 uvw = vec3(vUv, layer);

  vec4 A = texture(uBladeA, uvw);
  vec4 B = texture(uBladeB, uvw);

  float dist = length(vWorld - uCamPos);
  float detail = vMisc2.z * (1.0 - sat(dist / max(uDetailFade, 1.0)));

  // ------------------------------------------------------------- normal --
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vTangent - N * dot(N, vTangent));
  vec3 Bt = normalize(cross(N, T));
  if (!gl_FrontFacing) N = -N;

  vec2 nxy = (B.rg * 2.0 - 1.0) * uNormalStrength * detail;
  // Tangent-space map: x runs across the blade, y along it.
  N = normalize(N + Bt * nxy.x + T * nxy.y);

  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);

  // ------------------------------------------------------------- albedo --
  vec3 detailRGB = A.rgb * 2.0;
  vec3 albedo = vTint * mix(vec3(1.0), detailRGB, sat(detail * 0.85 + 0.15));
  albedo = mix(uSwardColor, albedo, sat(0.35 + detail * 0.65));

  float rough = clamp(B.b * vMisc2.x, 0.06, 1.0);
  rough = mix(mix(rough, 0.62, 0.6), rough, detail);     // distant blades stop glinting
  float ao = mix(1.0, B.a, detail) * vMisc.x;
  float trans = A.a * vMisc.w;

  // Specular anti-aliasing: fold the sub-pixel normal variance into roughness
  // instead of letting it alias into fireflies.
  vec3 dNx = dFdx(N), dNy = dFdy(N);
  float variance = dot(dNx, dNx) + dot(dNy, dNy);
  rough = sqrt(clamp(rough * rough + variance * 0.6, 0.0, 1.0));

  // ------------------------------------------------------------ lighting --
  float ndl = dot(N, L);
  float ndv = sat(dot(N, V)) + 1e-4;

  float shadow = sampleShadow(vWorld, N, ndl, uCamPos) * cloudShadow(vWorld, uTime);

  // Wrapped diffuse stands in for the short-range scattering inside the leaf,
  // which is why grass never goes fully black at the terminator.
  float wrap = 0.35;
  float diff = sat((ndl + wrap) / (1.0 + wrap));
  diff *= diff;

  vec3 direct = uSunColor * diff * shadow;

  // Transmission: the loud, obvious one. Light coming through a leaf from
  // behind, tinted by chlorophyll, strongest when you look toward the sun.
  vec3 Ht = normalize(L + N * uSSSDistortion);
  float ti = pow(sat(dot(V, -Ht)), uSSSPower) * uSSSScale;
  vec3 transmit = uSunColor * uSSSTint * ti * trans * mix(0.35, 1.0, shadow);
  // Dry tissue scatters warmer and less.
  transmit *= mix(1.0, 0.55, vMisc.z);

  // Ambient: hemisphere with a ground bounce, gated by the sward occlusion so
  // the bottom of the canopy sits in shadow like it should.
  float hemi = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uGroundBounce, uSkyColor, hemi) * uAmbient * ao;
  // Sky light also transmits through the blade from behind.
  ambient += uSkyColor * uAmbient * trans * 0.35 * ao;
  // Canopy inter-reflection. Light that bounces between blades comes back
  // green, and it is the reason a real field never goes blue in shade. One
  // multiply is a crude bounce, but leaving it out is the more visible error.
  ambient += uSwardColor * (uSunColor * 0.10 + uSkyColor * uAmbient * 0.45) * ao;

  vec3 diffuse = albedo * (direct + ambient) + transmit * albedo * 1.35;

  // ------------------------------------------------------------ specular --
  vec3 H = normalize(L + V);
  float ndh = sat(dot(N, H));
  float vdh = sat(dot(V, H));
  float a = rough * rough;
  float aspect = sqrt(1.0 - uAnisotropy * 0.9);
  float ax = max(a / aspect, 1e-3);
  float ay = max(a * aspect, 1e-3);

  float D = mix(d_ggx(ndh, a), d_ggx_aniso(H, T, Bt, N, ax, ay), sat(uAnisotropy));
  float Vs = v_smith(ndv, sat(ndl), a);
  vec3 F = f_schlick(vec3(0.035), vdh);
  vec3 spec = uSunColor * D * Vs * F * sat(ndl) * shadow * uSpecular;

  // Sky reflection at grazing angles — a waxy leaf really does go silver when
  // you look along it. Weighted by Fresnel and by smoothness, and tinted toward
  // the leaf, because an untinted sky term this broad turns shaded grass blue.
  float fres = 0.04 + 0.96 * pow5(1.0 - ndv);
  vec3 sheenCol = mix(uSkyColor, uSkyColor * (0.4 + albedo * 3.0), 0.55);
  spec += sheenCol * fres * (1.0 - rough) * vMisc2.y * uAmbient * 0.5 * ao;

  vec3 color = diffuse + spec;

  // -------------------------------------------------------------- debug --
  if (uDebug == 1) color = N * 0.5 + 0.5;
  else if (uDebug == 2) color = vec3(rough);
  else if (uDebug == 3) color = vec3(ao);
  else if (uDebug == 4) color = albedo;
  else if (uDebug == 5) color = vec3(trans);
  else if (uDebug == 6) color = vec3(vMisc2.z, 1.0 - vMisc2.z, 0.0);
  else if (uDebug == 7) color = vec3(shadow);

  if (uDebug == 0) color = applyFog(color, vWorld, uCamPos, -V);

  // Linear HDR out. Tone mapping and encoding happen once, after the
  // temporal resolve — mapping before accumulation bakes the curve into the
  // history and makes brightness depend on how fast the camera is moving.
  gl_FragColor = vec4(color, 1.0);
  writeVelocity();
}
`;

/* ======================================================== depth variant == */

// The shadow pass reuses the vertex shader verbatim and writes nothing but
// hardware depth, so a blade's silhouette in the shadow map is exactly the
// silhouette it has on screen — wind, bending, damage and all.
export const BLADE_DEPTH_FRAG = /* glsl */ `
precision highp float;
void main(){ gl_FragColor = vec4(1.0); }
`;

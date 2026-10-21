/**
 * Species profiles.
 *
 * Each profile is plain data — no code, no geometry, no textures. Copy one of
 * these objects into your own project, hand it to GrassSystem, and you get that
 * plant. Everything below is authored from how the real plant is built:
 *
 *   silhouette   how the leaf's width changes from sheath to tip. Real leaves
 *                are acicular, linear, lanceolate, ovate or triangular; those
 *                five shapes are what `shoulder / taper / tipWidth` span.
 *   keel         grass leaves fold along the midrib. Sedges fold hard, lawn
 *                fescues barely at all.
 *   droop        how far the tip has fallen from vertical, in radians.
 *   twist        blades rotate about their own axis as they grow.
 *   damage       fraction of blades with a snapped or grazed tip.
 *
 * Colours are given in sRGB hex because that is what an artist can eyeball;
 * they are converted to linear at pack time.
 */

import * as THREE from 'three';
import { SPECIES_STRIDE } from '../shaders/blade.js';

/** @typedef {ReturnType<typeof defineSpecies>} Species */

const DEFAULTS = {
  name: 'unnamed',
  note: '',

  // size (metres)
  height: 0.35,
  heightVar: 0.3,
  width: 0.006,
  widthVar: 0.25,

  // silhouette
  shoulder: 0.14,     // 0..1 — where the blade reaches full width
  shoulderWidth: 1.0, // multiplier at the shoulder (leave at 1)
  taper: 1.6,         // >1 sharp point, <1 blunt/rounded tip
  tipWidth: 0.02,     // fraction of width remaining at the very tip

  // cross-section & torsion
  keel: 0.55,         // V-fold depth, as a multiple of blade width
  keelFalloff: 1.4,   // how fast the fold flattens toward the tip
  twist: 0.55,        // radians of axial twist at the tip
  twistVar: 0.5,

  // bending
  droop: 0.45,        // radians the tip has fallen from vertical
  droopVar: 0.45,
  stiffness: 0.35,    // 0 floppy, 1 rigid — also gates wind response
  curl: 0.25,         // tip curl / basal reflex

  // colour (sRGB hex)
  lamina: '#5b7a35',
  tip: '#8a8a45',
  tipBlend: 0.35,     // how far down the tip colour reaches
  sheath: '#93a05a',
  sheathBlend: 0.12,
  colorVar: 0.55,     // per-tuft hue/value scatter

  // surface
  roughness: 1.0,     // multiplies the baked roughness map
  translucency: 1.0,  // multiplies the baked thickness map
  aoBase: 0.28,       // how dark the bottom of the canopy goes
  sheen: 0.16,

  // silhouette micro-variation
  edgeJitter: 0.09,   // serration depth
  edgeFreq: 22.0,     // serrations along the blade
  asymmetry: 0.10,    // left/right margin imbalance
  damage: 0.22,       // fraction of blades with broken tips

  // distribution
  biome: 0.5,         // preferred biome value
  biomeWidth: 0.35,   // tolerance around it
  weight: 1.0,        // relative abundance
  texVariant: 0,      // starting slot in the baked blade atlas

  // wind
  sway: 1.0
};

export function defineSpecies(o) {
  return { ...DEFAULTS, ...o };
}

// three.js colour management is on by default, so Color(hex) already lands in
// the linear working space — converting again would darken everything twice.
const lin = (hex) => new THREE.Color(hex);

/** Flattens species into the vec4 array the vertex shader indexes. */
export function packSpecies(list) {
  const out = [];
  for (const s of list) {
    const lam = lin(s.lamina), tip = lin(s.tip), sh = lin(s.sheath);
    const v = [
      new THREE.Vector4(s.height, s.heightVar, s.width, s.widthVar),
      new THREE.Vector4(s.shoulder, s.shoulderWidth, s.taper, s.tipWidth),
      new THREE.Vector4(s.keel, s.keelFalloff, s.twist, s.twistVar),
      new THREE.Vector4(s.droop, s.droopVar, s.stiffness, s.curl),
      new THREE.Vector4(lam.r, lam.g, lam.b, s.colorVar),
      new THREE.Vector4(tip.r, tip.g, tip.b, s.tipBlend),
      new THREE.Vector4(sh.r, sh.g, sh.b, s.sheathBlend),
      new THREE.Vector4(s.roughness, s.translucency, s.aoBase, s.sheen),
      new THREE.Vector4(s.edgeJitter, s.edgeFreq, s.asymmetry, s.damage),
      new THREE.Vector4(s.biome, s.biomeWidth, s.weight, s.texVariant),
      new THREE.Vector4(s.sway, 0, 0, 0),
      new THREE.Vector4(0, 0, 0, 0)
    ];
    if (v.length !== SPECIES_STRIDE) throw new Error('species stride mismatch');
    out.push(...v);
  }
  return out;
}

/* ======================================================== grasses ======= */

export const SPECIES = {

  /** Fine fescue turf. Short, needle-fine, upright, and very dense — the
   *  hardest case for a grass renderer because sub-pixel blades alias. */
  fescueLawn: defineSpecies({
    name: 'Fine Fescue (lawn)',
    note: 'Acicular. Short, upright, hair-fine. Mow-cut tips on most blades.',
    height: 0.13, heightVar: 0.28,
    width: 0.0030, widthVar: 0.22,
    shoulder: 0.06, taper: 2.4, tipWidth: 0.06,
    keel: 0.85, keelFalloff: 0.9,
    twist: 0.35, twistVar: 0.7,
    droop: 0.22, droopVar: 0.55, stiffness: 0.55, curl: 0.12,
    lamina: '#4e7233', tip: '#5c7c39', tipBlend: 0.18,
    sheath: '#6f8542', sheathBlend: 0.10,
    colorVar: 0.42,
    roughness: 0.95, translucency: 0.85, aoBase: 0.22, sheen: 0.12,
    edgeJitter: 0.07, edgeFreq: 26, asymmetry: 0.08,
    damage: 0.55,                       // a mown lawn is nearly all cut tips
    biome: 0.30, biomeWidth: 0.30, weight: 1.0, texVariant: 0,
    sway: 0.7
  }),

  /** Perennial ryegrass. The glossy one — a heavy wax layer on the underside
   *  makes a pasture flash silver when the wind turns the blades over. */
  ryegrassPasture: defineSpecies({
    name: 'Perennial Ryegrass',
    note: 'Linear, sharply keeled, glossy. Folded in bud, so a deep V at the base.',
    height: 0.30, heightVar: 0.34,
    width: 0.0055, widthVar: 0.26,
    shoulder: 0.11, taper: 1.7, tipWidth: 0.02,
    keel: 1.05, keelFalloff: 1.6,
    twist: 0.6, twistVar: 0.5,
    droop: 0.5, droopVar: 0.45, stiffness: 0.32, curl: 0.28,
    lamina: '#43682a', tip: '#556f2e', tipBlend: 0.20,
    sheath: '#6a7f3a', sheathBlend: 0.12,
    colorVar: 0.5,
    roughness: 0.72, translucency: 1.1, aoBase: 0.26, sheen: 0.28,
    edgeJitter: 0.08, edgeFreq: 20, asymmetry: 0.11, damage: 0.24,
    biome: 0.42, biomeWidth: 0.34, weight: 1.0, texVariant: 1,
    sway: 1.0
  }),

  /** Meadow / timothy grass. Taller, softer, arches over under its own
   *  weight and catches every gust. */
  timothyMeadow: defineSpecies({
    name: 'Timothy (meadow)',
    note: 'Linear, soft, strongly arching. Yellow-green with cured tips.',
    height: 0.52, heightVar: 0.40,
    width: 0.0050, widthVar: 0.30,
    shoulder: 0.10, taper: 1.9, tipWidth: 0.015,
    keel: 0.45, keelFalloff: 1.2,
    twist: 0.85, twistVar: 0.6,
    droop: 0.85, droopVar: 0.55, stiffness: 0.16, curl: 0.4,
    lamina: '#5f7a34', tip: '#7d8340', tipBlend: 0.26,
    sheath: '#7e8c46', sheathBlend: 0.10,
    colorVar: 0.62,
    roughness: 0.95, translucency: 1.25, aoBase: 0.30, sheen: 0.18,
    edgeJitter: 0.11, edgeFreq: 18, asymmetry: 0.14, damage: 0.28,
    biome: 0.55, biomeWidth: 0.32, weight: 0.9, texVariant: 2,
    sway: 1.35
  }),

  /** Little bluestem. Tall prairie bunchgrass; glaucous blue-green in summer,
   *  bronze by autumn, with long sweeping arcs. */
  prairieBluestem: defineSpecies({
    name: 'Little Bluestem (prairie)',
    note: 'Long linear blades, wide arcs, glaucous base grading to bronze.',
    height: 0.92, heightVar: 0.42,
    width: 0.0065, widthVar: 0.28,
    shoulder: 0.08, taper: 2.1, tipWidth: 0.012,
    keel: 0.6, keelFalloff: 1.1,
    twist: 1.25, twistVar: 0.65,
    droop: 1.05, droopVar: 0.6, stiffness: 0.14, curl: 0.55,
    lamina: '#5c6f52', tip: '#7c5a30', tipBlend: 0.34,
    sheath: '#6d7346', sheathBlend: 0.09,
    colorVar: 0.7,
    roughness: 1.0, translucency: 1.15, aoBase: 0.32, sheen: 0.2,
    edgeJitter: 0.12, edgeFreq: 15, asymmetry: 0.16, damage: 0.3,
    biome: 0.68, biomeWidth: 0.30, weight: 0.85, texVariant: 3,
    sway: 1.6
  }),

  /** Cured savanna grass. Dead-standing, brittle, matte, and almost opaque —
   *  the opposite end of the material range from fresh ryegrass. */
  savannaStraw: defineSpecies({
    name: 'Cured Savanna Straw',
    note: 'Fully senesced. Stiff, matte, pale, heavily broken tips.',
    height: 0.66, heightVar: 0.45,
    width: 0.0058, widthVar: 0.32,
    shoulder: 0.09, taper: 1.5, tipWidth: 0.05,
    keel: 0.9, keelFalloff: 0.7,
    twist: 1.5, twistVar: 0.8,
    droop: 0.6, droopVar: 0.8, stiffness: 0.62, curl: 0.7,
    lamina: '#9b8752', tip: '#b3a068', tipBlend: 0.40,
    sheath: '#8a7a4c', sheathBlend: 0.14,
    colorVar: 0.5,
    roughness: 1.28, translucency: 0.5, aoBase: 0.34, sheen: 0.08,
    edgeJitter: 0.17, edgeFreq: 13, asymmetry: 0.2, damage: 0.62,
    biome: 0.82, biomeWidth: 0.28, weight: 0.9, texVariant: 3,
    sway: 0.85
  }),

  /** Sedge. Not a grass at all: triangular stem, widest at the base, stiffly
   *  upright, hard keel, cool blue-green. */
  sedgeMarsh: defineSpecies({
    name: 'Marsh Sedge (Carex)',
    note: 'Triangular: widest at the base, linear taper, hard V-fold, rigid.',
    height: 0.58, heightVar: 0.35,
    width: 0.0085, widthVar: 0.22,
    shoulder: 0.02, taper: 1.05, tipWidth: 0.01,
    keel: 1.45, keelFalloff: 2.4,
    twist: 0.3, twistVar: 0.35,
    droop: 0.35, droopVar: 0.5, stiffness: 0.72, curl: 0.2,
    lamina: '#3f6440', tip: '#54703a', tipBlend: 0.22,
    sheath: '#527a44', sheathBlend: 0.14,
    colorVar: 0.4,
    roughness: 0.85, translucency: 0.95, aoBase: 0.3, sheen: 0.22,
    edgeJitter: 0.05, edgeFreq: 34, asymmetry: 0.06, damage: 0.18,
    biome: 0.18, biomeWidth: 0.26, weight: 1.0, texVariant: 1,
    sway: 0.55
  }),

  /** Alpine tussock. Short, wiry, silvered by dense hairs, tightly clumped. */
  alpineTussock: defineSpecies({
    name: 'Alpine Tussock',
    note: 'Wiry and inrolled, silvery from hairs, grows in tight cushions.',
    height: 0.19, heightVar: 0.4,
    width: 0.0024, widthVar: 0.3,
    shoulder: 0.04, taper: 2.8, tipWidth: 0.03,
    keel: 1.3, keelFalloff: 0.6,
    twist: 1.7, twistVar: 0.9,
    droop: 0.55, droopVar: 0.75, stiffness: 0.5, curl: 0.6,
    lamina: '#6e7b57', tip: '#85875d', tipBlend: 0.26,
    sheath: '#73795a', sheathBlend: 0.15,
    colorVar: 0.45,
    roughness: 1.12, translucency: 0.7, aoBase: 0.24, sheen: 0.34,
    edgeJitter: 0.1, edgeFreq: 30, asymmetry: 0.12, damage: 0.4,
    biome: 0.9, biomeWidth: 0.3, weight: 1.0, texVariant: 0,
    sway: 0.6
  }),

  /** White clover. A broadleaf in the sward — ovate, blunt-tipped, held flat.
   *  Included because a lawn that is only blades looks synthetic. */
  cloverPatch: defineSpecies({
    name: 'White Clover',
    note: 'Ovate leaflet: widest at mid-length, rounded tip, held near-horizontal.',
    height: 0.085, heightVar: 0.3,
    width: 0.019, widthVar: 0.25,
    shoulder: 0.46, taper: 0.75, tipWidth: 0.30,
    keel: 0.22, keelFalloff: 2.0,
    twist: 0.25, twistVar: 0.6,
    droop: 1.15, droopVar: 0.35, stiffness: 0.45, curl: -0.35,
    lamina: '#3d6b2b', tip: '#457230', tipBlend: 0.18,
    sheath: '#4b7a33', sheathBlend: 0.24,
    colorVar: 0.3,
    roughness: 0.8, translucency: 1.35, aoBase: 0.3, sheen: 0.2,
    edgeJitter: 0.05, edgeFreq: 40, asymmetry: 0.07, damage: 0.15,
    biome: 0.36, biomeWidth: 0.22, weight: 0.35, texVariant: 2,
    sway: 0.5
  })
};

/* ========================================================== shrubs ====== */

/**
 * A shrub is not a special primitive: it is the same blade instance, placed on
 * a small branch skeleton instead of on the ground. `leaf` is an ordinary
 * species; `shrub` describes the skeleton.
 */
/**
 * Shrubs are tussocks: one plant per cell, every leaf rooted on the ground
 * inside a rosette of radius `clump`, holding itself up by its own length.
 * Nothing is suspended in the air, so nothing can float when the sward around
 * it is cut short.
 *
 *   clump   metres, radius of the ground rosette
 *   scale   overall size multiplier on the leaf length
 *   lean    how far a leaf rooted at the rim arcs away from the crown
 *   droop   bend applied to every leaf, crown included
 *   plume   fraction of leaves drawn as pale flower spikes
 *
 * The leaf species' own `height` is the full leaf length in metres — it is what
 * sets how tall the plant stands.
 */
export const SHRUBS = {
  broadleafShrub: {
    name: 'Broadleaf Clump',
    note: 'Broad soft leaves in a low spreading rosette — hedgerow filler.',
    shrub: {
      clump: 0.28, scale: 1.0, lean: 0.75, droop: 0.38,
      spacing: 6.0, chance: 0.55, leaves: 96
    },
    leaf: defineSpecies({
      name: 'broadleaf',
      height: 0.21, heightVar: 0.35,
      width: 0.030, widthVar: 0.3,
      shoulder: 0.34, taper: 1.05, tipWidth: 0.06,
      keel: 0.35, keelFalloff: 1.6,
      twist: 0.5, twistVar: 0.8,
      droop: 0.7, droopVar: 0.7, stiffness: 0.5, curl: -0.2,
      lamina: '#37592a', tip: '#41632c', tipBlend: 0.18,
      sheath: '#456a2e', sheathBlend: 0.14,
      colorVar: 0.4,
      roughness: 0.68, translucency: 1.3, aoBase: 0.2, sheen: 0.3,
      edgeJitter: 0.09, edgeFreq: 24, asymmetry: 0.12, damage: 0.2,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 2,
      sway: 0.8
    })
  },

  sageBush: {
    name: 'Silver Sage',
    note: 'Small matte grey-green leaves, dense and rounded. Dryland filler.',
    shrub: {
      clump: 0.22, scale: 1.0, lean: 1.05, droop: 0.5,
      spacing: 7.5, chance: 0.5, leaves: 120
    },
    leaf: defineSpecies({
      name: 'sage leaf',
      height: 0.20, heightVar: 0.3,
      width: 0.008, widthVar: 0.3,
      shoulder: 0.3, taper: 1.3, tipWidth: 0.12,
      keel: 0.5, keelFalloff: 1.2,
      twist: 0.4, twistVar: 0.9,
      droop: 0.35, droopVar: 0.8, stiffness: 0.62, curl: 0.2,
      lamina: '#727a66', tip: '#7f836e', tipBlend: 0.22,
      sheath: '#68715c', sheathBlend: 0.18,
      colorVar: 0.32,
      roughness: 1.25, translucency: 0.55, aoBase: 0.22, sheen: 0.4,
      edgeJitter: 0.13, edgeFreq: 28, asymmetry: 0.15, damage: 0.25,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 0,
      sway: 0.6
    })
  },

  fernCluster: {
    name: 'Fern Cluster',
    note: 'Narrow lanceolate pinnae on long arching fronds; very translucent.',
    shrub: {
      clump: 0.18, scale: 1.0, lean: 1.35, droop: 0.6,
      spacing: 5.5, chance: 0.45, leaves: 110
    },
    leaf: defineSpecies({
      name: 'pinna',
      height: 0.42, heightVar: 0.4,
      width: 0.011, widthVar: 0.25,
      shoulder: 0.22, taper: 1.5, tipWidth: 0.05,
      keel: 0.3, keelFalloff: 1.5,
      twist: 0.35, twistVar: 0.5,
      droop: 0.45, droopVar: 0.5, stiffness: 0.4, curl: 0.3,
      lamina: '#4a7a2c', tip: '#588733', tipBlend: 0.22,
      sheath: '#517d2e', sheathBlend: 0.16,
      colorVar: 0.45,
      roughness: 0.85, translucency: 1.6, aoBase: 0.18, sheen: 0.22,
      edgeJitter: 0.22, edgeFreq: 16, asymmetry: 0.1, damage: 0.2,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 1,
      sway: 1.1
    })
  },

  heatherScrub: {
    name: 'Heather Scrub',
    note: 'Tiny needle leaves packed on woody twigs, purple-flushed tips.',
    shrub: {
      clump: 0.20, scale: 1.0, lean: 1.15, droop: 0.42,
      spacing: 4.5, chance: 0.6, leaves: 140
    },
    leaf: defineSpecies({
      name: 'heather leaf',
      height: 0.155, heightVar: 0.35,
      width: 0.0022, widthVar: 0.3,
      shoulder: 0.15, taper: 1.8, tipWidth: 0.15,
      keel: 0.9, keelFalloff: 0.8,
      twist: 0.2, twistVar: 0.9,
      droop: 0.25, droopVar: 0.9, stiffness: 0.75, curl: 0.1,
      lamina: '#3b5230', tip: '#57424f', tipBlend: 0.24,
      sheath: '#43502f', sheathBlend: 0.18,
      colorVar: 0.5,
      roughness: 1.1, translucency: 0.6, aoBase: 0.2, sheen: 0.3,
      edgeJitter: 0.1, edgeFreq: 32, asymmetry: 0.1, damage: 0.3,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 3,
      sway: 0.5
    })
  },

  pampasGrass: {
    name: 'Pampas Grass',
    note: 'Tall upright tussock throwing cream flower spikes well clear of the foliage.',
    shrub: {
      clump: 0.20, scale: 1.0, lean: 1.05, droop: 0.22,
      spacing: 9.0, chance: 0.4, leaves: 150,
      plume: 0.17, plumeHeight: 1.9, plumeWidth: 0.6, plumeLean: 0.22,
      plumeTint: '#ded0ab'
    },
    leaf: defineSpecies({
      name: 'pampas blade',
      height: 0.74, heightVar: 0.3,
      width: 0.010, widthVar: 0.28,
      shoulder: 0.12, taper: 1.9, tipWidth: 0.03,
      keel: 0.7, keelFalloff: 1.0,
      twist: 0.7, twistVar: 0.7,
      droop: 0.3, droopVar: 0.6, stiffness: 0.62, curl: 0.15,
      lamina: '#4e7a34', tip: '#6d8f3f', tipBlend: 0.3,
      sheath: '#5b8038', sheathBlend: 0.16,
      colorVar: 0.34,
      roughness: 0.82, translucency: 1.15, aoBase: 0.2, sheen: 0.45,
      edgeJitter: 0.1, edgeFreq: 30, asymmetry: 0.1, damage: 0.18,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 0,
      sway: 0.95
    })
  },

  fountainGrass: {
    name: 'Fountain Grass',
    note: 'Fine blades arching hard from a tight crown, with small tan spikelets.',
    shrub: {
      clump: 0.15, scale: 1.0, lean: 1.6, droop: 0.4,
      spacing: 6.5, chance: 0.5, leaves: 140,
      plume: 0.10, plumeHeight: 1.45, plumeWidth: 0.7, plumeLean: 0.75,
      plumeTint: '#c9b189'
    },
    leaf: defineSpecies({
      name: 'fountain blade',
      height: 0.52, heightVar: 0.34,
      width: 0.0065, widthVar: 0.3,
      shoulder: 0.1, taper: 2.1, tipWidth: 0.02,
      keel: 0.85, keelFalloff: 0.9,
      twist: 0.8, twistVar: 0.8,
      droop: 0.5, droopVar: 0.7, stiffness: 0.34, curl: 0.28,
      lamina: '#54803a', tip: '#7d9550', tipBlend: 0.34,
      sheath: '#5d8440', sheathBlend: 0.15,
      colorVar: 0.4,
      roughness: 0.8, translucency: 1.35, aoBase: 0.18, sheen: 0.5,
      edgeJitter: 0.12, edgeFreq: 34, asymmetry: 0.12, damage: 0.22,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 1,
      sway: 1.25
    })
  },

  sedgeTuft: {
    name: 'Sedge Tuft',
    note: 'Stiff triangular blades standing almost straight up from a tight base.',
    shrub: {
      clump: 0.10, scale: 1.0, lean: 0.38, droop: 0.14,
      spacing: 4.0, chance: 0.6, leaves: 90
    },
    leaf: defineSpecies({
      name: 'sedge blade',
      height: 0.37, heightVar: 0.3,
      width: 0.0075, widthVar: 0.25,
      shoulder: 0.08, taper: 2.4, tipWidth: 0.02,
      keel: 1.15, keelFalloff: 0.7,
      twist: 0.25, twistVar: 0.5,
      droop: 0.12, droopVar: 0.5, stiffness: 0.82, curl: 0.05,
      lamina: '#3f6b2e', tip: '#537f36', tipBlend: 0.24,
      sheath: '#496f30', sheathBlend: 0.16,
      colorVar: 0.3,
      roughness: 0.9, translucency: 1.0, aoBase: 0.2, sheen: 0.35,
      edgeJitter: 0.07, edgeFreq: 38, asymmetry: 0.08, damage: 0.16,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 3,
      sway: 0.5
    })
  },

  rushClump: {
    name: 'Rush Clump',
    note: 'Thin dark cylinders, nearly vertical — wet ground and ditch margins.',
    shrub: {
      clump: 0.085, scale: 1.0, lean: 0.26, droop: 0.1,
      spacing: 3.6, chance: 0.55, leaves: 80
    },
    leaf: defineSpecies({
      name: 'rush stem',
      height: 0.50, heightVar: 0.32,
      width: 0.0045, widthVar: 0.2,
      shoulder: 0.05, taper: 2.8, tipWidth: 0.03,
      keel: 1.5, keelFalloff: 0.5,
      twist: 0.1, twistVar: 0.4,
      droop: 0.1, droopVar: 0.6, stiffness: 0.88, curl: 0.04,
      lamina: '#2f5730', tip: '#436a34', tipBlend: 0.2,
      sheath: '#375f31', sheathBlend: 0.14,
      colorVar: 0.26,
      roughness: 0.72, translucency: 0.8, aoBase: 0.22, sheen: 0.55,
      edgeJitter: 0.05, edgeFreq: 40, asymmetry: 0.06, damage: 0.12,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 2,
      sway: 0.7
    })
  },

  cloverPatch: {
    name: 'Clover Patch',
    note: 'Round leaflets on short stalks, spreading flat and wide over the sward.',
    shrub: {
      clump: 0.33, scale: 1.0, lean: 1.45, droop: 0.72,
      spacing: 3.2, chance: 0.65, leaves: 110
    },
    leaf: defineSpecies({
      name: 'clover leaflet',
      height: 0.105, heightVar: 0.3,
      width: 0.026, widthVar: 0.28,
      shoulder: 0.52, taper: 0.75, tipWidth: 0.5,
      keel: 0.2, keelFalloff: 1.9,
      twist: 0.35, twistVar: 0.8,
      droop: 0.55, droopVar: 0.6, stiffness: 0.42, curl: -0.3,
      lamina: '#3f6f2b', tip: '#4b7d31', tipBlend: 0.16,
      sheath: '#4a7430', sheathBlend: 0.2,
      colorVar: 0.36,
      roughness: 0.6, translucency: 1.45, aoBase: 0.24, sheen: 0.28,
      edgeJitter: 0.06, edgeFreq: 18, asymmetry: 0.1, damage: 0.24,
      biome: 0.5, biomeWidth: 2.0, weight: 1.0, texVariant: 2,
      sway: 0.65
    })
  }
};

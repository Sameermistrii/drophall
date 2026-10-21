/**
 * Scenes bundle a species mix with the lighting and weather it was authored
 * under. A profile only reads correctly inside the environment it belongs to —
 * cured savanna straw under overcast sky just looks like a bug.
 *
 * All species in a scene share one draw call per LOD ring. Adding a fifth
 * species costs you nothing but uniform slots.
 *
 * A `species` entry is either a profile name, or `[name, overrides]`. The same
 * plant grows differently in different places — a grass that reaches 70 cm on
 * a prairie is a 25 cm cushion above the treeline — and `weight` / `biome` /
 * `biomeWidth` are what decide where in the biome field it wins. Overriding
 * here keeps one honest profile per species instead of five near-duplicates.
 */
export function resolveSpecies(entry, SPECIES) {
  if (typeof entry === 'string') return SPECIES[entry];
  const [key, over] = entry;
  return { ...SPECIES[key], ...over };
}

export const SCENES = {
  meadow: {
    label: 'Temperate Meadow',
    blurb: 'Four species mixed by a biome field: fescue on the dry rises, rye and timothy in the body, clover in the hollows.',
    species: ['fescueLawn', 'ryegrassPasture', 'timothyMeadow', 'cloverPatch'],
    shrub: 'broadleafShrub',
    grass: { density: 1.0, heightScale: 1.0, tuftRadius: 0.16, dryness: 0.22 },
    field: { relief: 1.0, pathWidth: 1.6, biomeWavelength: 46 },
    wind: { strength: 0.34, speed: 1.0, frequency: 1.5, gustiness: 0.55, direction: 0.6 },
    sun: { elevation: 26, azimuth: 118, intensity: 3.4, tint: '#fff0d8' },
    sky: { zenith: '#5b8fd6', horizon: '#bcd2e8', ground: '#5c5442', ambient: 0.85 },
    fog: { color: '#b9cadb', sunColor: '#ffe3b4', density: 0.0055, heightFalloff: 0.018 },
    clouds: { strength: 0.45, scale: 210 },
    exposure: 1.0
  },

  prairie: {
    label: 'Late-Summer Prairie',
    blurb: 'Tall bunchgrass going over to bronze, with cured straw between the clumps. Long blades, big gusts, low sun.',
    species: ['prairieBluestem', 'savannaStraw', 'timothyMeadow', 'fescueLawn'],
    shrub: 'sageBush',
    grass: { density: 0.72, heightScale: 1.1, tuftRadius: 0.26, dryness: 0.68 },
    field: { relief: 1.25, pathWidth: 0.0, biomeWavelength: 72 },
    wind: { strength: 0.62, speed: 1.5, frequency: 1.25, gustiness: 0.85, direction: 2.1 },
    sun: { elevation: 12, azimuth: 255, intensity: 4.2, tint: '#ffcb8c' },
    sky: { zenith: '#3f6ea8', horizon: '#e2b184', ground: '#6b543a', ambient: 0.62 },
    fog: { color: '#d9b98f', sunColor: '#ffd39a', density: 0.0082, heightFalloff: 0.014 },
    clouds: { strength: 0.3, scale: 320 },
    exposure: 0.95
  },

  marsh: {
    label: 'Overcast Marsh',
    blurb: 'Rigid triangular sedge in standing wet ground. Flat light, so all the shape has to come from the keel and the geometry.',
    species: ['sedgeMarsh', 'timothyMeadow', 'ryegrassPasture'],
    shrub: 'fernCluster',
    grass: { density: 0.92, heightScale: 1.0, tuftRadius: 0.2, dryness: 0.10 },
    field: { relief: 0.55, pathWidth: 0.0, biomeWavelength: 38 },
    wind: { strength: 0.22, speed: 0.7, frequency: 1.1, gustiness: 0.3, direction: 4.0 },
    sun: { elevation: 42, azimuth: 200, intensity: 1.25, tint: '#e6ecf2' },
    sky: { zenith: '#8fa2b4', horizon: '#c3ccd4', ground: '#4a4f45', ambient: 1.5 },
    fog: { color: '#b6c1c9', sunColor: '#cfd8de', density: 0.014, heightFalloff: 0.03 },
    clouds: { strength: 0.12, scale: 260 },
    exposure: 1.1
  },

  alpine: {
    label: 'Alpine Cushion',
    blurb: 'Short wiry tussock on broken ground at altitude. Hard sun, thin air, almost no aerial haze.',
    species: [
      // Tussock dominates the whole biome range up here.
      ['alpineTussock', { biome: 0.5, biomeWidth: 0.55, weight: 2.4 }],
      ['fescueLawn', { biome: 0.3, biomeWidth: 0.3, weight: 0.9, height: 0.10 }],
      // Last year's growth, stunted by altitude and confined to the dry crests.
      ['savannaStraw', { biome: 0.9, biomeWidth: 0.16, weight: 0.45, height: 0.24, droop: 0.9, damage: 0.75 }]
    ],
    shrub: 'heatherScrub',
    grass: { density: 0.85, heightScale: 0.95, tuftRadius: 0.11, dryness: 0.42 },
    field: { relief: 1.9, pathWidth: 1.1, biomeWavelength: 30 },
    wind: { strength: 0.5, speed: 1.8, frequency: 2.1, gustiness: 0.9, direction: 5.2 },
    sun: { elevation: 58, azimuth: 150, intensity: 4.8, tint: '#fff6ea' },
    sky: { zenith: '#2f68c4', horizon: '#a9c6e6', ground: '#5e5b52', ambient: 0.75 },
    fog: { color: '#c6d8ea', sunColor: '#ffeccd', density: 0.0022, heightFalloff: 0.008 },
    clouds: { strength: 0.55, scale: 150 },
    exposure: 0.9
  },

  lawn: {
    label: 'Kept Lawn',
    blurb: 'Mown turf: nearly every tip is cut flat. Dense, short, uniform — the case where sub-pixel aliasing bites hardest.',
    species: ['fescueLawn', 'ryegrassPasture', 'cloverPatch'],
    shrub: 'broadleafShrub',
    grass: { density: 1.35, heightScale: 0.62, tuftRadius: 0.09, dryness: 0.14 },
    field: { relief: 0.35, pathWidth: 2.4, biomeWavelength: 26 },
    wind: { strength: 0.16, speed: 0.9, frequency: 1.8, gustiness: 0.35, direction: 1.2 },
    sun: { elevation: 48, azimuth: 95, intensity: 3.8, tint: '#fff3e0' },
    sky: { zenith: '#4f86d0', horizon: '#c4d8ec', ground: '#55503f', ambient: 0.95 },
    fog: { color: '#c2d3e2', sunColor: '#ffe8c0', density: 0.004, heightFalloff: 0.02 },
    clouds: { strength: 0.35, scale: 190 },
    exposure: 1.0
  }
};

/**
 * Quality tiers. One `rings` entry == one draw call, forever, regardless of how
 * large the world is.
 *
 * The ladder is built around a simple rule: blade density falls roughly as
 * 1/d^1.5 while blade width grows as d^0.75. Density alone would leave the
 * distance bald; width alone would turn it into a carpet. What the two together
 * cannot cover is picked up by the terrain shader, which paints the same sward
 * colour and tuft breakup underneath — so the geometry only ever has to supply
 * silhouette, never coverage.
 *
 * Ring radii are derived from `grid * cellSize / 2`, so a ring can never ask
 * for blades outside the cells it actually allocated.
 */
export const QUALITY = {
  low: {
    label: 'Low',
    variants: 2,
    bladeTex: 256,
    fieldTex: 512,
    shadow: 0,
    minPixels: 1.4,
    rings: [
      { segments: 4, cellSize: 0.26, grid: 44, perCell: 10, perTuft: 8, widthBoost: 1.0 },
      { segments: 2, cellSize: 0.85, grid: 42, perCell: 13, perTuft: 7, widthBoost: 1.18 },
      { segments: 1, cellSize: 3.20, grid: 34, perCell: 14, perTuft: 6, widthBoost: 1.5 }
    ]
  },
  medium: {
    label: 'Medium',
    variants: 4,
    bladeTex: 384,
    fieldTex: 1024,
    shadow: 1024,
    minPixels: 1.25,
    rings: [
      { segments: 5, cellSize: 0.21, grid: 54, perCell: 11, perTuft: 8, widthBoost: 1.0 },
      { segments: 3, cellSize: 0.55, grid: 50, perCell: 14, perTuft: 7, widthBoost: 1.12 },
      { segments: 2, cellSize: 1.55, grid: 46, perCell: 15, perTuft: 6, widthBoost: 1.28 },
      { segments: 1, cellSize: 5.00, grid: 34, perCell: 13, perTuft: 5, widthBoost: 1.6 }
    ]
  },
  high: {
    label: 'High',
    variants: 4,
    bladeTex: 512,
    fieldTex: 1024,
    shadow: 2048,
    minPixels: 1.15,
    rings: [
      { segments: 7, cellSize: 0.17, grid: 60, perCell: 12, perTuft: 8, widthBoost: 1.0 },
      { segments: 5, cellSize: 0.42, grid: 56, perCell: 16, perTuft: 8, widthBoost: 1.10 },
      { segments: 3, cellSize: 1.10, grid: 52, perCell: 16, perTuft: 7, widthBoost: 1.22 },
      { segments: 2, cellSize: 3.20, grid: 46, perCell: 15, perTuft: 6, widthBoost: 1.4 },
      { segments: 1, cellSize: 9.00, grid: 36, perCell: 13, perTuft: 5, widthBoost: 1.7 }
    ]
  },
  ultra: {
    label: 'Ultra',
    variants: 6,
    bladeTex: 512,
    fieldTex: 2048,
    shadow: 2048,
    minPixels: 1.0,
    rings: [
      { segments: 8, cellSize: 0.135, grid: 70, perCell: 13, perTuft: 9, widthBoost: 1.0 },
      { segments: 6, cellSize: 0.34, grid: 64, perCell: 18, perTuft: 9, widthBoost: 1.08 },
      { segments: 4, cellSize: 0.90, grid: 60, perCell: 19, perTuft: 8, widthBoost: 1.18 },
      { segments: 3, cellSize: 2.50, grid: 54, perCell: 18, perTuft: 7, widthBoost: 1.35 },
      { segments: 2, cellSize: 7.00, grid: 44, perCell: 15, perTuft: 6, widthBoost: 1.6 },
      { segments: 1, cellSize: 20.0, grid: 34, perCell: 12, perTuft: 5, widthBoost: 2.0 }
    ]
  }
};

/** Half-extent, in metres, that a ring's allocated cells actually cover. */
export function ringExtent(r) {
  return r.grid * r.cellSize * 0.5;
}

/**
 * Blades per square metre a ring is allocated at.
 *
 * Rings hold a roughly constant instance count, so this falls as the square of
 * the radius — 415/m² under your feet against 0.16/m² at the horizon. That is
 * the ladder the continuous LOD in the blade shader has to smooth out.
 */
export function ringDensity(r) {
  return r.perCell / (r.cellSize * r.cellSize);
}

/** What a tier costs, before anything is allocated. */
export function ringBudget(quality) {
  const rings = QUALITY[quality].rings;
  let instances = 0, tris = 0;
  for (const r of rings) {
    const n = r.grid * r.grid * r.perCell;
    instances += n;
    tris += n * r.segments * 2;
  }
  return {
    instances,
    tris,
    drawCalls: rings.length,
    radius: ringExtent(rings[rings.length - 1])
  };
}

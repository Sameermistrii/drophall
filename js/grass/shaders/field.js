/**
 * The "field" is the one source of truth for the ground: height, slope, soil
 * mask and biome value. Terrain mesh, grass placement, bush placement and the
 * CPU-side collision probe all read the exact same function, so blades can
 * never float or sink relative to the ground they stand on.
 *
 * Everything is packed into a single tiling RGBA16F texture (`uFieldTex`), baked
 * once at start-up, so the whole lookup costs one bilinear fetch in the vertex
 * shader. Analytic gradients are baked alongside the height, which means we get
 * an exact surface normal without the three extra taps a finite-difference
 * normal would need.
 */

export const GLSL_FIELD = /* glsl */ `
#ifndef GLAB_FIELD
#define GLAB_FIELD

uniform sampler2D uFieldTex;
// x: tile size in metres, y: unused, z: biome wavelength, w: soil-mask bias
uniform vec4 uFieldParams;

struct Ground {
  float h;        // world height in metres
  vec3  n;        // unit surface normal
  float slope;    // 0 = flat, 1 = vertical
  float soil;     // 0 = bare earth, 1 = fully vegetated
};

// R = height (m), G = dH/dx, B = dH/dz, A = soil mask
vec4 fieldTap(vec2 p){
  return textureLod(uFieldTex, p / uFieldParams.x, 0.0);
}

float groundHeight(vec2 p){
  return fieldTap(p).r;
}

Ground sampleGround(vec2 p){
  vec4 f = fieldTap(p);
  Ground g;
  g.h = f.r;
  g.n = normalize(vec3(-f.g, 1.0, -f.b));
  g.slope = sat(1.0 - g.n.y);
  g.soil = sat(f.a + uFieldParams.w);
  return g;
}

// Slowly varying value that decides which species dominate where. Two taps at
// different wavelengths and rotations so the mix never looks like a grid.
float biomeValue(vec2 p){
  float w = uFieldParams.z;
  float a = noiseTapUV(rot2(p, 0.37) / w).r;
  float b = noiseTapUV(rot2(p, -1.94) / (w * 0.41)).b;
  return sat(a * 0.72 + b * 0.28);
}

// Local patchiness: real swards thin out and thicken over a few metres rather
// than sitting at one uniform density.
float patchiness(vec2 p){
  vec4 n = noiseTapUV(rot2(p, 0.91) / 11.0);
  return sat(n.r * 0.65 + n.a * 0.35);
}

#endif
`;

/* --------------------------------------------------------------------------
 * CPU mirror. Reads back the same baked texture so gameplay code (camera
 * collision, the demo walker) agrees with what the GPU draws.
 * ------------------------------------------------------------------------ */

export class FieldSampler {
  /**
   * @param {Float32Array} data RGBA float data, row-major, size*size*4
   * @param {number} size       texture resolution
   * @param {number} tileMetres world size of one tile
   */
  constructor(data, size, tileMetres) {
    this.data = data;
    this.size = size;
    this.tile = tileMetres;

    // The vertical span of the whole world, which lets the grass shader reject
    // an instance against the frustum knowing only its XZ — before it has spent
    // a texture fetch finding out how tall the ground is there.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < lo) lo = data[i];
      if (data[i] > hi) hi = data[i];
    }
    this.heightRange = [lo, hi];
  }

  /** Bilinear tap matching GL's LINEAR + REPEAT filtering. */
  _tap(x, z, out) {
    const S = this.size;
    let u = (x / this.tile) * S - 0.5;
    let v = (z / this.tile) * S - 0.5;
    let x0 = Math.floor(u), z0 = Math.floor(v);
    const fx = u - x0, fz = v - z0;
    x0 = ((x0 % S) + S) % S;
    z0 = ((z0 % S) + S) % S;
    const x1 = (x0 + 1) % S, z1 = (z0 + 1) % S;
    const d = this.data;
    const i00 = (z0 * S + x0) * 4, i10 = (z0 * S + x1) * 4;
    const i01 = (z1 * S + x0) * 4, i11 = (z1 * S + x1) * 4;
    const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz, w11 = fx * fz;
    for (let c = 0; c < 4; c++) {
      out[c] = d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11;
    }
    return out;
  }

  height(x, z) {
    return this._tap(x, z, FieldSampler._t)[0];
  }

  /** @returns {{h:number, nx:number, ny:number, nz:number, soil:number}} */
  ground(x, z) {
    const t = this._tap(x, z, FieldSampler._t);
    const nx = -t[1], nz = -t[2];
    const len = Math.hypot(nx, 1, nz);
    return { h: t[0], nx: nx / len, ny: 1 / len, nz: nz / len, soil: t[3] };
  }
}
FieldSampler._t = new Float32Array(4);

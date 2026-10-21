import * as THREE from 'three';
import { BLADE_VERT, BLADE_FRAG, BLADE_DEPTH_FRAG } from '../shaders/blade.js';
import { packSpecies } from '../profiles/profiles.js';
import { ringExtent, ringDensity } from '../profiles/scenes.js';

/**
 * What the outermost ring thins down to at its rim. It has no successor to hand
 * over to, so instead of ending at a hard edge it dissolves into the fog.
 */
const TAIL_RATIO = 0.08;

/**
 * A field of blades.
 *
 * Grass and shrubs are the same object with a different placement rule, so both
 * go through this class. Each LOD ring is exactly one instanced draw call and
 * holds no per-instance buffers at all — the whole population is a pure
 * function of (world cell, instance index, seed), evaluated in the vertex
 * shader. Consequences worth stating plainly:
 *
 *   - world size costs nothing: moving the camera writes two integers
 *   - there is no streaming, no pooling, no popping from chunk loads
 *   - VRAM is a handful of KB of geometry, regardless of map area
 *   - the same seed always regrows the same field, on every machine
 */
export class BladeField {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {object} o.shared           uniforms shared with the rest of the scene
   * @param {Array}  o.rings            LOD ladder from QUALITY
   * @param {Array}  o.species          species profile objects
   * @param {number} o.variants         blade texture atlas depth
   * @param {'grass'|'bush'} [o.mode]
   * @param {object} [o.shrub]          skeleton config when mode === 'bush'
   * @param {number} [o.fadeBand]
   */
  constructor(o) {
    this.mode = o.mode || 'grass';
    this.isBush = this.mode === 'bush';
    this.species = o.species;
    this.variants = o.variants;
    this.fadeBand = o.fadeBand ?? (this.isBush ? 6 : 2.5);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.rings = [];
    this._planes = [
      new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(),
      new THREE.Vector4(), new THREE.Vector4()
    ];
    this._shadowPlanes = this._planes.map(() => new THREE.Vector4());
    this._frustum = new THREE.Frustum();
    this._mat4 = new THREE.Matrix4();

    // Shrubs thin themselves by leaf priority already, so the ring-level curve
    // is a grass-only affair.
    this._smoothLod = this.isBush ? false : (o.smoothLod ?? true);
    this._lodShape = o.lodShape ?? 2.4;

    this.uniforms = this._buildUniforms(o);
    this._buildRings(o.rings, o.shrub);
  }

  /* ------------------------------------------------------------ uniforms -- */

  _buildUniforms(o) {
    const packed = packSpecies(this.species);
    const colliders = [];
    for (let i = 0; i < 8; i++) colliders.push(new THREE.Vector4(0, 0, 0, 0));

    const own = {
      uSp: { value: packed },
      uColliders: { value: colliders },
      uColliderCount: { value: 0 },
      uCullPlanes: { value: this._planes },
      uSeed: { value: 1337 },
      uDensity: { value: 1 },
      uHeightScale: { value: 1 },
      uTuftRadius: { value: 0.16 },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWind: { value: new THREE.Vector4(0.35, 1, 1.5, 0.55) },
      uWindScale: { value: 42 },
      uScreen: { value: new THREE.Vector2(0.0012, 1.15) },
      // World height band plus the tallest plant, so an instance can be
      // frustum-rejected from its XZ alone — before it pays for a ground
      // sample it may not need.
      uColumn: { value: new THREE.Vector3(-30, 30, 2) }
    };
    if (this.isBush) {
      // Every model travels in the same field; a cell picks one by weight. The
      // ring allocates the largest leaf count and each model drops its surplus
      // in the shader, so mixing costs one draw call, not one per model.
      const defs = o.shrubs.map((d) => d.shrub);
      const maxLeaves = Math.max(...defs.map((s) => s.leaves));
      const A = [], B = [], C = [], T = [];
      for (const s of defs) {
        A.push(new THREE.Vector4(s.clump, s.scale ?? 1, s.lean ?? 0.9, s.droop ?? 0.3));
        B.push(new THREE.Vector4(
          s.leaves / maxLeaves, s.weight ?? 1, s.plume ?? 0, s.plumeHeight ?? 1.8
        ));
        C.push(new THREE.Vector4(s.plumeWidth ?? 0.45, s.plumeLean ?? 0.3, 0, 0));
        T.push(new THREE.Color(s.plumeTint ?? '#d9cca8'));
      }
      own.uBushA = { value: A };
      own.uBushB = { value: B };
      own.uBushC = { value: C };
      own.uBushTint = { value: T };
      own.uBushChance = { value: o.shrubChance ?? 0.5 };
      own.uLeafLod = { value: new THREE.Vector2(14, 55) };
      this.maxLeaves = maxLeaves;
    }
    return { ...o.shared, ...own };
  }

  /* -------------------------------------------------------------- rings -- */

  /**
   * A blade is a flat strip: `segments + 1` rows of two vertices. All of the
   * shape — taper, keel, twist, bend — is added in the vertex shader, so this
   * geometry is shared by every species and every instance.
   */
  _bladeGeometry(segments, instanceCount) {
    const rows = segments + 1;
    const pos = new Float32Array(rows * 2 * 3);
    for (let i = 0; i < rows; i++) {
      const t = i / segments;
      pos[i * 6 + 0] = -1; pos[i * 6 + 1] = t; pos[i * 6 + 2] = 0;
      pos[i * 6 + 3] = 1; pos[i * 6 + 4] = t; pos[i * 6 + 5] = 0;
    }
    const idx = [];
    for (let i = 0; i < segments; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.instanceCount = instanceCount;
    // The vertex shader scatters instances all over the world, so three must
    // never try to cull this by its (meaningless) local bounds.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1e7, -1e7, -1e7), new THREE.Vector3(1e7, 1e7, 1e7)
    );
    return g;
  }

  _buildRings(ringDefs, shrub) {
    const defines = {
      NUM_SPECIES: this.species.length,
      VARIANTS: this.variants
    };
    if (this.isBush) defines.BUSH = '';

    let inner = -1;
    for (let i = 0; i < ringDefs.length; i++) {
      const def = ringDefs[i];
      const outer = ringExtent(def) * 0.98;
      const count = def.grid * def.grid * def.perCell;
      const lodBlend = ringDefs.length > 1 ? i / (ringDefs.length - 1) : 0;

      // Thinned down to whatever the next ring is allocated at, so the two
      // agree on blades per square metre where they meet and the seam stops
      // being a step. Never above 1: a ring is only ever asked to thin out.
      const next = ringDefs[i + 1];
      const ratio = next
        ? Math.min(1, ringDensity(next) / ringDensity(def))
        : TAIL_RATIO;

      const perRing = {
        uCamCell: { value: new Int32Array(2) },
        uCellSize: { value: def.cellSize },
        uGrid: { value: def.grid },
        uPerCell: { value: def.perCell },
        uPerTuft: { value: def.perTuft },
        uRing: { value: new THREE.Vector4(inner, outer, this.fadeBand, def.widthBoost) },
        uThin: {
          value: new THREE.Vector3(
            Math.max(ratio, 0.02), this._smoothLod ? 1 : 0, this._lodShape
          )
        },
        uLodBlend: { value: lodBlend }
      };

      const uniforms = { ...this.uniforms, ...perRing };
      const mat = new THREE.ShaderMaterial({
        vertexShader: BLADE_VERT,
        fragmentShader: BLADE_FRAG,
        uniforms,
        defines,
        side: THREE.DoubleSide,
        dithering: true
      });

      // The shadow caster shares every uniform except the cull planes, which
      // must describe the light's frustum instead of the camera's.
      const depthMat = new THREE.ShaderMaterial({
        vertexShader: BLADE_VERT,
        fragmentShader: BLADE_DEPTH_FRAG,
        uniforms: { ...uniforms, uCullPlanes: { value: this._shadowPlanes } },
        defines,
        side: THREE.DoubleSide,
        colorWrite: false
      });

      const geo = this._bladeGeometry(def.segments, count);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = i;

      this.group.add(mesh);
      this.rings.push({
        def, mesh, mat, depthMat, uniforms: perRing, count,
        inner, outer,
        tris: count * def.segments * 2
      });
      inner = outer;
    }
    this.radius = inner;
  }

  /* ------------------------------------------------------------- updates -- */

  /** Cheap enough to call every frame: two integers per ring. */
  update(camera, viewportHeight) {
    const p = camera.position;
    for (const r of this.rings) {
      const c = r.uniforms.uCamCell.value;
      c[0] = Math.floor(p.x / r.def.cellSize);
      c[1] = Math.floor(p.z / r.def.cellSize);
    }
    if (viewportHeight) {
      // Metres of world per pixel, per metre of depth. Feeding the real
      // viewport in means the blade width floor tracks resolution and FOV
      // instead of being a magic number tuned for one monitor.
      const fov = THREE.MathUtils.degToRad(camera.fov);
      this.uniforms.uScreen.value.x = (2 * Math.tan(fov * 0.5)) / viewportHeight;
    }
    this._extractPlanes(camera, this._planes);
  }

  /**
   * Vertical extent the placement can occupy: the terrain's height range,
   * widened by the tallest species. Used only by the early cull.
   */
  setColumn(yMin, yMax) {
    let tallest = 0;
    for (const s of this.species) tallest = Math.max(tallest, s.height * (1 + s.heightVar));
    this.uniforms.uColumn.value.set(yMin, yMax, tallest * 2.0);
  }

  /** Minimum on-screen blade width, in pixels. */
  setMinPixels(px) {
    this.uniforms.uScreen.value.y = px;
  }

  /**
   * How much of each shrub model the mix contains, by name order of the list
   * the field was built with. Zero drops a model without a rebuild.
   */
  setShrubMix(weights) {
    if (!this.isBush) return;
    const B = this.uniforms.uBushB.value;
    for (let i = 0; i < B.length; i++) B[i].y = Math.max(0, weights[i] ?? 0);
  }

  /** Overall chance a cell grows anything at all. */
  setShrubChance(v) {
    if (!this.isBush) return;
    this.uniforms.uBushChance.value = v;
  }

  /** Off restores the old behaviour: constant density inside each ring. */
  setSmoothLod(on) {
    if (this.isBush) return;
    this._smoothLod = !!on;
    for (const r of this.rings) r.uniforms.uThin.value.y = this._smoothLod ? 1 : 0;
  }

  /**
   * Where each ring spends its thinning. 1 spreads it evenly across the ring;
   * higher values hold full density near the camera and drop late.
   */
  setLodShape(k) {
    this._lodShape = k;
    for (const r of this.rings) r.uniforms.uThin.value.z = k;
  }

  updateShadowPlanes(lightCamera) {
    this._extractPlanes(lightCamera, this._shadowPlanes);
  }

  _extractPlanes(camera, out) {
    this._mat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._mat4);
    // three's order is [right, left, bottom, top, far, near]; the near plane is
    // the one we must not use — grass right at the camera would vanish.
    for (let i = 0; i < 5; i++) {
      const pl = this._frustum.planes[i];
      out[i].set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant);
    }
  }

  setColliders(list) {
    const u = this.uniforms.uColliders.value;
    const n = Math.min(list.length, 8);
    for (let i = 0; i < n; i++) {
      u[i].set(list[i].x, list[i].y, list[i].z, list[i].radius);
    }
    this.uniforms.uColliderCount.value = n;
  }

  setWind(w) {
    this.uniforms.uWindDir.value.set(Math.cos(w.direction), Math.sin(w.direction));
    this.uniforms.uWind.value.set(w.strength, w.speed, w.frequency, w.gustiness);
  }

  setTuning({ density, heightScale, tuftRadius, seed }) {
    if (density !== undefined) this.uniforms.uDensity.value = density;
    if (heightScale !== undefined) this.uniforms.uHeightScale.value = heightScale;
    if (tuftRadius !== undefined) this.uniforms.uTuftRadius.value = tuftRadius;
    if (seed !== undefined) this.uniforms.uSeed.value = seed;
  }

  /** Swaps the material on every ring for the shadow pass, and back after. */
  beginShadowPass() {
    for (const r of this.rings) r.mesh.material = r.depthMat;
  }
  endShadowPass() {
    for (const r of this.rings) r.mesh.material = r.mat;
  }

  setVisible(v) { this.group.visible = v; }

  get stats() {
    return {
      drawCalls: this.rings.length,
      instances: this.rings.reduce((a, r) => a + r.count, 0),
      tris: this.rings.reduce((a, r) => a + r.tris, 0),
      radius: this.radius
    };
  }

  dispose() {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mat.dispose();
      r.depthMat.dispose();
    }
    this.group.clear();
    this.rings.length = 0;
  }
}

import * as THREE from 'three';
import { FS_QUAD_VERT, TAA_RESOLVE_FRAG, TAA_OUTPUT_FRAG } from '../shaders/taa.js';

/** Halton sequence — low discrepancy, so a short history covers the pixel evenly. */
function halton(index, base) {
  let f = 1, r = 0, i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/**
 * Temporal antialiasing: jitter, accumulate, resolve.
 *
 * Three buffers and two extra full-screen passes. The scene renders into an
 * HDR target with a second attachment for motion vectors, the resolve blends it
 * against the previous frame's result, and the output pass does tone mapping and
 * encoding once at the end.
 *
 * Tone mapping deliberately happens *after* accumulation. Accumulating already
 * tone-mapped colour bakes the curve into the history and makes the result
 * depend on how fast the camera is moving; accumulating raw HDR and mapping at
 * the end keeps a still frame and a moving frame the same brightness.
 */
export class Temporal {
  constructor(renderer, { samples = 8, feedback = 0.9, varianceGamma = 1.25, sharpen = 0.35 } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.frame = 0;
    this.reset = true;

    this.jitterScale = 1.0;
    this.samples = samples;
    this.jitter = new THREE.Vector2();
    this._offsets = [];
    for (let i = 1; i <= samples; i++) {
      this._offsets.push(new THREE.Vector2(halton(i, 2) - 0.5, halton(i, 3) - 0.5));
    }

    this.viewProj = new THREE.Matrix4();
    this.viewProjPrev = new THREE.Matrix4();
    this.camPosPrev = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.resolveMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VERT,
      fragmentShader: TAA_RESOLVE_FRAG,
      uniforms: {
        uScene: { value: null },
        uVelocity: { value: null },
        uHistory: { value: null },
        uTexSize: { value: new THREE.Vector2() },
        uFeedback: { value: feedback },
        uVarianceGamma: { value: varianceGamma },
        uReset: { value: 1 }
      },
      depthTest: false,
      depthWrite: false
    });

    this.outputMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_VERT,
      fragmentShader: TAA_OUTPUT_FRAG,
      uniforms: {
        uTex: { value: null },
        uTexSize: { value: new THREE.Vector2() },
        uSharpen: { value: sharpen }
      },
      depthTest: false,
      depthWrite: false
    });

    this.setSize(renderer.domElement.width, renderer.domElement.height);
  }

  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;

    this.dispose(true);

    const common = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false
    };

    // One pass writes both colour and velocity. A second geometry pass just for
    // motion vectors would mean shading 180k instances twice, which costs more
    // than the antialiasing is worth.
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...common, count: 2, depthBuffer: true });
    this.sceneRT.textures[0].name = 'taa.color';
    this.sceneRT.textures[1].name = 'taa.velocity';
    for (const t of this.sceneRT.textures) {
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
    }

    this.history = [
      new THREE.WebGLRenderTarget(w, h, common),
      new THREE.WebGLRenderTarget(w, h, common)
    ];

    this.resolveMat.uniforms.uTexSize.value.set(w, h);
    this.outputMat.uniforms.uTexSize.value.set(w, h);
    this.reset = true;
  }

  /**
   * Offsets the projection matrix by a sub-pixel amount. Must run after the
   * camera's own projection update and before anything reads the matrix — the
   * blade shader uses three's `projectionMatrix` directly, so jitter reaches
   * the grass with no extra plumbing.
   */
  applyJitter(camera) {
    // Keep the unjittered matrix: motion vectors computed from a jittered
    // projection carry the jitter into the velocity, and the resolve then
    // chases its own tail.
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    if (!this.enabled) {
      this.jitter.set(0, 0);
      return;
    }
    const o = this._offsets[this.frame % this.samples];
    this.jitter.set((o.x * 2 * this.jitterScale) / this.width, (o.y * 2 * this.jitterScale) / this.height);
    camera.projectionMatrix.elements[8] += this.jitter.x;
    camera.projectionMatrix.elements[9] += this.jitter.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  /** Undoes the jitter so the next frame starts from a clean projection. */
  clearJitter(camera) {
    if (!this.enabled) return;
    camera.projectionMatrix.elements[8] -= this.jitter.x;
    camera.projectionMatrix.elements[9] -= this.jitter.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  get target() {
    return this.sceneRT;
  }

  /** Resolves the scene target to the canvas. */
  present(camera) {
    const r = this.renderer;
    const cur = this.history[this.frame % 2];
    const prev = this.history[(this.frame + 1) % 2];

    if (this.enabled) {
      this.resolveMat.uniforms.uScene.value = this.sceneRT.textures[0];
      this.resolveMat.uniforms.uVelocity.value = this.sceneRT.textures[1];
      this.resolveMat.uniforms.uHistory.value = prev.texture;
      this.resolveMat.uniforms.uReset.value = this.reset ? 1 : 0;
      this.quad.material = this.resolveMat;
      r.setRenderTarget(cur);
      r.render(this.scene, this.camera);

      this.outputMat.uniforms.uTex.value = cur.texture;
    } else {
      this.outputMat.uniforms.uTex.value = this.sceneRT.textures[0];
    }

    this.quad.material = this.outputMat;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);

    this.viewProjPrev.copy(this.viewProj);
    this.camPosPrev.copy(camera.position);
    this.frame++;
    this.reset = false;
  }

  /** Call when the scene is rebuilt, so no stale frames bleed into the new one. */
  invalidate() {
    this.reset = true;
  }

  dispose(keepMaterials = false) {
    if (this.sceneRT) this.sceneRT.dispose();
    if (this.history) for (const h of this.history) h.dispose();
    this.sceneRT = null;
    this.history = null;
    if (keepMaterials) return;
    this.resolveMat.dispose();
    this.outputMat.dispose();
    this.quad.geometry.dispose();
  }
}

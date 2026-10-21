import * as THREE from 'three';
import { QUAD_VERT } from '../shaders/bake.js';

/**
 * Renders fragment shaders into textures. Every map in the project — noise,
 * terrain field, blade PBR, soil PBR — comes out of here, once, at start-up.
 */
export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this._targets = [];
  }

  _material(fragmentShader, uniforms) {
    // Plain ShaderMaterial (not Raw): three already emits `#version 300 es`
    // plus the attribute/varying/gl_FragColor aliases for us, so the bake
    // shaders can use integer hashing without any boilerplate of their own.
    return new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false
    });
  }

  /**
   * @param {object} o
   * @param {string} o.frag
   * @param {object} o.uniforms
   * @param {number} o.width
   * @param {number} o.height
   * @param {number} [o.layers]   >1 bakes a DataArrayTexture, one draw per layer
   * @param {number} [o.type]     THREE.HalfFloatType by default
   * @param {boolean} [o.mipmaps]
   * @param {number} [o.wrap]
   * @returns {THREE.Texture}
   */
  bake(o) {
    const {
      frag, uniforms, width, height,
      layers = 1,
      type = THREE.HalfFloatType,
      mipmaps = false,
      wrap = THREE.RepeatWrapping,
      anisotropy = 1
    } = o;

    // three's automatic mip generation binds render-target textures as
    // TEXTURE_2D, which is a GL error for an array. So arrays opt out of the
    // automatic path and get their chain built by hand below.
    const autoMips = mipmaps && layers === 1;

    const opts = {
      type,
      format: THREE.RGBAFormat,
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: wrap,
      wrapT: wrap,
      generateMipmaps: autoMips,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace
    };

    const rt = layers > 1
      ? new THREE.WebGLArrayRenderTarget(width, height, layers, opts)
      : new THREE.WebGLRenderTarget(width, height, opts);

    // WebGLArrayRenderTarget forwards only some options; make sure the
    // sampling state we asked for actually lands on the texture.
    Object.assign(rt.texture, {
      minFilter: opts.minFilter,
      magFilter: opts.magFilter,
      wrapS: wrap,
      wrapT: wrap,
      generateMipmaps: autoMips,
      anisotropy,
      colorSpace: THREE.NoColorSpace
    });

    const u = { uLayer: { value: 0 }, uLayerCount: { value: layers }, ...uniforms };
    const mat = this._material(frag, u);
    this.quad.material = mat;

    const prev = this.renderer.getRenderTarget();
    for (let i = 0; i < layers; i++) {
      u.uLayer.value = i;
      this.renderer.setRenderTarget(rt, i);
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.setRenderTarget(prev);
    mat.dispose();

    if (mipmaps && !autoMips) this._generateMips(rt, layers);

    this._targets.push(rt);
    rt.texture.name = o.name || 'baked';
    return rt.texture;
  }

  _generateMips(rt, layers) {
    const gl = this.renderer.getContext();
    const props = this.renderer.properties.get(rt.texture);
    if (!props || !props.__webglTexture) return;
    const target = layers > 1 ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
    gl.bindTexture(target, props.__webglTexture);
    gl.generateMipmap(target);
    gl.bindTexture(target, null);
    // We went around three's state cache, so hand it back a clean slate.
    this.renderer.resetState();
  }

  /**
   * Pulls a baked half-float target back to the CPU as Float32 RGBA so game
   * logic can query the exact same data the shaders sample.
   */
  readback(texture, width, height) {
    const rt = this._targets.find((t) => t.texture === texture);
    if (!rt) throw new Error('readback: texture was not baked by this baker');
    const half = new Uint16Array(width * height * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, half);
    const out = new Float32Array(width * height * 4);
    for (let i = 0; i < out.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(half[i]);
    return out;
  }

  dispose() {
    for (const t of this._targets) t.dispose();
    this._targets.length = 0;
    this.quad.geometry.dispose();
  }
}

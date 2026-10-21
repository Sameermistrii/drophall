import * as THREE from 'three';

/**
 * Sun shadows: two camera-fitted cascades, sampled with PCSS.
 *
 * Not three.js's built-in shadow system. That one is built around a per-light
 * map and a fixed PCF kernel, and it has no way to express "render the two
 * nearest grass rings into a tight cascade and only the terrain into a wide
 * one" — which is the whole trick that makes grass shadows affordable.
 *
 * Why two cascades and not one. Texel size is everything here. A single 2048
 * map covering 90 m gives ~9 cm texels; a grass blade is 5 mm across, so a
 * texel's stored depth is essentially a random nearby blade, every fragment
 * fails the depth test at random, and what you see is black speckle rather than
 * shadow. The near cascade is deliberately small (~15 m, ~1.5 cm texels) so
 * blade shadows actually resolve; the far one carries terrain and shrubs out to
 * the fog.
 *
 * Even at 1.5 cm a blade is still sub-texel, so a depth bias alone cannot fix
 * the self-occlusion. The receiver is offset along its own normal by about a
 * texel's worth of world space before being projected — that is the cure for
 * geometry finer than the map, and it is why the speckle disappears without
 * peter-panning the contact shadows.
 */
export class ShadowMapper {
  /** Layer per cascade. An object casts into the cascades whose layer it has. */
  static LAYER = [1, 2];

  /** Angular diameter of the sun, in radians — the only thing that sets how
   *  fast a real shadow's penumbra widens with distance from its caster. */
  static SUN_ANGLE = 0.0093;

  constructor(renderer, size, radii = [15, 85]) {
    this.renderer = renderer;
    this.size = size;
    this.enabled = size > 0;
    this.split = radii[0] * 0.82;

    this.ctl = new THREE.Vector4(0, 0.92, 1.0, 1.2); // enabled, intensity, softness, normalBias
    this.maxPenumbra = 10;

    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._m = new THREE.Matrix4();

    this.cascades = radii.map((radius, i) => {
      const depthRange = radius * 2.0 + 30;
      const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, depthRange);
      let target = null;
      if (this.enabled) {
        const depth = new THREE.DepthTexture(size, size);
        depth.type = THREE.UnsignedIntType;
        depth.minFilter = THREE.NearestFilter;
        depth.magFilter = THREE.NearestFilter;
        depth.compareFunction = null;
        target = new THREE.WebGLRenderTarget(size, size, {
          depthTexture: depth,
          depthBuffer: true,
          stencilBuffer: false,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          generateMipmaps: false,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter
        });
      }
      const texelWorld = (2 * radius) / size;
      return {
        index: i,
        radius,
        depthRange,
        texelWorld,
        camera: cam,
        target,
        matrix: new THREE.Matrix4(),
        // x: texel in UV, y: texel in metres, z: normalised-separation -> texels
        //    of penumbra, w: depth bias in normalised units.
        //
        // The bias is authored in METRES and divided by the depth range, which
        // is the only way to keep it honest: the same normalised number means
        // something completely different in a 60 m cascade and a 200 m one. Two
        // centimetres is about one texel of the near cascade — enough to clear
        // quantisation, small enough that a low sun cannot smear it into a
        // visible gap between an object and its shadow.
        data: new THREE.Vector4(
          1 / size,
          texelWorld,
          (depthRange * ShadowMapper.SUN_ANGLE) / texelWorld,
          Math.max(0.02, texelWorld * 0.8) / depthRange
        )
      };
    });

    if (this.enabled) this.ctl.x = 1;
  }

  texture(i) {
    return this.enabled ? this.cascades[i].target.depthTexture : null;
  }

  /** @param {THREE.Vector3} sunDir unit vector pointing toward the sun */
  fit(camera, sunDir, groundY) {
    if (!this.enabled) return;

    camera.getWorldDirection(this._v);
    this._v.y = 0;
    if (this._v.lengthSq() < 1e-6) this._v.set(0, 0, -1);
    this._v.normalize();

    for (const c of this.cascades) {
      const R = c.radius;
      // Push the box forward along the view so most of it lands on screen.
      this._t.copy(camera.position).addScaledVector(this._v, R * 0.45);
      this._t.y = groundY;

      c.camera.position.copy(this._t).addScaledVector(sunDir, R + c.depthRange * 0.4);
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(this._t);
      c.camera.left = -R; c.camera.right = R;
      c.camera.top = R; c.camera.bottom = -R;
      c.camera.near = 0.1;
      c.camera.far = c.depthRange;
      c.camera.updateProjectionMatrix();
      c.camera.updateMatrixWorld(true);

      // Snap the light-space origin to whole texels: without this the shadow
      // edges crawl as the camera walks, which reads as shimmer.
      this._m.multiplyMatrices(c.camera.projectionMatrix, c.camera.matrixWorldInverse);
      this._v.set(0, 0, 0).applyMatrix4(this._m);
      const half = this.size * 0.5;
      c.camera.projectionMatrix.elements[12] += Math.round(this._v.x * half) / half - this._v.x;
      c.camera.projectionMatrix.elements[13] += Math.round(this._v.y * half) / half - this._v.y;
      c.camera.projectionMatrixInverse.copy(c.camera.projectionMatrix).invert();

      c.matrix.multiplyMatrices(c.camera.projectionMatrix, c.camera.matrixWorldInverse);
    }

    // Restore the view direction for the next call.
    camera.getWorldDirection(this._v);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {Array<Array<{object: THREE.Object3D, material: THREE.Material}>>} casters
   *   One caster list per cascade. Grass only goes in the near list; the far
   *   cascade carries terrain and shrubs, so the second pass is nearly free.
   */
  render(scene, casters, onCascade) {
    if (!this.enabled || this.ctl.x < 0.5) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();

    for (const c of this.cascades) {
      const list = casters[c.index] || [];
      const restore = list.map((x) => [x.object, x.object.material]);
      for (const x of list) x.object.material = x.material;

      // Each cascade sees a different slab of the world, so the vertex-shader
      // frustum cull has to be re-armed with *this* cascade's planes. Reusing
      // one cascade's planes for both silently drops casters from the other.
      if (onCascade) onCascade(c.index, c.camera);

      c.camera.layers.set(ShadowMapper.LAYER[c.index]);
      r.setRenderTarget(c.target);
      r.setClearColor(0xffffff, 1);
      r.clear(true, true, false);
      r.render(scene, c.camera);

      for (const [o, m] of restore) o.material = m;
    }

    r.setRenderTarget(prev);
  }

  static addCaster(object, cascade) {
    object.layers.enable(ShadowMapper.LAYER[cascade]);
  }
  static removeCaster(object, cascade) {
    object.layers.disable(ShadowMapper.LAYER[cascade]);
  }

  dispose() {
    for (const c of this.cascades) if (c.target) c.target.dispose();
  }
}

import * as THREE from 'three';
import { TextureBaker } from '../gpu/TextureBaker.js';
import {
  NOISE_ATLAS_FRAG, FIELD_FRAG,
  BLADE_A_FRAG, BLADE_B_FRAG,
  GROUND_A_FRAG, GROUND_B_FRAG
} from '../shaders/bake.js';
import { TERRAIN_VERT, TERRAIN_FRAG, SKY_VERT, SKY_FRAG } from '../shaders/terrain.js';
import { FieldSampler } from '../shaders/field.js';
import { ShadowMapper } from './ShadowMapper.js';

const NOISE_SIZE = 512;

/**
 * Everything that is not a blade: baked textures, the shared uniform block,
 * terrain, sky and the sun cascade.
 *
 * The uniform objects created here are handed out by reference, so when the sun
 * moves, grass and ground move with it in the same frame — there is no second
 * copy of the lighting state anywhere.
 */
export class World {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.baker = new TextureBaker(renderer);
    this.scene = new THREE.Scene();
    this.opts = opts;

    this.fieldTile = opts.fieldTile ?? 512;
    this.fieldRes = opts.fieldTex ?? 1024;

    this._bakeAll(opts);
    this._buildUniforms();
    this._buildTerrain(opts);
    this._buildSky();

    this.shadow = new ShadowMapper(renderer, opts.shadow ?? 2048, opts.shadowRadii ?? [15, 85]);
    const u = this.uniforms;
    u.uShadowMap0.value = this.shadow.texture(0);
    u.uShadowMap1.value = this.shadow.texture(1);
    u.uShadowMat0.value = this.shadow.cascades[0].matrix;
    u.uShadowMat1.value = this.shadow.cascades[1].matrix;
    u.uShadowData0.value = this.shadow.cascades[0].data;
    u.uShadowData1.value = this.shadow.cascades[1].data;
    u.uShadowCtl.value = this.shadow.ctl;
    u.uShadowSplit.value = this.shadow.split;
    u.uShadowMaxPenumbra.value = this.shadow.maxPenumbra;

    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
  }

  /* ---------------------------------------------------------------- bake -- */

  _bakeAll(opts) {
    const seed = opts.seed ?? 1337;

    this.noiseTex = this.baker.bake({
      name: 'noiseAtlas',
      frag: NOISE_ATLAS_FRAG,
      uniforms: { uSeed: { value: seed } },
      width: NOISE_SIZE, height: NOISE_SIZE
    });

    this.fieldTex = this.baker.bake({
      name: 'field',
      frag: FIELD_FRAG,
      uniforms: {
        uSeed: { value: seed + 91 },
        uTileMetres: { value: this.fieldTile },
        uRelief: { value: opts.relief ?? 1 },
        uPathWidth: { value: opts.pathWidth ?? 1.6 }
      },
      width: this.fieldRes, height: this.fieldRes,
      wrap: THREE.RepeatWrapping
    });

    // Same data on the CPU, so the walker and the camera stand on exactly the
    // surface the shaders draw.
    this.field = new FieldSampler(
      this.baker.readback(this.fieldTex, this.fieldRes, this.fieldRes),
      this.fieldRes, this.fieldTile
    );

    this.rebakeBlade(opts);

    const gRes = 1024;
    const gu = () => ({ uSeed: { value: seed + 401 }, uMicroDetail: { value: opts.microDetail ?? 1 } });
    this.groundA = this.baker.bake({
      name: 'groundA', frag: GROUND_A_FRAG, uniforms: gu(),
      width: gRes, height: gRes, mipmaps: true,
      anisotropy: this.renderer.capabilities.getMaxAnisotropy()
    });
    this.groundB = this.baker.bake({
      name: 'groundB', frag: GROUND_B_FRAG, uniforms: gu(),
      width: gRes, height: gRes, mipmaps: true,
      anisotropy: this.renderer.capabilities.getMaxAnisotropy()
    });
  }

  /** Re-runs only the blade atlas — cheap enough to drive from a UI slider. */
  rebakeBlade(opts) {
    const seed = opts.seed ?? 1337;
    const res = opts.bladeTex ?? 512;
    const layers = opts.variants ?? 4;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();

    const shared = () => ({
      uSeed: { value: seed + 17 },
      uMicroDetail: { value: opts.microDetail ?? 1 },
      uMicroScale: { value: opts.microScale ?? 1 },
      uAspect: { value: opts.bladeAspect ?? 55 },
      uDryness: { value: opts.dryness ?? 0.35 }
    });

    const old = [this.bladeA, this.bladeB];

    this.bladeA = this.baker.bake({
      name: 'bladeA', frag: BLADE_A_FRAG, uniforms: shared(),
      width: res, height: res, layers, mipmaps: true,
      wrap: THREE.ClampToEdgeWrapping, anisotropy: aniso
    });
    this.bladeB = this.baker.bake({
      name: 'bladeB', frag: BLADE_B_FRAG, uniforms: shared(),
      width: res, height: res, layers, mipmaps: true,
      wrap: THREE.ClampToEdgeWrapping, anisotropy: aniso
    });

    if (this.uniforms) {
      this.uniforms.uBladeA.value = this.bladeA;
      this.uniforms.uBladeB.value = this.bladeB;
      for (const t of old) if (t) t.dispose();
    }
  }

  /* ------------------------------------------------------------ uniforms -- */

  _buildUniforms() {
    const c = (hex) => new THREE.Color(hex);   // three converts sRGB hex to the linear working space for us
    this.uniforms = {
      // shared world state
      uTime: { value: 0 },
      uTimePrev: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamPosPrev: { value: new THREE.Vector3() },
      uViewProjNow: { value: new THREE.Matrix4() },
      uViewProjPrev: { value: new THREE.Matrix4() },
      uNoiseTex: { value: this.noiseTex },
      uNoiseWorldSize: { value: 64 },
      uFieldTex: { value: this.fieldTex },
      uFieldParams: { value: new THREE.Vector4(this.fieldTile, 0, 46, 0) },

      // blade material
      uBladeA: { value: this.bladeA },
      uBladeB: { value: this.bladeB },
      uNormalStrength: { value: 1.0 },
      uSpecular: { value: 1.0 },
      uAnisotropy: { value: 0.55 },
      uSSSScale: { value: 1.35 },
      uSSSPower: { value: 3.2 },
      uSSSDistortion: { value: 0.35 },
      uSSSTint: { value: c('#8fc24a') },
      uDetailFade: { value: 26 },
      uSwardColor: { value: c('#4d6b30') },
      uSwardDeep: { value: c('#25361a') },
      uSwardCover: { value: 0.92 },
      // Ramp that paints the canopy back in as the blade geometry and the
      // ground's own relief detail fade out with distance. Tuned against
      // tools/lod-profile.mjs, which measures the radial brightness the eye
      // actually reads.
      // x: where the near ramp starts, y: where the blades are gone (the far
      // ramp then runs to 5x that), z: strength. Measured, not guessed: 2/14/2
      // was the flattest of the sweep, and past it the whole field just goes
      // muddy without getting any flatter.
      uSwardFar: { value: new THREE.Vector3(2.0, 14.0, 2.0) },

      // ground
      uGroundA: { value: this.groundA },
      uGroundB: { value: this.groundB },
      uGroundTile: { value: 1.35 },
      uDetailRatio: { value: 0.37 },
      uDetailBlend: { value: 1.0 },
      uTileWarp: { value: 1.1 },
      uCenter: { value: new THREE.Vector2() },

      // sun & sky
      uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.76).normalize() },
      uSunColor: { value: c('#fff0d8').multiplyScalar(3.4) },
      uSkyColor: { value: c('#88b0dd') },
      uSkyZenith: { value: c('#5b8fd6') },
      uSkyHorizon: { value: c('#bcd2e8') },
      uGroundBounce: { value: c('#5c5442') },
      uAmbient: { value: 0.85 },

      // atmosphere
      uFogColor: { value: c('#b9cadb') },
      uFogSunColor: { value: c('#ffe3b4') },
      uFogDensity: { value: 0.0055 },
      uFogHeightFalloff: { value: 0.018 },
      uCloudShadow: { value: 0.45 },
      uCloudScale: { value: 210 },
      uCloudDir: { value: new THREE.Vector2(1, 0.3).normalize() },
      uCloudCover: { value: 0.5 },

      // shadows (bound to the mapper's own objects right after construction)
      uShadowMap0: { value: null },
      uShadowMap1: { value: null },
      uShadowMat0: { value: new THREE.Matrix4() },
      uShadowMat1: { value: new THREE.Matrix4() },
      uShadowData0: { value: new THREE.Vector4() },
      uShadowData1: { value: new THREE.Vector4() },
      uShadowCtl: { value: new THREE.Vector4(0, 0.92, 1, 1.6) },
      uShadowSplit: { value: 12 },
      uShadowMaxPenumbra: { value: 10 },

      uDebug: { value: 0 },
      uGroundY: { value: -1.22 }
    };
  }

  /* ------------------------------------------------------------- terrain -- */

  /**
   * Exponential polar grid: vertex spacing grows geometrically with radius, so
   * the ground under your feet is millimetre-fine while the horizon costs
   * almost nothing. Locked to the camera, so its cost never depends on how far
   * you have walked.
   */
  static polarGrid(rMin, rMax, radial, angular) {
    const verts = [];
    const idx = [];
    verts.push(0, 0, 0);                       // centre
    const k = Math.pow(rMax / rMin, 1 / radial);
    for (let i = 0; i <= radial; i++) {
      const r = rMin * Math.pow(k, i);
      for (let j = 0; j < angular; j++) {
        const a = (j / angular) * Math.PI * 2;
        verts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
    }
    // Wound counter-clockwise seen from above, so the front face is the one you
    // stand on.
    for (let j = 0; j < angular; j++) {
      idx.push(0, 1 + ((j + 1) % angular), 1 + j);
    }
    for (let i = 0; i < radial; i++) {
      const a0 = 1 + i * angular;
      const a1 = 1 + (i + 1) * angular;
      for (let j = 0; j < angular; j++) {
        const jn = (j + 1) % angular;
        idx.push(a0 + j, a0 + jn, a1 + j);
        idx.push(a0 + jn, a1 + jn, a1 + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return g;
  }

  _buildTerrain(opts) {
    const geo = World.polarGrid(0.35, opts.terrainRadius ?? 1600, opts.terrainRadial ?? 190, opts.terrainAngular ?? 256);

    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: this.uniforms,
      dithering: true
    });
    this.terrainDepthMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: 'precision highp float;\nvoid main(){ gl_FragColor = vec4(1.0); }',
      uniforms: this.uniforms,
      colorWrite: false
    });

    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.terrain.frustumCulled = false;
    this.terrain.matrixAutoUpdate = false;
    // Terrain casts into both cascades: it is one draw, and a hill shadowing a
    // valley is exactly what the wide cascade is for.
    ShadowMapper.addCaster(this.terrain, 0);
    ShadowMapper.addCaster(this.terrain, 1);
    this.scene.add(this.terrain);

    this.terrainVerts = geo.attributes.position.count;
  }

  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 1000;
    this.scene.add(this.sky);
  }

  /* --------------------------------------------------------------- scene -- */

  /** Applies a scene preset: sun angle, sky, fog, clouds, ground colouring. */
  applyScene(def, swardColor, swardDeep) {
    const u = this.uniforms;
    const c = (hex) => new THREE.Color(hex);   // three converts sRGB hex to the linear working space for us

    const el = THREE.MathUtils.degToRad(def.sun.elevation);
    const az = THREE.MathUtils.degToRad(def.sun.azimuth);
    u.uSunDir.value.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    ).normalize();
    // Low sun is redder and dimmer: a crude but effective extinction curve.
    const t = THREE.MathUtils.clamp(Math.sin(el), 0.02, 1);
    const warm = new THREE.Color(1, Math.pow(t, 0.16), Math.pow(t, 0.42));
    u.uSunColor.value.copy(c(def.sun.tint)).multiply(warm).multiplyScalar(def.sun.intensity);

    u.uSkyZenith.value.copy(c(def.sky.zenith));
    u.uSkyHorizon.value.copy(c(def.sky.horizon));
    u.uSkyColor.value.copy(c(def.sky.zenith)).lerp(c(def.sky.horizon), 0.55);
    u.uGroundBounce.value.copy(c(def.sky.ground)).lerp(swardColor || c(def.sky.ground), 0.55);
    u.uAmbient.value = def.sky.ambient;

    u.uFogColor.value.copy(c(def.fog.color));
    u.uFogSunColor.value.copy(c(def.fog.sunColor));
    u.uFogDensity.value = def.fog.density;
    u.uFogHeightFalloff.value = def.fog.heightFalloff;

    u.uCloudShadow.value = def.clouds.strength;
    u.uCloudScale.value = def.clouds.scale;
    u.uCloudCover.value = THREE.MathUtils.clamp(def.clouds.strength + 0.18, 0, 1);
    u.uCloudDir.value.set(Math.cos(def.wind.direction), Math.sin(def.wind.direction));

    u.uFieldParams.value.z = def.field.biomeWavelength;

    if (swardColor) u.uSwardColor.value.copy(swardColor);
    if (swardDeep) u.uSwardDeep.value.copy(swardDeep);

    this.renderer.toneMappingExposure = def.exposure ?? 1;
  }

  /* -------------------------------------------------------------- update -- */

  update(camera, time, timePrev = time) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uTimePrev.value = timePrev;
    u.uCamPos.value.copy(camera.position);
    u.uCenter.value.set(camera.position.x, camera.position.z);
    this._sunDir.copy(u.uSunDir.value);
    this.shadow.fit(camera, this._sunDir, this.field.height(camera.position.x, camera.position.z));
  }

  /** @returns {number} ground height, matching the shader exactly. */
  heightAt(x, z) {
    return this.field.height(x, z);
  }

  /** One caster entry per cascade. */
  get shadowCasters() {
    const t = { object: this.terrain, material: this.terrainDepthMat };
    return [[t], [t]];
  }

  dispose() {
    this.baker.dispose();
    this.shadow.dispose();
    this.terrain.geometry.dispose();
    this.terrainMat.dispose();
    this.terrainDepthMat.dispose();
    this.sky.geometry.dispose();
    this.skyMat.dispose();
  }
}

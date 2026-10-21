// Fluffy lawn tufts from https://github.com/thebenezer/FluffyGrass (MIT).
// Each instance is one fan of blades. Packed across the plaza, they read as a
// full lawn from the approach, which a field of hair-thin blades does not.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';

const VERT = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec2 bladeUv = vec2(uv.x, 1.0 - uv.y);
  vec2 gust = texture2D(uNoise, world.xz * 0.02 + uTime * 0.015).rg;
  float wave = sin(dot(world.xz, vec2(0.35, 0.22)) + gust.g * 5.5 + uTime * 1.3);
  float sway = wave * 0.12 * bladeUv.y;
  world.x += sway;
  world.z += sway * 0.65;
  world.y += (exp(gust.r) - 1.0) * 0.18 * bladeUv.y;

  vec4 viewPos = viewMatrix * world;
  gl_Position = projectionMatrix * viewPos;
  vUv = bladeUv;
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAlpha;
uniform sampler2D uNoise;
uniform vec3 uBase;
uniform vec3 uTipA;
uniform vec3 uTipB;
uniform vec3 uSun;
uniform vec3 uFog;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  float mask = texture2D(uAlpha, vUv).r;
  if (mask < 0.35) discard;
  float n = texture2D(uNoise, vWorld.xz * 0.07).r;
  vec3 tip = mix(uTipA, uTipB, n);
  vec3 color = mix(uBase, tip, smoothstep(0.05, 0.85, vUv.y));
  float ndl = clamp(dot(normalize(vNormal), uSun), 0.0, 1.0);
  color *= 0.62 + ndl * 0.85;
  float dist = distance(vWorld, cameraPosition);
  color = mix(color, uFog, smoothstep(72.0, 190.0, dist));
  gl_FragColor = vec4(color, 1.0);
}
`;

function onLawn(x, z) {
  if (Math.abs(x) < 2.5 && z < 40) return false;
  // Steps end near z = 6.8. Stay off the treads, the stylobate, and the rooms behind the facade.
  if (Math.abs(x) < 16.6 && z < 7.05) return false;
  // Low stone pads at the front corners.
  if (Math.abs(Math.abs(x) - 11.2) < 7 && z > 5.0 && z < 8.0) return false;
  if (z < -150 || z > 62 || Math.abs(x) > 110) return false;
  return true;
}

export async function createFluffyLawn({ mobile }) {
  const loadTex = url => new Promise((ok, bad) => new THREE.TextureLoader().load(url, ok, undefined, bad));
  const loadGltf = url => new Promise((ok, bad) => new GLTFLoader().load(url, ok, undefined, bad));
  const [alpha, noise, gltf] = await Promise.all([
    loadTex('assets/garden/fluffy/grass.jpeg'),
    loadTex('assets/garden/fluffy/perlinnoise.webp'),
    loadGltf('assets/garden/fluffy/grassLODs.glb'),
  ]);
  alpha.colorSpace = THREE.NoColorSpace;
  alpha.anisotropy = 4;
  noise.colorSpace = THREE.NoColorSpace;
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

  let geo = null;
  gltf.scene.traverse(o => {
    if (o.isMesh && /LOD00/i.test(o.name)) geo = o.geometry;
  });
  if (!geo) gltf.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
  geo = geo.clone();
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);

  const step = mobile ? 0.58 : 0.34;
  const spots = [];
  const scatter = (x0, x1, z0, z1, gap) => {
    for (let x = x0; x <= x1; x += gap) {
      for (let z = z0; z <= z1; z += gap) {
        const px = x + (Math.random() - 0.5) * gap;
        const pz = z + (Math.random() - 0.5) * gap;
        if (onLawn(px, pz)) spots.push(px, pz);
      }
    }
  };
  scatter(-42, 42, -2, 54, step);
  // The strip between the lawn and the steps was bare ground. Pack that band.
  scatter(-20, 20, 6.95, 10.5, mobile ? 0.36 : 0.18);
  // The approach compresses the ground beside and behind the building into a thin
  // band. Carry the same tufts out to that horizon, on both sides of the facade.
  scatter(-100, 100, -150, -4, mobile ? 2.2 : 1.35);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: alpha },
      uNoise: { value: noise },
      uBase: { value: new THREE.Color('#3f6a2e') },
      uTipA: { value: new THREE.Color('#c5e7a4') },
      uTipB: { value: new THREE.Color('#2f5230') },
      uSun: { value: new THREE.Vector3(22, 24, 8).normalize() },
      uFog: { value: new THREE.Color(0xc5d0c2) },
    },
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, spots.length / 2);
  mesh.frustumCulled = false;
  mesh.count = spots.length / 2;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < mesh.count; i++) {
    const px = spots[i * 2], pz = spots[i * 2 + 1];
    // Farther tufts have to be larger or the horizon band reads as bare ground.
    const dist = Math.hypot(px, pz - 26);
    const s = dist > 60 ? 9 + Math.random() * 5 : dist > 30 ? 4.2 + Math.random() * 2.4 : 2.4 + Math.random() * 1.5;
    dummy.position.set(px, -1.22, pz);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    const yScale = dist > 30 ? s * (1.05 + Math.random() * 0.35) : s * (0.85 + Math.random() * 0.5);
    dummy.scale.set(s, yScale, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  return {
    mesh,
    count: mesh.count,
    update(time) { mat.uniforms.uTime.value = time; },
  };
}

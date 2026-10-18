// The museum walk. Scrolling through #walk moves the camera from the street, up the steps,
// through the lobby and every gallery, stopping in front of each exhibit.
(async () => {
  const root = document.documentElement;
  const cv = document.getElementById('gl'), walk = document.getElementById('walk');
  const intro = document.getElementById('intro'), sign = document.getElementById('roomSign');
  const placard = document.getElementById('placard'), mapEl = document.getElementById('map');
  const mobile = matchMedia('(max-width: 760px)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let R;
  try { R = new THREE.WebGLRenderer({canvas: cv, antialias: !mobile, powerPreference: 'high-performance'}); }
  catch (e) { root.classList.add('no3d'); return; }
  R.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  R.outputEncoding = THREE.sRGBEncoding;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;

  // canvas text needs the web fonts; don't wait forever if they can't load (offline)
  await Promise.race([Promise.all(['700 64px Cinzel', '600 40px "Libre Franklin"', 'italic 500 40px "Cormorant Garamond"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]);

  const S = new THREE.Scene();
  const NIGHT = 0x14161d;
  S.fog = new THREE.Fog(NIGHT, 22, 80);
  const cam = new THREE.PerspectiveCamera(mobile ? 66 : 55, 1, .05, 400);
  cam.rotation.order = 'YXZ'; S.add(cam);
  const lamp = new THREE.PointLight(0xffe6c8, .45, 7); cam.add(lamp);

  // ---------- helpers ----------
  const tex = (w, h, draw, rep) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = R.capabilities.getMaxAnisotropy();
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    return t;
  };
  const std = o => new THREE.MeshStandardMaterial(o);
  const basic = o => new THREE.MeshBasicMaterial(o);
  const add = (geo, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, parent = S) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, 0, parent);
  const glowCache = {};
  const glow = (color, size, parent = S) => {
    const t = glowCache[color] ||= tex(128, 128, g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, color); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false}));
    s.scale.set(size, size, 1); parent.add(s); return s;
  };
  const noise = (g, w, h, a) => { for (let i = 0; i < w * h / 40; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
  const wrapText = (g, text, x, y, maxW, lh) => {
    let line = ''; for (const word of text.split(' ')) { const t = line ? line + ' ' + word : word;
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = word; } else line = t; }
    g.fillText(line, x, y); return y;
  };
  const DISPLAY = 'Cinzel, Georgia, serif', BODY = '"Libre Franklin", "Segoe UI", sans-serif', LABEL = '"Cormorant Garamond", Georgia, serif';

  // ---------- materials ----------
  const stoneT = tex(256, 256, (g, w, h) => { g.fillStyle = '#d6cebd'; g.fillRect(0, 0, w, h); noise(g, w, h, .08);
    g.fillStyle = 'rgba(80,70,55,.25)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2, w, 2); g.fillRect(0, 0, 2, h / 2); g.fillRect(w / 2, h / 2, 2, h / 2); }, [6, 4]);
  const stone = std({map: stoneT, roughness: .85});
  const colT = tex(256, 64, (g, w, h) => { g.fillStyle = '#ddd5c4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = i * 16; const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(.5, 'rgba(255,255,255,.08)'); gr.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); } }, [1, 4]);
  const brass = std({color: 0xc9a45c, metalness: .45, roughness: .32, emissive: 0x2a1c05});
  const gilt = std({color: 0xb8913f, metalness: .5, roughness: .3, emissive: 0x241703});
  const velvet = std({color: 0x7a1420, roughness: .9});
  const dark = std({color: 0x1a1c22, roughness: .6});
  const plaster = std({color: 0xece8e1, roughness: .9});
  const floors = {
    oak: tex(512, 512, (g, w) => { for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(30,${38 + i % 3 * 5}%,${26 + (i * 37 % 8)}%)`; g.fillRect(0, i * 64, w, 64);
      for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .1})`; g.fillRect(0, i * 64 + Math.random() * 64, w, 1); }
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, i * 64, w, 2); g.fillRect((i * 173) % w, i * 64, 2, 64); } }),
    marble: tex(512, 512, (g, w) => { const s = w / 4; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#e9e5dc' : '#2a2c31'; g.fillRect(i * s, j * s, s, s); }
      g.strokeStyle = 'rgba(140,130,115,.35)'; g.lineWidth = 1.5; for (let k = 0; k < 14; k++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * w; g.moveTo(x, y); for (let n = 0; n < 6; n++) { x += Math.random() * 60 - 30; y += Math.random() * 60; g.lineTo(x, y); } g.stroke(); } }),
  };
  const floorMat = (kind, w, d) => { const t = floors[kind].clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / (kind === 'oak' ? 3 : 4), d / (kind === 'oak' ? 3 : 4)); return std({map: t, roughness: kind === 'oak' ? .45 : .25, metalness: .05}); };
  const wallMat = hex => { const t = tex(256, 256, (g, w, h) => { g.fillStyle = hex; g.fillRect(0, 0, w, h); noise(g, w, h, .05); }, [4, 2]); return std({map: t, roughness: .92, side: THREE.DoubleSide}); };

  // ---------- sky and plaza ----------
  const sky = tex(16, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b0e1c'); gr.addColorStop(.45, '#1f2547'); gr.addColorStop(.62, '#6a4a5a'); gr.addColorStop(.7, '#c98a5e'); gr.addColorStop(.72, '#14161d'); gr.addColorStop(1, '#14161d'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  add(new THREE.SphereGeometry(300, 32, 16), basic({map: sky, side: THREE.BackSide, fog: false, depthWrite: false}));
  const plazaT = tex(256, 256, (g, w, h) => { g.fillStyle = '#5d5a55'; g.fillRect(0, 0, w, h); noise(g, w, h, .2); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); }, [30, 30]);
  add(new THREE.PlaneGeometry(120, 120), std({map: plazaT, roughness: .8}), 0, -1.2, 40, 0, -Math.PI / 2);

  // ---------- the entrance: steps, portico, pediment ----------
  const PD = 4.4; // portico depth in front of the facade
  box(32, 1.2, PD, stone, 0, -.6, PD / 2);                                 // stylobate
  for (let i = 0; i < 4; i++) box(32, .3 * (i + 1), .6, stone, 0, -1.2 + .15 * (i + 1), PD + 2.4 - i * .6 - .3); // steps up to the portico
  const FW = 30, FH = 10.5, DW = 4.4, DH = 5.8;
  const side = (FW - DW) / 2;
  for (const s of [-1, 1]) box(side, FH, .6, stone, s * (DW / 2 + side / 2), FH / 2, -.3);
  box(DW, FH - DH, .6, stone, 0, DH + (FH - DH) / 2, -.3);
  for (const s of [-1, 1]) box(.35, DH + .35, .8, gilt, s * (DW / 2 + .1), (DH + .35) / 2, -.2);    // bronze door frame
  box(DW + .55, .35, .8, gilt, 0, DH + .17, -.2);
  for (const s of [-1, 1]) { const d = box(DW / 2 - .1, DH - .1, .12, std({color: 0x3a2a17, metalness: .4, roughness: .45}), s * (DW / 2 + .2), DH / 2, -1.2); d.rotation.y = -s * 1.25; } // doors swung open
  const doorGlow = glow('rgba(255,205,140,.55)', 9); doorGlow.position.set(0, 2.6, -2);
  // columns
  for (const x of [-11.6, -7.2, -3.4, 3.4, 7.2, 11.6]) {
    box(1.5, .4, 1.5, stone, x, .2, PD - 1);
    add(new THREE.CylinderGeometry(.56, .64, 8.6, 24), std({map: colT, roughness: .8}), x, 4.7, PD - 1);
    box(1.55, .5, 1.55, stone, x, 9.25, PD - 1);
  }
  // entablature with the name cut into the frieze
  const frieze = tex(2048, 128, (g, w, h) => { g.fillStyle = '#d6cebd'; g.fillRect(0, 0, w, h); noise(g, w, h, .06);
    g.font = `700 92px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText('D R O P H A L L', w / 2 + 2, h / 2 + 4); g.fillStyle = '#4a4134'; g.fillText('D R O P H A L L', w / 2, h / 2 + 2); });
  box(27.5, .5, PD + .4, stone, 0, 9.75, PD / 2 - .2);
  add(new THREE.PlaneGeometry(27.5, 1.25), std({map: frieze, roughness: .85}), 0, 10.62, PD);
  box(27.5, 1.25, PD, stone, 0, 10.62, PD / 2 - .02);
  box(28.3, .35, PD + .6, stone, 0, 11.4, PD / 2 - .1);
  const tri = new THREE.Shape(); tri.moveTo(-14.1, 0); tri.lineTo(14.1, 0); tri.lineTo(0, 3.4); tri.lineTo(-14.1, 0);
  add(new THREE.ExtrudeGeometry(tri, {depth: PD + .5, bevelEnabled: false}), stone, 0, 11.57, -.4);
  // inscription over the door
  const lintel = tex(1024, 128, (g, w, h) => { g.fillStyle = '#d6cebd'; g.fillRect(0, 0, w, h); g.font = `700 54px ${DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#5a4f40'; g.fillText('MUSEUM OF NEW LAUNCHES', w / 2, h / 2 + 2); });
  add(new THREE.PlaneGeometry(8, 1), std({map: lintel, roughness: .85}), 0, 7.2, .02);
  // banners between the columns
  const banner = tex(256, 1024, (g, w, h) => { g.fillStyle = '#5a1e25'; g.fillRect(0, 0, w, h); g.fillStyle = '#c9a45c'; g.fillRect(14, 14, w - 28, 4); g.fillRect(14, h - 18, w - 28, 4);
    g.textAlign = 'center'; g.font = `700 58px ${DISPLAY}`; g.fillText('NOW', w / 2, 170); g.fillText('ON', w / 2, 240); g.fillText('VIEW', w / 2, 310);
    g.fillRect(w / 2 - 40, 360, 80, 3); g.font = `italic 500 44px ${LABEL}`; wrapText(g, 'New launches, every week', w / 2, 450, w - 50, 54); });
  for (const s of [-1, 1]) add(new THREE.PlaneGeometry(1.7, 6.6), basic({map: banner, side: THREE.DoubleSide}), s * 5.3, 5.2, PD - .2);
  // lamp posts on the plaza
  for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(.07, .1, 4, 10), dark, s * 9, .8, 12); add(new THREE.SphereGeometry(.28, 16, 12), basic({color: 0xfff1d6}), s * 9, 3, 12); glow('rgba(255,210,150,.6)', 3.4).position.set(s * 9, 3, 12); }
  const flood = new THREE.DirectionalLight(0xffe2bd, .9); flood.position.set(0, 3, 30); flood.target.position.set(0, 6, 0); S.add(flood, flood.target);
  S.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2018, .5));

  // ---------- interior: lobby, galleries, final room ----------
  const H = 6.2;
  let z = 0;
  const K = []; // camera keyframes: {p:{x,y,z,yaw,pitch}, w, stop, room}
  const pose = (x, y, zz, tx, ty, tz) => { const dx = tx - x, dy = ty - y, dz = tz - zz; return {x, y, z: zz, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz))}; };
  const key = (p, w, extra = {}) => K.push({p, w, ...extra});
  const spot = (x, y, zz, tx, ty, tz) => { if (mobile) return; const l = new THREE.SpotLight(0xffe4bf, 1.5, 10, .42, .55, 1); l.position.set(x, y, zz); l.target.position.set(tx, ty, tz); S.add(l, l.target); };

  function room(len, half, wallHex, floorKind, ceilingGlow = true) {
    const z0 = z, z1 = z - len, mid = (z0 + z1) / 2;
    add(new THREE.PlaneGeometry(half * 2, len), floorMat(floorKind, half * 2, len), 0, 0, mid, 0, -Math.PI / 2);
    add(new THREE.PlaneGeometry(half * 2, len), plaster, 0, H, mid, 0, Math.PI / 2);
    const wm = wallMat(wallHex);
    for (const s of [-1, 1]) {
      add(new THREE.PlaneGeometry(len, H), wm, s * half, H / 2, mid, -s * Math.PI / 2);
      box(.04, .06, len, brass, s * (half - .02), 1.05, mid);   // picture rail at dado height
      box(.06, .22, len, dark, s * (half - .03), .11, mid);     // skirting
    }
    if (ceilingGlow) { add(new THREE.PlaneGeometry(2.4, len - 3), basic({color: 0xfff5e4}), 0, H - .01, mid, 0, Math.PI / 2); // skylight strip
    }
    const pl = new THREE.PointLight(0xffe9cc, mobile ? 1.1 : .75, len * 1.3, 1); pl.position.set(0, H - .8, mid); S.add(pl);
    z = z1; return {z0, z1, half};
  }
  // partition with an arched-top doorway and a gallery plaque above it
  function doorway(half, wallHex, title, sub) {
    const wm = wallMat(wallHex), dw = 3.4, dh = 4;
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(half - dw / 2, H), wm, s * (dw / 2 + (half - dw / 2) / 2), H / 2, z);
    add(new THREE.PlaneGeometry(dw, H - dh), wm, 0, dh + (H - dh) / 2, z);
    for (const s of [-1, 1]) box(.18, dh, .3, gilt, s * (dw / 2 + .09), dh / 2, z);
    box(dw + .36, .18, .3, gilt, 0, dh + .09, z);
    const t = tex(1024, 220, (g, w, h) => { g.fillStyle = '#16181f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a45c'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
      g.textAlign = 'center'; g.fillStyle = '#c9a45c'; g.font = `600 34px ${BODY}`; g.fillText(sub.toUpperCase().split('').join(' '), w / 2, 76);
      g.fillStyle = '#ece8e1'; g.font = `700 74px ${DISPLAY}`; g.fillText(title.toUpperCase(), w / 2, 160); });
    add(new THREE.PlaneGeometry(3.6, .78), basic({map: t}), 0, dh + .95, z + .03);
  }
  // wall label next to an exhibit
  const labelTex = e => tex(512, 340, (g, w, h) => { g.fillStyle = '#f1ede5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1b19'; g.font = `700 44px ${DISPLAY}`; g.fillText(e.name, 34, 74);
    g.fillStyle = '#514c43'; g.font = `italic 500 34px ${LABEL}`; g.fillText(`${e.maker}, ${e.year}`, 34, 122);
    g.font = `500 22px ${BODY}`; g.fillStyle = '#3c3933'; wrapText(g, e.medium, 34, 176, w - 68, 30);
    g.fillStyle = '#cfc8ba'; g.fillRect(34, 262, w - 68, 2);
    g.fillStyle = '#5d584f'; g.font = `500 20px ${BODY}`; g.fillText(e.acc, 34, 300);
    if (e.sample) { g.fillStyle = '#e2dccf'; g.fillRect(w - 150, 278, 116, 32); g.fillStyle = '#5d584f'; g.font = `600 18px ${BODY}`; g.fillText('SAMPLE', w - 132, 300); } });
  // the "screen" inside a frame: a launch-style title card in the exhibit's colour
  const screenTex = e => tex(1024, 768, (g, w, h) => { const gr = g.createRadialGradient(w * .7, h * .2, 20, w * .5, h * .5, w * .8); gr.addColorStop(0, e.color); gr.addColorStop(1, '#101218'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (const [i, c] of ['#ff5f57', '#febc2e', '#28c840'].entries()) { g.fillStyle = c; g.beginPath(); g.arc(40 + i * 30, 36, 9, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 70, w, 2);
    g.fillStyle = '#fff'; g.font = `700 120px ${BODY}`; g.fillText(e.name, 70, 300);
    g.fillStyle = 'rgba(255,255,255,.82)'; g.font = `500 36px ${BODY}`; wrapText(g, e.desc.split('. ')[0] + '.', 72, 370, w - 150, 48);
    g.fillStyle = e.color; g.fillRect(72, 600, 260, 70); g.fillStyle = '#101218'; g.font = `600 32px ${BODY}`; g.fillText('Get started', 106, 646);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(356, 600, 230, 70); g.fillStyle = '#fff'; g.fillText('Learn more', 384, 646); });
  const posterTex = e => tex(640, 896, (g, w, h) => { g.fillStyle = e.color; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1b19'; g.beginPath(); g.arc(w * .62, h * .36, 210, 0, 7); g.fill();
    g.fillStyle = '#f1ede5'; g.beginPath(); g.arc(w * .62, h * .36, 120, 0, 7); g.fill();
    g.fillStyle = '#1c1b19'; g.font = `800 92px ${DISPLAY}`; g.fillText('LAUNCH', 40, h - 250); g.fillText('NIGHT', 40, h - 150);
    g.font = `600 26px ${BODY}`; g.fillText('SAMPLE POSTER', 44, h - 80); });

  // build an exhibit; returns the camera pose that frames it
  function exhibit(e, s, ez, half) {
    const g = new THREE.Group(), onWall = e.kind !== 'case';
    g.position.set(onWall ? s * (half - .02) : s * (half - 2.4), 0, ez); g.rotation.y = -s * Math.PI / 2; S.add(g);
    if (onWall) {
      const poster = e.kind === 'poster', aw = poster ? 1.6 : 2.6, ah = poster ? 2.24 : 1.95, cy = poster ? 2.35 : 2.4, fw = poster ? .07 : .16;
      add(new THREE.PlaneGeometry(aw, ah), basic({map: poster ? posterTex(e) : screenTex(e)}), 0, cy, .1, 0, 0, g);
      const fm = poster ? dark : gilt;
      box(aw + fw * 2, fw, .14, fm, 0, cy + ah / 2 + fw / 2, .06, g); box(aw + fw * 2, fw, .14, fm, 0, cy - ah / 2 - fw / 2, .06, g);
      box(fw, ah, .14, fm, -aw / 2 - fw / 2, cy, .06, g); box(fw, ah, .14, fm, aw / 2 + fw / 2, cy, .06, g);
      add(new THREE.PlaneGeometry(.66, .44), basic({map: labelTex(e)}), aw / 2 + .7, 1.5, .02, 0, 0, g);
      glow('rgba(255,225,180,.28)', 4.2, g).position.set(0, cy + .3, .2);
      // rope barrier
      for (const x of [-1.7, 1.7]) { add(new THREE.CylinderGeometry(.16, .18, .04, 20), brass, x, .02, 1.3, 0, 0, g); add(new THREE.CylinderGeometry(.025, .025, .95, 10), brass, x, .48, 1.3, 0, 0, g); add(new THREE.SphereGeometry(.05, 12, 8), brass, x, .97, 1.3, 0, 0, g); }
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-1.7, .9, 1.3), new THREE.Vector3(0, .45, 1.3), new THREE.Vector3(1.7, .9, 1.3));
      add(new THREE.TubeGeometry(curve, 24, .025, 8), velvet, 0, 0, 0, 0, 0, g);
      g.updateMatrixWorld();
      const world = v => g.localToWorld(new THREE.Vector3(...v));
      const sx = mobile ? 0 : poster ? .5 : .8; // on desktop, shift the art left so the HTML label on the right doesn't cover it
      const c = world([sx, 1.7, mobile ? 5.0 : 4.6]), t = world([sx, 2.05, 0]);
      spot(...world([0, H - .3, 2.2]).toArray(), ...world([0, cy, 0]).toArray());
      return pose(c.x, c.y, c.z, t.x, t.y, t.z);
    }
    // glass case on a plinth
    box(.95, 1.1, .95, plaster, 0, .55, 0, g);
    add(new THREE.PlaneGeometry(.5, .33), basic({map: labelTex(e)}), 0, .82, .48, 0, 0, g);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(.9, 1.05, .9), std({color: 0xdfe9ef, transparent: true, opacity: .1, roughness: .05, metalness: .1, depthWrite: false}));
    glass.position.set(0, 1.63, 0); g.add(glass);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({color: 0xe8eef2, transparent: true, opacity: .45}));
    edges.position.copy(glass.position); g.add(edges);
    box(.92, .04, .92, brass, 0, 1.1, 0, g);
    const obj = new THREE.Group(); obj.position.set(0, 1.12, 0); g.add(obj);
    const col = new THREE.Color(e.color), m = std({color: col, roughness: .4, metalness: .2}), accent = std({color: 0x1f2126, roughness: .5});
    if (e.shape === 'bottle') { add(new THREE.CylinderGeometry(.13, .13, .5, 32), m, 0, .3, 0, 0, 0, obj); add(new THREE.CylinderGeometry(.09, .13, .08, 32), m, 0, .59, 0, 0, 0, obj); add(new THREE.CylinderGeometry(.09, .09, .1, 32), accent, 0, .68, 0, 0, 0, obj); }
    else if (e.shape === 'buds') { const cs = add(new THREE.CapsuleGeometry(.12, .16, 8, 24), m, 0, .2, 0, 0, 0, obj); cs.rotation.z = Math.PI / 2; cs.scale.set(1, 1, .7);
      for (const x of [-.09, .09]) { add(new THREE.SphereGeometry(.05, 20, 14), m, x, .4, 0, 0, 0, obj); add(new THREE.CylinderGeometry(.015, .015, .09, 10), m, x, .33, 0, 0, 0, obj); } }
    else if (e.shape === 'speaker') { add(new THREE.BoxGeometry(.38, .38, .38), m, 0, .2, 0, 0, 0, obj); add(new THREE.BoxGeometry(.39, .04, .39), std({color: 0x7a4e2c, roughness: .6}), 0, .41, 0, 0, 0, obj);
      add(new THREE.CircleGeometry(.12, 32), accent, 0, .2, .192, 0, 0, obj); }
    else add(new THREE.BoxGeometry(.4, .4, .4), m, 0, .2, 0, 0, 0, obj);
    spinners.push(obj);
    glow('rgba(255,235,200,.35)', 1.6, g).position.set(0, 1.9, 0);
    g.updateMatrixWorld();
    const world = v => g.localToWorld(new THREE.Vector3(...v));
    const c = world([0, 1.75, mobile ? 3.4 : 3.1]), t = world([0, 1.45, 0]);
    spot(...world([0, H - .3, .6]).toArray(), ...world([0, 1.4, 0]).toArray());
    return pose(c.x, c.y, c.z, t.x, t.y, t.z);
  }
  const spinners = [];

  // keyframes outside and up the steps
  key(pose(0, .7, 24, 0, 5.4, 0), 0, {intro: true});
  key(pose(0, .5, 11, 0, 4.2, 0), 1.2);
  key(pose(0, 1.7, 1.2, 0, 1.8, -10), 1.1);

  // lobby with the directory board
  const LH = 7;
  const lobby = room(12, LH, '#8c7f6a', 'marble');
  const dir = tex(1024, 1024, (g, w, h) => { g.fillStyle = '#16181f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a45c'; g.lineWidth = 10; g.strokeRect(20, 20, w - 40, h - 40);
    g.fillStyle = '#c9a45c'; g.textAlign = 'center'; g.font = `700 92px ${DISPLAY}`; g.fillText('DIRECTORY', w / 2, 160); g.fillRect(w / 2 - 80, 200, 160, 4);
    g.textAlign = 'left'; const rows = [...ROOMS.map(r => r.name), 'Your launch here'];
    rows.forEach((r, i) => { const y = 320 + i * 150; g.fillStyle = '#c9a45c'; g.font = `600 34px ${BODY}`; g.fillText('GALLERY ' + (i + 1), 90, y - 46);
      g.fillStyle = '#ece8e1'; g.font = `700 62px ${DISPLAY}`; g.fillText(r, 90, y + 22); }); });
  add(new THREE.PlaneGeometry(3, 3), basic({map: dir}), LH - .11, 2.9, -6, -Math.PI / 2);
  box(.12, 3.2, 3.2, gilt, LH - .03, 2.9, -6);
  box(2.6, 1.1, .9, std({color: 0x3b2a1a, roughness: .5}), -LH + 1.6, .55, -6.5); box(2.7, .06, 1, brass, -LH + 1.6, 1.13, -6.5); // info desk
  for (const zz of [-3.5, -9]) box(2, .45, .55, std({color: 0x2c2f38, roughness: .5}), 0, .3, zz); // benches
  const LOBBY = {lobby: true}, FINAL = {final: true};
  key(pose(1.6, 1.7, -6, LH, 2.7, -6), 1.2, {stop: LOBBY, room: 'Lobby'});
  key(K[K.length - 1].p, .5, {stop: LOBBY, room: 'Lobby', hold: true});

  // galleries
  ROOMS.forEach((r, ri) => {
    const items = EXHIBITS.filter(e => e.room === r.id); if (!items.length) return;
    const half = 6, gap = 5, len = 5 + (items.length - 1) * gap + 6;
    doorway(ri === 0 ? LH : 6, ri === 0 ? '#8c7f6a' : ROOMS[ri - 1].wall, r.name, 'Gallery ' + (ri + 1));
    key(pose(0, 1.7, z + 3, 0, 2.6, z - 4), 1, {door: true});
    const g = room(len, half, r.wall, r.floor);
    key(pose(0, 1.7, g.z0 - 1, 0, 1.8, g.z0 - 12), .8, {room: r.name});
    items.forEach((e, i) => {
      const s = i % 2 ? 1 : -1, ez = g.z0 - 5 - i * gap;
      const p = exhibit(e, s, ez, half);
      key(p, 1, {stop: e, room: r.name}); key(p, .55, {stop: e, room: r.name, hold: true});
      if (i < items.length - 1) key(pose(0, 1.7, ez - gap / 2 + .6, 0, 1.8, ez - gap / 2 - 10), .55, {room: r.name});
    });
  });

  // final room: an empty case waiting for the next launch
  doorway(6, ROOMS[ROOMS.length - 1].wall, 'Your launch here', 'Gallery ' + (ROOMS.length + 1));
  key(pose(0, 1.7, z + 3, 0, 2.6, z - 4), 1, {door: true});
  const fin = room(12, 6, '#3a2f22', 'marble');
  add(new THREE.PlaneGeometry(12, H), wallMat('#3a2f22'), 0, H / 2, fin.z1);
  const res = tex(1024, 512, (g, w, h) => { g.fillStyle = '#16181f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a45c'; g.lineWidth = 8; g.strokeRect(16, 16, w - 32, h - 32);
    g.textAlign = 'center'; g.fillStyle = '#c9a45c'; g.font = `600 34px ${BODY}`; g.fillText('R E S E R V E D', w / 2, 120);
    g.fillStyle = '#ece8e1'; g.font = `700 82px ${DISPLAY}`; g.fillText('YOUR LAUNCH', w / 2, 240); g.fillText('STANDS HERE', w / 2, 330);
    g.fillStyle = '#c9a45c'; g.font = `italic 500 44px ${LABEL}`; g.fillText('Message @drophall to take this case', w / 2, 420); });
  add(new THREE.PlaneGeometry(4, 2), basic({map: res}), 0, 3.6, fin.z1 + .03);
  const ez = fin.z1 + 4.5;
  box(1.2, 1.1, 1.2, plaster, 0, .55, ez);
  const fg = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.3, 1.15), std({color: 0xdfe9ef, transparent: true, opacity: .1, roughness: .05, depthWrite: false})); fg.position.set(0, 1.75, ez); S.add(fg);
  const fe = new THREE.LineSegments(new THREE.EdgesGeometry(fg.geometry), new THREE.LineBasicMaterial({color: 0xe8eef2, transparent: true, opacity: .5})); fe.position.copy(fg.position); S.add(fe);
  glow('rgba(255,225,170,.5)', 3).position.set(0, 1.9, ez);
  const beam = add(new THREE.CylinderGeometry(.35, 1.1, H - 1.1, 32, 1, true), basic({color: 0xffe9c4, transparent: true, opacity: .06, depthWrite: false, side: THREE.DoubleSide}), 0, 1.1 + (H - 1.1) / 2, ez);
  beam.renderOrder = 2;
  const fs = new THREE.SpotLight(0xffe4bf, 2.2, 10, .35, .5, 1); fs.position.set(0, H - .2, ez); fs.target.position.set(0, 1, ez); S.add(fs, fs.target);
  const finalPose = pose(0, 1.75, fin.z0 - 1.5, 0, 2.2, fin.z1);
  key(finalPose, 1.4, {stop: FINAL, room: 'Your launch here'});
  key(finalPose, .6, {stop: FINAL, room: 'Your launch here', hold: true});

  // ---------- scroll → camera ----------
  const cum = []; let tot = 0; K.forEach(k => { tot += k.w; cum.push(tot); });
  walk.style.height = Math.round(100 + tot * 42) + 'vh';
  const stops = [...new Set(K.filter(k => k.hold).map(k => k.stop))];
  mapEl.innerHTML = stops.map(() => '<li></li>').join('');
  const ease = t => t * t * (3 - 2 * t), clamp = v => Math.min(1, Math.max(0, v));
  const lerpA = (a, b, t) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * t;

  let u = 0, su = 0, visible = true;
  const progress = () => { const r = walk.getBoundingClientRect(); visible = r.bottom > 0; u = clamp(-r.top / Math.max(1, walk.offsetHeight - innerHeight)); };
  addEventListener('scroll', progress, {passive: true});
  function size() { const w = innerWidth, h = innerHeight; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  addEventListener('resize', () => { size(); progress(); }); size(); progress(); su = u;

  let shown = null, shownRoom = null;
  const escH = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function showPlacard(st) {
    if (st === shown) return; shown = st;
    if (!st) { placard.classList.remove('on'); }
    else {
      if (st.lobby) placard.innerHTML = `<h3>Welcome to DropHall</h3><div class="by">The lobby</div><p>${ROOMS.length + 1} galleries of new launches. Keep scrolling to walk through them.</p><div class="meta"><span>${EXHIBITS.length} pieces on display</span><span>Open daily</span></div>`;
      else if (st.final) placard.innerHTML = `<h3>This case is empty</h3><div class="by">Reserved for your launch</div><p>Put your product here. Framed screens, glass cases, posters and whole rooms are available.</p><a class="go" href="#exhibit">Exhibit your launch</a><div class="meta"><span>Gallery ${ROOMS.length + 1}</span><span>Available now</span></div>`;
      else placard.innerHTML = `<h3>${escH(st.name)}${st.sample ? '<span class="tag-sample">Sample</span>' : ''}</h3><div class="by">${escH(st.maker)}, ${st.year}</div><p>${escH(st.desc)}</p>${st.url ? `<a class="go" href="${escH(st.url)}" target="_blank" rel="noopener">Visit ${escH(st.name)}</a>` : ''}<div class="meta"><span>${escH(st.medium)}</span><span>${st.acc}</span></div>`;
      placard.classList.remove('on'); void placard.offsetWidth; placard.classList.add('on');
    }
    const i = stops.indexOf(st);
    [...mapEl.children].forEach((d, j) => { d.classList.toggle('now', j === i); });
  }

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);
    if (!visible) { cv.style.visibility = 'hidden'; return; }
    cv.style.visibility = 'visible';
    su += (u - su) * (1 - Math.exp(-dt * (still ? 30 : 5))); if (window.museumSnap) su = u; // test hook: jump straight to the scroll position
    const t = su * tot;
    let i = cum.findIndex(c => c >= t); if (i < 1) i = 1;
    const a = K[i - 1], b = K[i], f = clamp((t - cum[i - 1]) / (b.w || 1)), e = ease(f);
    cam.position.set(a.p.x + (b.p.x - a.p.x) * e, a.p.y + (b.p.y - a.p.y) * e, a.p.z + (b.p.z - a.p.z) * e);
    cam.rotation.y = lerpA(a.p.yaw, b.p.yaw, e); cam.rotation.x = a.p.pitch + (b.p.pitch - a.p.pitch) * e;
    if (!still) spinners.forEach(o => o.rotation.y += dt * .6);
    doorGlow.visible = cam.position.z > 2; // the warm spill is for the street view; inside it would wash out the lobby

    intro.classList.toggle('gone', t > .35);
    const st = b.hold ? b.stop : (f > .7 && b.stop) ? b.stop : (f < .3 && a.hold) ? a.stop : null;
    showPlacard(st || null);
    const rn = t < 2 || a.door || b.door ? null : (b.room || a.room || null); // hide near doorways, where the gallery's own plaque is in view
    if (rn !== shownRoom) { shownRoom = rn; sign.textContent = rn || ''; sign.classList.toggle('on', !!rn); }
    const passed = K.filter((k, j) => k.hold && cum[j] <= t + .01).map(k => k.stop);
    [...mapEl.children].forEach((d, j) => d.classList.toggle('done', passed.includes(stops[j])));
    R.render(S, cam);
  }
  frame();
})();

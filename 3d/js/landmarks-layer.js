// Custom layer MapLibre GL (three.js) per i monumenti di Milano, versione "lazy" di D-landmarks/landmarks-layer.js.
// Differenze rispetto a D: i .glb si scaricano solo quando il monumento entra nell'inquadratura (e lo zoom e' sufficiente),
// al massimo 2 alla volta; i monumenti fuori schermo non si disegnano; callback onLoad/onFail per il ripiego.
// Convenzione dei modelli: metri, Y su, a rotazione 0 +x = est, +z = sud, origine al centro dell'impronta; rotation_deg oraria.
// Compatibile con MapLibre 4.x (render(gl, matrix)) e 5.x (render(gl, {defaultProjectionData})); qui provato con 5.6.0.
// v2: lo stesso layer disegna anche i tetti (celle da ~235 m, costruite al volo da js/scena.js) con la stessa luce dei monumenti,
// cosi' c'e' un solo renderer three e un solo modello di luce (formula di MapLibre, vedi scena.js).

export function createLandmarksLayer({ THREE, GLTFLoader, maplibregl, landmarks, baseUrl, minZoom = 12.8, scena, fonti = {}, opz = {}, luce = {},
  tint = [0.957, 0.949, 0.929], onLoad = () => {}, onFail = () => {}, id = 'monumenti-3d' }) {
  const state = { map: null, renderer: null, scene: null, camera: null, items: [], loading: 0, queue: [], mats: null };
  const O = { tettiZoom: 15.8, maxCelle: 70, maxCache: 160, ...opz };
  const celle = new Map();      // chiave cella -> { cx, cy, L, scena (THREE.Scene), tetti, ... }
  const stats = { celleViste: 0, tettiTri: 0, celleCostruite: 0, ms: 0 };
  const rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);   // da Y-su (three) a Z-su (mercatore)
  const v = new THREE.Vector4();

  const items = landmarks.map((lm) => {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lm.lon, lm.lat], 0);
    const s = mc.meterInMercatorCoordinateUnits();
    const L = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s)).multiply(rotX);
    return { lm, L, group: null, status: 'idle', R: Math.max(...lm.footprint_m) * 0.5 };
  });
  state.items = items;

  function load(it) {
    it.status = 'loading'; state.loading++;
    state.loader.load(new URL(it.lm.file, baseUrl).href, (g) => {
      const group = new THREE.Group();
      group.add(g.scene);
      g.scene.traverse((o) => { if (o.isMesh) { if (!o.geometry.attributes.normal) { o.geometry = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; o.geometry.computeVertexNormals(); } o.frustumCulled = false; o.material = state.mats.monumento(tint); o.material.side = THREE.DoubleSide; } });
      group.rotation.y = -(it.lm.rotation_deg * Math.PI) / 180;       // rotazione oraria (bussola)
      const sc = it.lm.scale || 1; group.scale.set(sc, sc, sc);
      group.visible = false; state.scene.add(group);
      it.group = group; it.status = 'ready'; state.loading--;
      state.map.triggerRepaint(); onLoad(it.lm); pump();
    }, undefined, (e) => { it.status = 'error'; state.loading--; console.warn('monumento non caricato', it.lm.id, e); onFail(it.lm, e); pump(); });
  }
  function pump() {
    while (state.loading < 2 && state.queue.length) { const it = state.queue.shift(); if (it.status === 'queued') load(it); }
  }

  // il centro e il raggio del monumento sono dentro l'inquadratura? (coordinate normalizzate dello schermo)
  function inView(m, it) {
    v.set(0, 0, 0, 1).applyMatrix4(m); if (v.w <= 0) return false;
    const cx = v.x / v.w, cy = v.y / v.w;
    v.set(it.R, 0, 0, 1).applyMatrix4(m);
    const rx = v.x / v.w - cx, ry = v.y / v.w - cy, r = Math.hypot(rx, ry) * 1.6 + 0.05;
    return Math.abs(cx) - r < 1 && Math.abs(cy) - r < 1;
  }

  /* ---------- celle di tetti ---------- */
  const key = (cx, cy) => cx * 1024 + cy;
  function cella(cx, cy) {
    const k = key(cx, cy); let c = celle.get(k);
    if (!c) {
      const lon = 9.0 + (cx + 0.5) * scena.CELLA * 6e-6, lat = 45.3 + (cy + 0.5) * scena.CELLA * 4.2e-6;
      const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0), sc = mc.meterInMercatorCoordinateUnits();
      c = { k, cx, cy, ox: (cx + 0.5) * scena.CELLA * scena.FX, oy: (cy + 0.5) * scena.CELLA * scena.FY, R: 190, tetti: 'no', uso: 0,
        L: new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(sc, -sc, sc)).multiply(rotX), scena: new THREE.Scene(), lon, lat };
      celle.set(k, c);
    }
    return c;
  }
  function costruisci(c, tipo) {
    const t0 = performance.now();
    if (tipo === 'tetti') {
      c.tetti = 'fatto';
      const idxs = fonti.edifici?.cells.get(c.k);
      const r = idxs && scena.tettiCella(THREE, fonti.edifici, idxs, c.ox, c.oy);
      if (r) { c.meshTetti = new THREE.Mesh(r.geom, state.matTetti); c.meshTetti.frustumCulled = false; c.scena.add(c.meshTetti); c.nTetti = r.n; c.tri = r.geom.attributes.position.count / 3; }
    }
    stats.celleCostruite++; stats.ms += performance.now() - t0;
  }
  function libera(c) {
    if (c.meshTetti) { c.meshTetti.geometry.dispose(); c.meshTetti.dispose?.(); }
    celle.delete(c.k);
  }
  let visibili = [];
  function drawCelle(r, cam, mm, zoom) {
    const vt = zoom >= O.tettiZoom && fonti.edifici;
    if (!vt) { visibili = []; stats.celleViste = 0; return; }
    const ct = state.map.getCenter(), ccx = Math.floor((ct.lng - 9.0) / 6e-6 / scena.CELLA), ccy = Math.floor((ct.lat - 45.3) / 4.2e-6 / scena.CELLA);
    const rad = Math.ceil(Math.sqrt(O.maxCelle / Math.PI * 1.6)) + 1, cand = [];
    for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
      const d2 = dx * dx + dy * dy; if (d2 > rad * rad) continue;
      cand.push([d2, ccx + dx, ccy + dy]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const vis = []; let costruiti = 0, tri = 0, pendenti = false;
    for (const [, cx, cy] of cand) {
      if (vis.length >= O.maxCelle) break;
      const c = cella(cx, cy);
      cam.projectionMatrix.copy(mm).multiply(c.L);
      if (!inView(cam.projectionMatrix, c)) continue;
      if (vt && c.tetti === 'no') { if (costruiti < 2) { costruisci(c, 'tetti'); costruiti++; } else pendenti = true; }      // al massimo 2 celle per fotogramma: niente scatti
      c.uso = performance.now(); vis.push(c);
    }
    if (celle.size > O.maxCache) {
      const vecchie = [...celle.values()].filter((c) => !vis.includes(c)).sort((a, b) => a.uso - b.uso);
      for (const c of vecchie.slice(0, celle.size - O.maxCache)) libera(c);
    }
    r.resetState();
    for (const c of vis) {
      if (c.meshTetti) c.meshTetti.visible = !!vt;
      if (!c.meshTetti?.visible) continue;
      cam.projectionMatrix.copy(mm).multiply(c.L);
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      r.render(c.scena, cam);
      tri += c.tri;
    }
    r.resetState();
    visibili = vis; stats.celleViste = vis.length; stats.tettiTri = tri;
    if (pendenti) state.map.triggerRepaint();
  }

  const layer = {
    id, type: 'custom', renderingMode: '3d', items,
    onAdd(map, gl) {
      state.map = map;
      state.camera = new THREE.Camera(); state.scene = new THREE.Scene();
      state.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      state.renderer.autoClear = false;
      state.mats = scena.materiali(THREE, luce);
      state.matTetti = state.mats.tetti();
      state.loader = new GLTFLoader();
    },
    render(gl, args) {
      const zoom = state.map.getZoom();
      if (zoom < Math.min(minZoom, O.tettiZoom)) return;
      const m = Array.isArray(args) || ArrayBuffer.isView(args) ? args : (args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix);
      const r = state.renderer, cam = state.camera;
      const mm = new THREE.Matrix4().fromArray(m);
      let drawn = 0;
      for (const it of items) {
        if (zoom < minZoom) break;
        const proj = cam.projectionMatrix.copy(mm).multiply(it.L);
        if (!inView(proj, it)) continue;
        if (it.status === 'idle') { it.status = 'queued'; state.queue.push(it); pump(); continue; }
        if (it.status !== 'ready') continue;
        if (!drawn) r.resetState();
        it.group.visible = true;
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
        r.render(state.scene, cam);
        it.group.visible = false; drawn++;
      }
      if (drawn) r.resetState();
      state.drawn = drawn;
      drawCelle(r, cam, mm, zoom);
    },
    onRemove() { state.renderer?.dispose?.(); },
    stats: () => ({ ...stats, celleInCache: celle.size }),
    stato: () => ({ drawn: state.drawn || 0, caricati: items.filter((i) => i.status === 'ready').map((i) => i.lm.id), errori: items.filter((i) => i.status === 'error').map((i) => i.lm.id) }),
  };
  return layer;
}

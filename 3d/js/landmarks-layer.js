// Custom layer MapLibre GL (three.js) per i monumenti di Milano, versione "lazy" di D-landmarks/landmarks-layer.js.
// Differenze rispetto a D: i .glb si scaricano solo quando il monumento entra nell'inquadratura (e lo zoom e' sufficiente),
// al massimo 2 alla volta; i monumenti fuori schermo non si disegnano; callback onLoad/onFail per il ripiego.
// Convenzione dei modelli: metri, Y su, a rotazione 0 +x = est, +z = sud, origine al centro dell'impronta; rotation_deg oraria.
// Compatibile con MapLibre 4.x (render(gl, matrix)) e 5.x (render(gl, {defaultProjectionData})); qui provato con 5.6.0.

export function createLandmarksLayer({ THREE, GLTFLoader, maplibregl, landmarks, baseUrl, minZoom = 12.8,
  sun = [-0.55, 0.85, 0.5], tint = 0xf4f1ea, onLoad = () => {}, onFail = () => {}, id = 'monumenti-3d' }) {
  const state = { map: null, renderer: null, scene: null, camera: null, items: [], loading: 0, queue: [] };
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
      g.scene.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.material.color.set(tint); } });
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

  const layer = {
    id, type: 'custom', renderingMode: '3d', items,
    onAdd(map, gl) {
      state.map = map;
      state.camera = new THREE.Camera(); state.scene = new THREE.Scene();
      state.scene.add(new THREE.HemisphereLight(0xffffff, 0xeeebe6, 2.0));
      const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(...sun); state.scene.add(d);
      state.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      state.renderer.autoClear = false;
      state.loader = new GLTFLoader();
    },
    render(gl, args) {
      if (state.map.getZoom() < minZoom) return;
      const m = Array.isArray(args) || ArrayBuffer.isView(args) ? args : (args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix);
      const r = state.renderer, cam = state.camera;
      const mm = new THREE.Matrix4().fromArray(m);
      let drawn = 0;
      for (const it of items) {
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
    },
    onRemove() { state.renderer?.dispose?.(); },
    stato: () => ({ drawn: state.drawn || 0, caricati: items.filter((i) => i.status === 'ready').map((i) => i.lm.id), errori: items.filter((i) => i.status === 'error').map((i) => i.lm.id) }),
  };
  return layer;
}

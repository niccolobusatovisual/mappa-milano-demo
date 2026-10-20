"use strict";
/* ============================================================================================
   Milano 3D, versione FINAL: dati cotti (B) + monumenti (D) + pin accessibili (A+B).
   File: dati/edifici-grandi.bin (sempre), dati/edifici-minori.bin + dati/ombre.bin (su richiesta da zoom ~13),
         dati/sostituiti.bin, dati/base.bin, dati/luoghi.json, dati/landmarks.json, glb/*.glb e three (solo da zoom medio).
   Nessun servizio di terzi a runtime: niente tile, glifi, font remoti.
   ============================================================================================ */
const T0 = performance.now();
const LON0 = 9.0, LAT0 = 45.3, ULON = 6e-6, ULAT = 4.2e-6;          // stessi valori di rigenera/codec.py
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const P = new URLSearchParams(location.search);
if (P.get('scheda') === '0') document.body.classList.add('senza-scheda');   // incorporata: la scheda la mostra il gestionale
const TOUCH = P.get('lod') ? P.get('lod') === 'basso' : matchMedia('(pointer: coarse)').matches;

/* ---------- soglie del LOD (documentate in RISULTATI.md) ---------- */
const LOD = TOUCH
  ? { minoriZoom: 14.4, ombreZoom: 15.0, ombraMinL: 7, bande: false, monZoom: 13.4, dpr: Math.min(devicePixelRatio || 1, 2), aa: false }
  : { minoriZoom: 13.6, ombreZoom: 14.0, ombraMinL: 0, bande: true, monZoom: 12.8, dpr: devicePixelRatio || 1, aa: true };
const BANDA_H = 8;       // m: sotto questa quota le pareti sono piu' scure (sfumatura alla base)

const CATS = [
  ['scuole', 'Scuole', '#2f6fde', 'M2 9l10-5 10 5-10 5z M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5'],
  ['universita', 'Università', '#7a56e0', 'M3 10l9-6 9 6 M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 20h18'],
  ['cultura', 'Cultura', '#d6336c', 'M12 3a9 9 0 100 18 9 9 0 000-18z M8.5 14c1 1.5 2.2 2.2 3.5 2.2s2.5-.7 3.5-2.2 M9 9.5h.01 M15 9.5h.01'],
  ['biblioteche', 'Biblioteche', '#0f9aa8', 'M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z M12 6.5v13'],
  ['spettacolo', 'Spettacolo', '#e8590c', 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z'],
  ['musei', 'Musei', '#b8860b', 'M4 5h16v14H4z M7 16l3.5-4 2.5 3 2-2 3 3'],
  ['associazioni', 'Associazioni', '#2b9348', 'M9 11a3 3 0 100-6 3 3 0 000 6z M3 19c0-3 2.7-5 6-5s6 2 6 5 M16.5 11a2.6 2.6 0 100-5.2 M17 14.2c2.4.3 4 2 4 4.8'],
  ['culto', 'Luoghi di culto', '#8a715a', 'M12 3v4 M10 5h4 M5 21V12l7-5 7 5v9z M10 21v-5h4v5'],
  ['sanita', 'Sanità', '#9c27b0', 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z'],
  ['sport', 'Sport', '#12a37f', 'M12 3a9 9 0 100 18 9 9 0 000-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18'],
  ['mercati', 'Mercati', '#a61e4d', 'M3 9h18l-2 11H5z M8 9l3-5 M16 9l-3-5']
];
const CAT_IDX = Object.fromEntries(CATS.map((c, i) => [c[0], i]));
const $ = s => document.querySelector(s);
const stato = { cats: new Set(CATS.map((_, i) => i)), mun: null, q: '', luoghi: [], byId: new Map(), filtrati: [], sel: null,
  minori: 'no', monumenti: 'no', monLayer: null, caricati: new Set(),
  done: new Set(), hp: new Set(), hidden: new Set(), ids: null, nBase: 0 };   // done/hp/hidden/ids: dal gestionale (messaggi 'state' e 'filter')
const dbg = {};
const msgs = [];                                   // messaggi inviati al genitore (utile ai test)

/* ---------- decodifica del formato MB1 (vedi rigenera/codec.py) ---------- */
function decodeLayer(u8, off, line, onShape) {
  const dv = new DataView(u8.buffer, u8.byteOffset + off);
  const n = dv.getUint32(4, true), L = [];
  for (let i = 0; i < 5; i++) L.push(dv.getUint32(8 + 4 * i, true));
  let p = off + 28; const pos = [];
  for (let i = 0; i < 5; i++) { pos.push(p); p += L[i]; }
  const rd = (q) => { let v = 0, s = 0, b; do { b = u8[q.p++]; v += (b & 127) * Math.pow(2, s); s += 7; } while (b & 128); return v; };
  const A = { p: pos[0] }, R = { p: pos[1] }, K = { p: pos[2] }, X = { p: pos[3] }, Y = { p: pos[4] };
  const zz = v => (v % 2 ? -(v + 1) / 2 : v / 2);
  const minp = line ? 2 : 3;
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const attr = rd(A), nr = rd(R) + 1, rings = [];
    for (let j = 0; j < nr; j++) {
      const np = rd(K) + minp, ring = new Array(np + (line ? 0 : 1));
      let x = px + zz(rd(X)), y = py + zz(rd(Y)); px = x; py = y;
      ring[0] = [LON0 + x * ULON, LAT0 + y * ULAT];
      for (let m = 1; m < np; m++) { x += zz(rd(X)); y += zz(rd(Y)); ring[m] = [LON0 + x * ULON, LAT0 + y * ULAT]; }
      if (!line) ring[np] = ring[0];
      rings.push(ring);
    }
    onShape(attr, rings);
  }
}
function splitPack(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset), n = u8[0], offs = []; let o = 1 + 4 * n;
  for (let i = 0; i < n; i++) { offs.push(o); o += dv.getUint32(1 + 4 * i, true); }
  return offs;
}
async function scarica(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
const fc = f => ({ type: 'FeatureCollection', features: f });
function poligoni(u8, mappa) {
  const out = [];
  decodeLayer(u8, splitPack(u8)[0], false, (a, rings) => out.push({ type: 'Feature', properties: mappa(a), geometry: { type: 'Polygon', coordinates: rings } }));
  return out;
}

/* ---------- stile ---------- */
// colori: tetti bianchi che si scuriscono appena sui volumi bassi, pareti piu' scure alla base
const H = ['get', 'h'];
// esagerazione verticale solo da lontano (a zoom basso 100 m sono pochi pixel e la citta' sembrerebbe piatta): 3,2x a zoom 11, 2x a 12,5, 1x (altezze vere) da 14,5
const hz = (e) => ['interpolate', ['linear'], ['zoom'], 11, ['*', e, 3.2], 12.5, ['*', e, 2], 14.5, e];
const C_TETTO = ['interpolate', ['linear'], H, 0, '#e6e4df', 10, '#eeede9', 30, '#f8f7f5', 80, '#ffffff'];
const C_BASE = ['interpolate', ['linear'], H, 0, '#d9d7d2', 10, '#dedcd8', 30, '#e4e2de', 80, '#eae9e5'];
const stile = {
  version: 8, name: 'Milano chiara',
  // nessun "glyphs" e nessun "sprite": niente testi della mappa, quindi nessuna richiesta a terzi
  light: { anchor: 'map', color: '#ffffff', intensity: 0.26, position: [1.15, 225, 50] },
  sky: { 'sky-color': '#cfe0ee', 'horizon-color': '#f3f2ef', 'fog-color': '#eceae6', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.85, 'fog-ground-blend': 0.55, 'atmosphere-blend': 0 },
  sources: {}, layers: [{ id: 'sfondo', type: 'background', paint: { 'background-color': '#e9e7e2' } }]
};

const mappa = new maplibregl.Map({
  container: 'mappa', style: stile, center: [9.19, 45.4642], zoom: innerWidth < 700 ? 10.2 : 11.6, pitch: 56, bearing: -18,
  minZoom: 9.5, maxZoom: 19.5, maxPitch: 80, attributionControl: false, fadeDuration: REDUCED ? 0 : 150,
  maxBounds: [[8.9, 45.30], [9.45, 45.62]], pixelRatio: LOD.dpr, canvasContextAttributes: { antialias: LOD.aa }
});
mappa.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution:
  'Edifici: <a href="https://dati.comune.milano.it/dataset/ds2889_database-topografico-dbt-2020-shp" target="_blank" rel="noopener">DBT 2020 Comune di Milano</a> (CC BY 4.0) · ' +
  '<a href="https://overturemaps.org" target="_blank" rel="noopener">Overture Maps</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL) · modelli 3D propri' }), 'bottom-right');

const passo = (t, pct) => { $('#ptxt').textContent = t; $('#pb').style.width = pct + '%'; };
const annuncia = t => { const a = $('#annuncio'); a.textContent = ''; setTimeout(() => a.textContent = t, 30); };

/* ---------- livelli degli edifici (con la sfumatura alla base per altezza) ---------- */
function livelliEdifici(src, pref, minzoom) {
  const base = { source: src, minzoom };
  if (LOD.bande) {
    mappa.addLayer({ ...base, id: pref + '-base', type: 'fill-extrusion', paint: {
      'fill-extrusion-height': hz(['min', H, BANDA_H]), 'fill-extrusion-base': 0,
      'fill-extrusion-color': ['case', ['>', H, BANDA_H], C_BASE, C_TETTO], 'fill-extrusion-vertical-gradient': true } });
    mappa.addLayer({ ...base, id: pref + '-alto', type: 'fill-extrusion', filter: ['>', H, BANDA_H], paint: {
      'fill-extrusion-height': hz(H), 'fill-extrusion-base': hz(BANDA_H), 'fill-extrusion-color': C_TETTO, 'fill-extrusion-vertical-gradient': true } });
  } else {
    mappa.addLayer({ ...base, id: pref, type: 'fill-extrusion', paint: {
      'fill-extrusion-height': hz(H), 'fill-extrusion-base': 0, 'fill-extrusion-color': C_TETTO, 'fill-extrusion-vertical-gradient': true } });
  }
}

async function avvia() {
  try {
    passo('Scarico gli edifici...', 12);
    const tf = performance.now();
    const [bGr, bBase, bSost, jLuoghi] = await Promise.all([
      scarica('dati/edifici-grandi.bin'), scarica('dati/base.bin'), scarica('dati/sostituiti.bin'), fetch('dati/luoghi.json').then(r => r.json()),
      document.fonts.load('600 18px Oswald')]);
    dbg.fetch_ms = Math.round(performance.now() - tf);
    passo('Costruisco i volumi...', 45);
    await new Promise(r => setTimeout(r, 20));
    const td = performance.now();
    const grandi = poligoni(bGr, a => ({ h: a / 2 }));
    const sost = poligoni(bSost, a => ({ m: a >> 10, h: (a & 1023) / 2 }));
    const offs = splitPack(bBase), roads = [[], [], [], [], []], pg = [[], []];
    for (let l = 0; l < 2; l++) decodeLayer(bBase, offs[l], false, (a, rings) => pg[l].push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } }));
    for (let c = 0; c < 5; c++) decodeLayer(bBase, offs[2 + c], true, (a, rings) => roads[c].push(rings[0]));
    stato.luoghi = jLuoghi.map((r, i) => ({ i, c: r[0], lon: r[1], lat: r[2], nome: r[3], via: r[4], id: r[5], mun: r[6], k: norm(r[3] + ' ' + r[4]) }));
    stato.luoghi.forEach(l => stato.byId.set(l.id, l));
    stato.nBase = stato.luoghi.length;
    dbg.decode_ms = Math.round(performance.now() - td);
    dbg.n_grandi = grandi.length;
    costruisciLegenda();
    passo('Disegno la città...', 70);

    const mls = c => fc([{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: roads[c] } }]);
    mappa.addSource('parchi', { type: 'geojson', data: fc(pg[1]), tolerance: 0.6 });
    mappa.addSource('acqua', { type: 'geojson', data: fc(pg[0]), tolerance: 0.6 });
    for (let c = 0; c < 5; c++) mappa.addSource('str' + c, { type: 'geojson', data: mls(c), tolerance: 0.8 });
    mappa.addSource('ed-grandi', { type: 'geojson', data: fc(grandi), maxzoom: 16, tolerance: 0.6, buffer: 32 });
    mappa.addSource('sost', { type: 'geojson', data: fc(sost), maxzoom: 16, tolerance: 0.5 });
    mappa.addSource('luoghi', { type: 'geojson', data: ptsGeo(), cluster: true, clusterRadius: 76, clusterMaxZoom: 15 });

    const L = (l) => mappa.addLayer(l);
    L({ id: 'parchi', type: 'fill', source: 'parchi', paint: { 'fill-color': '#d9e5d0' } });
    L({ id: 'acqua', type: 'fill', source: 'acqua', paint: { 'fill-color': '#bfd7e8' } });
    L({ id: 'navigli', type: 'line', source: 'str4', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#bfd7e8', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 1, 14, 3, 18, 12] } });
    for (const [c, w0, mz, w1, w2] of [[3, 0.35, 13.5, 0.8, 5.5], [2, 0.5, 12, 1, 9], [1, 0.8, 11, 1.4, 13], [0, 1.2, 9, 2.2, 17]]) {
      L({ id: 'str-c' + c, type: 'line', source: 'str' + c, minzoom: mz, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fbfaf8', 'line-width': ['interpolate', ['exponential', 1.7], ['zoom'], 11, w0 * 0.7, 14, w1 * 1.8, 18, w2 * 1.9] } });
    }
    // (le ombre portate si aggiungono qui sotto, in caricaMinori: stanno sopra le strade e sotto i volumi)
    livelliEdifici('ed-grandi', 'vol-g', 0);
    // sostituti: gli edifici tolti perche' c'e' il modello. Sotto lo zoom dei monumenti restano sempre; sopra, finche' il .glb non e' pronto.
    const paintSost = { 'fill-extrusion-height': hz(H), 'fill-extrusion-base': 0, 'fill-extrusion-color': C_TETTO, 'fill-extrusion-vertical-gradient': true };
    L({ id: 'sost-lontano', type: 'fill-extrusion', source: 'sost', maxzoom: LOD.monZoom, paint: paintSost });
    L({ id: 'sost-attesa', type: 'fill-extrusion', source: 'sost', minzoom: LOD.monZoom, filter: ['!', ['in', ['get', 'm'], ['literal', [-1]]]], paint: paintSost });
    L({ id: 'luoghi-h', type: 'circle', source: 'luoghi', paint: { 'circle-radius': 0, 'circle-opacity': 0 } });   // serve a querySourceFeatures

    stato.stile = true;
    mappa.once('idle', () => {
      dbg.pronto_ms = Math.round(performance.now() - T0); dbg.pronto_nav_ms = Math.round(performance.now());   // dal via della navigazione
      $('#carico').classList.add('via'); setTimeout(() => $('#carico')?.remove(), 500);
      document.documentElement.dataset.pronto = '1';
      mostraDebug();
      if (innerWidth < 700) document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');   // attribuzione richiusa su telefono (resta il tasto "i")
      refreshPin(); aggiornaElenco();
      verificaLazy();
      emit({ type: 'ready', versione: 1, api: 2, luoghi: stato.luoghi.length, categorie: CATS.map(c => c[0]), municipi: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    });
  } catch (e) {
    console.error(e);
    $('#carico .box').innerHTML = '<h1>Milano <i>3D</i></h1><p class="err">Non riesco a caricare i dati della mappa.<br>Controlla la connessione e riprova.</p><button class="riprova" onclick="location.reload()">Riprova</button>';
  }
}

/* ---------- caricamenti su richiesta (LOD) ---------- */
async function caricaMinori() {
  if (stato.minori !== 'no') return; stato.minori = 'in corso';
  try {
    const t = performance.now();
    const [bMin, bOmb] = await Promise.all([scarica('dati/edifici-minori.bin'), scarica('dati/ombre.bin')]);
    const minori = poligoni(bMin, a => ({ h: a / 2 }));
    const ombre = poligoni(bOmb, a => ({ l: a }));
    // ombre portate morbide: poligoni calcolati in cottura; poligono + bordo sfumato (line-blur) = penombra
    mappa.addSource('ombre', { type: 'geojson', data: fc(ombre), maxzoom: 16, tolerance: 1 });
    const filtro = LOD.ombraMinL ? ['>=', ['get', 'l'], LOD.ombraMinL] : ['has', 'l'];
    const sotto = mappa.getLayer('vol-g-base') ? 'vol-g-base' : 'vol-g';     // le ombre stanno sopra le strade e sotto i volumi
    mappa.addLayer({ id: 'ombra-riempi', type: 'fill', source: 'ombre', minzoom: LOD.ombreZoom - 0.5, filter: filtro, paint: {
      'fill-color': '#4a4742', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], LOD.ombreZoom - 0.5, 0, LOD.ombreZoom + 1, 0.2] } }, sotto);
    mappa.addLayer({ id: 'ombra-sfuma', type: 'line', source: 'ombre', minzoom: LOD.ombreZoom - 0.5, filter: filtro, layout: { 'line-join': 'round' }, paint: {
      'line-color': '#4a4742', 'line-opacity': ['interpolate', ['linear'], ['zoom'], LOD.ombreZoom - 0.5, 0, LOD.ombreZoom + 1, 0.14],
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 26], 'line-blur': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 24] } }, sotto);
    mappa.addSource('ed-minori', { type: 'geojson', data: fc(minori), maxzoom: 16, tolerance: 0.6, buffer: 32 });
    livelliEdifici('ed-minori', 'vol-m', LOD.minoriZoom);
    // i livelli dei monumenti (se gia' caricati) restano sopra
    stato.minori = 'si'; dbg.minori_ms = Math.round(performance.now() - t); dbg.n_minori = minori.length;
  } catch (e) { console.error(e); stato.minori = 'no'; }
}

async function caricaMonumenti() {
  if (stato.monumenti !== 'no') return; stato.monumenti = 'in corso';
  try {
    const t = performance.now();
    const [THREE, { GLTFLoader }, { createLandmarksLayer }, lm] = await Promise.all([
      import('three'), import('three/addons/loaders/GLTFLoader.js'), import('./landmarks-layer.js'), fetch('dati/landmarks.json').then(r => r.json())]);
    const lista = lm.landmarks;
    const layer = createLandmarksLayer({ THREE, GLTFLoader, maplibregl, landmarks: lista, baseUrl: location.href, minZoom: LOD.monZoom,
      onLoad: (m) => { stato.caricati.add(lista.findIndex(x => x.id === m.id)); mappa.setFilter('sost-attesa', ['!', ['in', ['get', 'm'], ['literal', [...stato.caricati]]]]); },
      onFail: (m) => console.warn('ripiego sul volume semplice per', m.id) });
    mappa.addLayer(layer);
    stato.monLayer = layer; stato.monumenti = 'si'; dbg.monumenti_ms = Math.round(performance.now() - t);
  } catch (e) { console.error(e); stato.monumenti = 'no'; }
}

let lm_lista = null;
async function verificaLazy() {
  if (!stato.stile) return;
  const z = mappa.getZoom();
  if (stato.minori === 'no' && z >= LOD.minoriZoom - 1.0) caricaMinori();
  if (stato.monumenti === 'no' && z >= LOD.monZoom - 0.6) {
    if (!lm_lista) lm_lista = (await fetch('dati/landmarks.json').then(r => r.json())).landmarks;
    const b = mappa.getBounds(), dx = (b.getEast() - b.getWest()) * 0.2, dy = (b.getNorth() - b.getSouth()) * 0.2;
    if (lm_lista.some(l => l.lon > b.getWest() - dx && l.lon < b.getEast() + dx && l.lat > b.getSouth() - dy && l.lat < b.getNorth() + dy)) caricaMonumenti();
  }
}
mappa.on('moveend', verificaLazy);

/* ---------- luoghi: filtri, dati per la mappa ---------- */
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function filtra() {
  const q = norm(stato.q.trim());
  stato.filtrati = stato.luoghi.filter(l => stato.cats.has(l.c) && !stato.hidden.has(l.id) && (!stato.ids || stato.ids.has(l.id)) && (!stato.mun || stato.mun.has(l.mun)) && (!q || l.k.includes(q)));
  return stato.filtrati;
}
const ptsGeo = () => ({ type: 'FeatureCollection', features: filtra().map(l => ({ type: 'Feature', properties: { i: l.i }, geometry: { type: 'Point', coordinates: [l.lon, l.lat] } })) });

function applicaFiltri(annunciare = true) {
  mappa.getSource('luoghi').setData(ptsGeo());
  for (const v of vivi.values()) v.marker.remove(); vivi.clear();
  sincronizzaUI();
  aggiornaElenco(true);
  setTimeout(refreshPin, 250);
  const n = stato.filtrati.length;
  if (annunciare) annuncia(n === 0 ? 'Nessun luogo corrisponde ai filtri.' : n + (n === 1 ? ' luogo visibile.' : ' luoghi visibili.'));
}

/* ---------- pin e cluster DOM (focalizzabili) ---------- */
const vivi = new Map();
function pinEl(l, selezionato) {
  const c = CATS[l.c], b = document.createElement('button'), visto = stato.done.has(l.id), alta = stato.hp.has(l.id);
  b.type = 'button'; b.className = 'pin' + (selezionato ? ' sel' : '') + (visto ? ' visto' : '') + (alta ? ' alta' : '');
  // stato dal gestionale, mai solo colore: visto = pin sbiadito + anello verde + spunta; alta priorità = anello ambra + stella
  const anello = visto ? '#1a7f37' : alta ? '#b45309' : '';
  b.innerHTML = `<span class="in"><svg viewBox="0 0 44 56" aria-hidden="true"><g${visto ? ' opacity=".5"' : ''}><path d="M22 54C22 54 6 36 6 22a16 16 0 0 1 32 0c0 14-16 32-16 32z" fill="${c[2]}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<g transform="translate(10 10)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${c[3]}"/></g></g>` +
    (anello ? `<circle cx="22" cy="22" r="19" fill="none" stroke="#fff" stroke-width="6"/><circle cx="22" cy="22" r="19" fill="none" stroke="${anello}" stroke-width="3.2"${alta && !visto ? ' stroke-dasharray="5 3"' : ''}/>` : '') +
    (visto ? '<circle cx="37" cy="9" r="8" fill="#1a7f37" stroke="#fff" stroke-width="2"/><path d="M33 9.2l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
    (alta ? '<circle cx="7" cy="9" r="8" fill="#f59e0b" stroke="#fff" stroke-width="2"/><path d="M7 3.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6L7 11.8 3.8 13.5l.6-3.6L1.8 7.4l3.6-.5z" fill="#1b1f27"/>' : '') +
    `</svg></span>`;
  b.setAttribute('aria-label', `${l.nome}, ${c[1]}${l.via ? ', ' + l.via : ''}${visto ? ', visto' : ''}${alta ? ', alta priorità' : ''}${selezionato ? ' (selezionato)' : ''}`);
  b.dataset.id = l.id;
  return b;
}
function cluEl(n, id, coord) {
  const d = Math.round(Math.min(60, 44 + Math.log2(n) * 2.6)), b = document.createElement('button');
  b.type = 'button'; b.className = 'clu'; b.textContent = n; b.style.width = b.style.height = d + 'px';
  b.setAttribute('aria-label', `Gruppo di ${n} luoghi. Attiva per ingrandire.`);
  b.addEventListener('click', async ev => {
    ev.stopPropagation();
    const z = await mappa.getSource('luoghi').getClusterExpansionZoom(id);
    mappa.easeTo({ center: coord, zoom: Math.min(z + 0.3, 18.5), duration: REDUCED ? 0 : 600 });
  });
  return b;
}
let rafPin = 0;
function refreshPin() {
  rafPin = 0;
  if (!mappa.getSource('luoghi') || !mappa.isSourceLoaded('luoghi')) return;
  const feats = mappa.querySourceFeatures('luoghi');
  const W = mappa.getCanvas().clientWidth, Hh = mappa.getCanvas().clientHeight, pad = 70;
  const vogliamo = new Map();
  for (const f of feats) {
    const p = f.properties, key = p.cluster ? 'c' + p.cluster_id : 'p' + p.i;
    if (vogliamo.has(key) || vogliamo.size > 320) continue;
    if (!p.cluster && stato.sel && p.i === stato.sel.i) continue;      // il selezionato ha un marker suo
    const q = mappa.project(f.geometry.coordinates);
    if (q.x < -pad || q.y < -pad || q.x > W + pad || q.y > Hh + pad) continue;
    if (mappa.getPitch() > 45 && q.y < Hh * 0.26) continue;          // con la mappa molto inclinata i pin lontani si sovrappongono: si mostrano quando si avvicinano
    vogliamo.set(key, f);
  }
  for (const [k, v] of vivi) if (!vogliamo.has(k)) { v.marker.remove(); vivi.delete(k); }
  for (const [k, f] of vogliamo) {
    if (vivi.has(k)) continue;
    const p = f.properties, co = f.geometry.coordinates.slice();
    let el, anchor;
    if (p.cluster) { el = cluEl(p.point_count, p.cluster_id, co); anchor = 'center'; }
    else { const l = stato.luoghi[p.i]; el = pinEl(l, false); anchor = 'bottom'; el.addEventListener('click', ev => { ev.stopPropagation(); seleziona(l, { vola: true, da: 'utente', trigger: el }); }); }
    vivi.set(k, { marker: new maplibregl.Marker({ element: el, anchor }).setLngLat(co).addTo(mappa), el });
  }
  window.__pinVisibili = { pin: [...vivi.keys()].filter(k => k[0] === 'p').length, cluster: [...vivi.keys()].filter(k => k[0] === 'c').length };
}
const pianifica = () => { if (!rafPin) rafPin = setTimeout(refreshPin, 90); };
mappa.on('sourcedata', e => { if (e.sourceId === 'luoghi') pianifica(); });
mappa.on('moveend', () => { pianifica(); aggiornaElencoSeFermo(); });
mappa.on('zoomend', pianifica);

/* ---------- selezione e scheda ---------- */
let selMarker = null, ultimoTrigger = null;
function markerSel(l) {
  if (selMarker) selMarker.remove();
  const el = pinEl(l, true);
  el.addEventListener('click', ev => { ev.stopPropagation(); chiudiScheda(); });
  selMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lon, l.lat]).addTo(mappa);
}
function seleziona(l, { vola = false, da = 'utente', trigger = null } = {}) {
  if (stato.sel && stato.sel.id === l.id && $('#scheda').hidden === false) { if (vola) volaA(l); return; }
  stato.sel = l; ultimoTrigger = trigger || document.activeElement;
  markerSel(l);
  const c = CATS[l.c];
  $('#s-dot').style.background = c[2]; $('#s-cat').textContent = c[1] + (l.mun ? ' · Municipio ' + l.mun : '');
  $('#s-nome').textContent = l.nome; $('#s-via').textContent = l.via || 'Indirizzo non disponibile';
  $('#s-go').href = `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lon}`;
  $('#s-go').setAttribute('aria-label', `Indicazioni stradali per ${l.nome} (si apre in una nuova scheda)`);
  $('#scheda').hidden = false; document.body.classList.add('scheda-aperta');
  chiudiPannelli();
  if (vola) volaA(l);
  annuncia(`Selezionato: ${l.nome}, ${c[1]}.`);
  if (da === 'utente') $('#scheda').focus({ preventScroll: true });
  pianifica();
  emit({ type: 'selected', id: l.id, origine: da });
}
function volaA(l) {
  const mobile = innerWidth <= 560;
  mappa.easeTo({ center: [l.lon, l.lat], zoom: Math.max(mappa.getZoom(), 16.2), offset: [0, mobile ? -110 : -50], duration: REDUCED ? 0 : 900 });
}
function chiudiScheda(da = 'utente') {
  if (!stato.sel) return;
  stato.sel = null; $('#scheda').hidden = true; document.body.classList.remove('scheda-aperta');
  if (selMarker) { selMarker.remove(); selMarker = null; }
  pianifica();
  if (da === 'utente') {
    emit({ type: 'selected', id: null, origine: 'utente' });
    const t = ultimoTrigger; setTimeout(() => { refreshPin(); if (t && document.contains(t)) t.focus(); else document.querySelector('.pin,.clu')?.focus(); }, 120);
  }
}
$('#s-x').onclick = () => chiudiScheda();
mappa.on('click', () => { if (stato.sel) chiudiScheda(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#ris').hidden) return; if (stato.sel) chiudiScheda(); else chiudiPannelli(); } });

/* ---------- comandi mappa ---------- */
const vistaCitta = () => mappa.easeTo({ center: [9.19, 45.4642], zoom: innerWidth < 700 ? 10.2 : 11.6, pitch: 56, bearing: -18, duration: REDUCED ? 0 : 1200 });
$('#bmilano').onclick = vistaCitta;
$('#bnord').onclick = () => mappa.easeTo({ bearing: 0, duration: REDUCED ? 0 : 500 });
$('#bpiu').onclick = () => mappa.zoomIn({ duration: REDUCED ? 0 : 300 });
$('#bmeno').onclick = () => mappa.zoomOut({ duration: REDUCED ? 0 : 300 });
$('#b3d').onclick = () => { const on = mappa.getPitch() < 5; mappa.easeTo({ pitch: on ? 56 : 0, duration: REDUCED ? 0 : 600 }); };
mappa.on('pitchend', () => $('#b3d').setAttribute('aria-pressed', mappa.getPitch() >= 5));

/* ---------- pannelli: filtri ed elenco ---------- */
function costruisciLegenda() {
  const conta = {}; stato.luoghi.forEach(l => conta[l.c] = (conta[l.c] || 0) + 1);
  const box = $('#chips'); box.textContent = '';
  CATS.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.style.setProperty('--c', c[2]); b.dataset.cat = i; b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="dot" style="background:${c[2]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${c[3]}"/></svg></span>${c[1]} <em>${conta[i] || 0}</em>`;
    b.onclick = () => { stato.cats.has(i) ? stato.cats.delete(i) : stato.cats.add(i); applicaFiltri(); };
    box.append(b);
  });
  const s = $('#s-mun'); for (let m = 1; m <= 9; m++) s.add(new Option('Municipio ' + m, m));
  s.onchange = () => { stato.mun = s.value ? new Set([+s.value]) : null; applicaFiltri(); };
  $('#b-azzera').onclick = () => { stato.cats = new Set(CATS.map((_, i) => i)); stato.mun = null; stato.q = ''; $('#q').value = ''; applicaFiltri(); };
  $('#nedif').textContent = 'edifici + luoghi';
}
function sincronizzaUI() {
  document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', stato.cats.has(+b.dataset.cat)));
  const s = $('#s-mun');
  let extra = s.querySelector('option[value="x"]'); if (extra) extra.remove();
  if (!stato.mun) s.value = ''; else if (stato.mun.size === 1) s.value = [...stato.mun][0]; else { s.add(new Option('Più municipi', 'x')); s.value = 'x'; }
  const attivi = (CATS.length - stato.cats.size) + (stato.mun ? 1 : 0) + (stato.q ? 1 : 0);
  $('#n-filtri').textContent = attivi ? `(${attivi} attiv${attivi === 1 ? 'o' : 'i'})` : '';
  $('#n-elenco').textContent = stato.filtrati.length.toLocaleString('it-IT');
  if ($('#q').value !== stato.q) $('#q').value = stato.q;
}
const PANNELLI = [['#btn-filtri', '#p-filtri'], ['#btn-elenco', '#p-elenco']];
function apriPannello(sel) {
  PANNELLI.forEach(([b, p]) => { const on = p === sel && $(p).hidden; $(p).hidden = !on; $(b).setAttribute('aria-expanded', on); });
  if (sel === '#p-elenco' && !$('#p-elenco').hidden) aggiornaElenco(true);
}
function chiudiPannelli() { PANNELLI.forEach(([b, p]) => { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }); }
PANNELLI.forEach(([b, p]) => $(b).onclick = () => apriPannello(p));

// elenco testuale: stessi luoghi dei pin, ordinati per distanza dal centro della mappa
let elencoN = 30;
function aggiornaElenco(reset) {
  if (reset) elencoN = 30;
  $('#n-elenco').textContent = stato.filtrati.length.toLocaleString('it-IT');
  if ($('#p-elenco').hidden) return;
  const c = mappa.getCenter(), k = Math.cos(c.lat * Math.PI / 180);
  const ord = stato.filtrati.map(l => [((l.lon - c.lng) * k) ** 2 + (l.lat - c.lat) ** 2, l]).sort((a, b) => a[0] - b[0]);
  const ul = $('#elenco'); ul.textContent = '';
  $('#elenco-nota').textContent = ord.length ? `${ord.length.toLocaleString('it-IT')} luoghi, dal più vicino al centro della mappa.` : 'Nessun luogo corrisponde ai filtri. Prova ad azzerarli.';
  ord.slice(0, elencoN).forEach(([, l]) => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button';
    b.innerHTML = '<span class="dot"></span><span><span class="n"></span><small></small></span>';
    b.querySelector('.dot').style.background = CATS[l.c][2]; b.querySelector('.n').textContent = l.nome;
    b.querySelector('small').textContent = CATS[l.c][1] + (l.via ? ' · ' + l.via : '');
    b.onclick = () => seleziona(l, { vola: true, da: 'utente', trigger: b });
    li.append(b); ul.append(li);
  });
  $('#b-piu').hidden = ord.length <= elencoN;
}
$('#b-piu').onclick = () => { elencoN += 30; aggiornaElenco(); };
const aggiornaElencoSeFermo = () => { if (!$('#p-elenco').contains(document.activeElement)) aggiornaElenco(); };

/* ---------- ricerca ---------- */
const ris = $('#ris'), q = $('#q');
function suggerimenti() {
  const t = norm(q.value.trim()); ris.textContent = '';
  if (t.length < 2) { ris.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
  const tr = stato.filtrati.slice().sort((a, b) => (norm(b.nome).startsWith(t) - norm(a.nome).startsWith(t))).slice(0, 6);
  if (!tr.length) { const li = document.createElement('li'); li.className = 'vuoto'; li.textContent = 'Nessun luogo trovato. Prova con un\'altra parola.'; ris.append(li); }
  tr.forEach(l => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'option');
    b.innerHTML = '<span class="dot"></span><span><span class="n"></span><small></small></span>';
    b.querySelector('.dot').style.background = CATS[l.c][2]; b.querySelector('.n').textContent = l.nome; b.querySelector('small').textContent = CATS[l.c][1] + (l.via ? ' · ' + l.via : '');
    b.onclick = () => { ris.hidden = true; q.setAttribute('aria-expanded', 'false'); seleziona(l, { vola: true, da: 'utente', trigger: q }); };
    li.append(b); ris.append(li);
  });
  ris.hidden = false; q.setAttribute('aria-expanded', 'true');
}
let tq = 0;
q.addEventListener('input', () => { stato.q = q.value; clearTimeout(tq); tq = setTimeout(() => { applicaFiltri(false); suggerimenti(); }, 120); });
q.addEventListener('keydown', e => {
  if (e.key === 'Escape') { ris.hidden = true; q.setAttribute('aria-expanded', 'false'); }
  if (e.key === 'ArrowDown') { ris.querySelector('button')?.focus(); e.preventDefault(); }
  if (e.key === 'Enter') ris.querySelector('button')?.click();
});
ris.addEventListener('keydown', e => {
  const bs = [...ris.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { bs[Math.min(i + 1, bs.length - 1)]?.focus(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { (i <= 0 ? q : bs[i - 1]).focus(); e.preventDefault(); }
  if (e.key === 'Escape') { ris.hidden = true; q.focus(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.cerca')) ris.hidden = true; });

/* ---------- API postMessage (per incorporare la mappa in un iframe) ---------- */
// In ingresso:  {type:'select', id}  {type:'filter', cat, mun, q, ids}  {type:'reset'}  {type:'deselect'}
//   {type:'state', done:[id], hp:[id], hidden:[id]}  {type:'custom', places:[{id,cat,nome,via,lon,lat,mun}]}   (vedi RISULTATI.md, sezione 6)
//   cat: nome o lista di nomi di categoria; mun: numero o lista (1-9); q: testo. null o '' = nessun filtro su quel campo; campo assente = invariato.
// In uscita:    {type:'ready'}  {type:'selected', id, origine}  {type:'filtered', count, ...}  {type:'error', motivo}
const PARENT = window.parent !== window ? window.parent : null;
const ORIGIN = P.get('origin') || '*';                    // ?origin=https://gestionale... restringe mittenti e destinatario
function emit(m) {
  const msg = { fonte: 'milano3d', ...m };
  msgs.push(msg);
  if (PARENT) PARENT.postMessage(msg, ORIGIN);
}
function normCat(v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return { ok: new Set(CATS.map((_, i) => i)) };
  const arr = Array.isArray(v) ? v : [v], ok = new Set(), ko = [];
  arr.forEach(n => (n in CAT_IDX) ? ok.add(CAT_IDX[n]) : ko.push(n));
  return { ok, ko };
}
function riceviMessaggio(e) {
  if (PARENT ? e.source !== PARENT : e.source !== window) return;
  if (ORIGIN !== '*' && e.origin !== ORIGIN) return;
  const d = e.data; if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
  if (d.type === 'select') {
    const l = stato.byId.get(d.id);
    if (!l) return emit({ type: 'error', motivo: 'id-non-trovato', id: d.id });
    seleziona(l, { vola: true, da: 'api' });
  } else if (d.type === 'deselect') { chiudiScheda('api'); }
  else if (d.type === 'reset') { stato.cats = new Set(CATS.map((_, i) => i)); stato.mun = null; stato.q = ''; stato.ids = null; applicaFiltri(false); emit({ type: 'filtered', count: stato.filtrati.length }); }
  else if (d.type === 'filter') {
    if ('cat' in d) { const r = normCat(d.cat); stato.cats = r.ok; if (r.ko?.length) emit({ type: 'error', motivo: 'categoria-sconosciuta', valori: r.ko }); }
    if ('mun' in d) {
      const a = d.mun == null || d.mun === '' ? [] : (Array.isArray(d.mun) ? d.mun : [d.mun]).map(Number).filter(n => n >= 1 && n <= 9);
      stato.mun = a.length ? new Set(a) : null;
    }
    if ('q' in d) stato.q = d.q == null ? '' : String(d.q);
    if ('ids' in d) stato.ids = Array.isArray(d.ids) ? new Set(d.ids.map(String)) : null;      // ids: elenco di luoghi ammessi (stato/extra del gestionale); null = tutti
    applicaFiltri(false);
    emit({ type: 'filtered', count: stato.filtrati.length, cat: [...stato.cats].map(i => CATS[i][0]), mun: stato.mun ? [...stato.mun] : null, q: stato.q });
  } else if (d.type === 'state' || d.type === 'custom') {
    if (!stato.nBase) return emit({ type: 'error', motivo: 'non-pronta', ricevuto: d.type });
    if (d.type === 'custom') {
      // luoghi aggiunti dall'utente nel gestionale: places = [{id, cat, nome, via, lon, lat, mun}]; sostituiscono quelli inviati prima
      for (const l of stato.luoghi.splice(stato.nBase)) stato.byId.delete(l.id);
      for (const p of Array.isArray(d.places) ? d.places : []) {
        if (!p || !(p.cat in CAT_IDX) || !isFinite(p.lon) || !isFinite(p.lat) || stato.byId.has(String(p.id))) continue;
        const l = { i: stato.luoghi.length, c: CAT_IDX[p.cat], lon: +p.lon, lat: +p.lat, nome: String(p.nome || ''), via: String(p.via || ''), id: String(p.id), mun: +p.mun || 0, k: norm((p.nome || '') + ' ' + (p.via || '')) };
        stato.luoghi.push(l); stato.byId.set(l.id, l);
      }
      if (stato.sel && !stato.byId.has(stato.sel.id)) chiudiScheda('api');
    } else {
      // stato dei luoghi: done = visti, hp = alta priorità, hidden = nascosti
      const set = v => new Set((Array.isArray(v) ? v : []).map(String));
      stato.done = set(d.done); stato.hp = set(d.hp); stato.hidden = set(d.hidden);
    }
    applicaFiltri(false);
    if (stato.sel && stato.byId.has(stato.sel.id)) markerSel(stato.byId.get(stato.sel.id));      // il pin selezionato riprende lo stato nuovo
    emit({ type: 'filtered', count: stato.filtrati.length });
  }
}
addEventListener('message', riceviMessaggio);

/* ---------- varie ---------- */
function mostraDebug() {
  if (!P.has('debug')) return;
  const r = performance.getEntriesByType('resource').filter(x => /dati\/|vendor\/|font\/|glb\/|js\//.test(x.name)).map(x => `${x.name.split('/').slice(-2).join('/')}  ${(x.transferSize / 1048576).toFixed(2)} MB`);
  const el = $('#dbg'); el.style.display = 'block';
  el.textContent = `${TOUCH ? 'LOD basso (touch)' : 'LOD alto'} · pronto ${dbg.pronto_ms} ms · decodifica ${dbg.decode_ms} ms\n` + r.join('\n');
}
// vista da URL (screenshot e test): ?c=9.19,45.46&z=16&p=60&b=-20&sel=<id>
if (P.get('c')) { const [lo, la] = P.get('c').split(',').map(Number); mappa.jumpTo({ center: [lo, la], zoom: +P.get('z') || 15, pitch: P.has('p') ? +P.get('p') : 56, bearing: +P.get('b') || 0 }); }
window.__dbg = dbg; window.__map = mappa; window.__msgs = msgs; window.__stato = stato;
window.__seleziona = id => seleziona(stato.byId.get(id), { vola: true, da: 'utente' });
window.__lod = LOD;
mappa.once('load', async () => { await avvia(); sincronizzaUI(); if (P.get('sel')) setTimeout(() => { const l = stato.byId.get(P.get('sel')); if (l) seleziona(l, { vola: P.get('vola') !== '0', da: 'api' }); }, 50); });

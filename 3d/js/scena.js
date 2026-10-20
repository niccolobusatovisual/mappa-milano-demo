// Scena three.js di Milano 3D (v2): luce comune, tetti, alberi. Si carica solo da zoom medio-alto, insieme a three.
// Convenzione di tutte le geometrie (come i monumenti): metri, +x = est, +y = su, +z = sud; origine al centro della cella.
// Nessun dato viene scaricato qui: i tetti si costruiscono dalle impronte gia' in memoria (edifici-grandi/minori), gli alberi da alberi.bin.

export const FX = 6e-6 * 111320 * Math.cos(45.46 * Math.PI / 180), FY = 4.2e-6 * 110574;   // metri per unita' di griglia (~0,47)
export const CELLA = 500;                                                                    // unita' di griglia per cella (~235 m)
export const SOLE = [-0.54, 0.643, 0.54];     // verso il sole: ovest, alto, sud (azimut 225, polare 50 come la luce di MapLibre)

/* ---------------- luce: la stessa formula di fill-extrusion di MapLibre, cosi' volumi, monumenti, tetti e alberi hanno lo stesso tono ----------------
   directional = mix(1 - I, max(1 - luminanza + I, 1), dot(n, sole)); in piu' un leggero scurimento alla base delle pareti (come le fasce 0-8 m). */
export function materiali(THREE, { int = 0.26 } = {}) {
  const vs = `
    varying vec3 vN; varying vec3 vC; varying float vY;
    uniform vec3 uColor;
    #ifdef USE_COLOR_ATTR
      attribute vec3 col;
    #endif
    void main() {
      vec3 n = normal; vec4 p = vec4(position, 1.0); vec3 c = uColor;
      #ifdef USE_COLOR_ATTR
        c = col;
      #endif
      #ifdef USE_INSTANCING_COLOR
        c = instanceColor;
      #endif
      #ifdef USE_INSTANCING
        p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
      #endif
      vec4 w = modelMatrix * p;
      vN = normalize(mat3(modelMatrix) * n); vC = c; vY = w.y;
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`;
  const fs = `
    varying vec3 vN; varying vec3 vC; varying float vY;
    uniform vec3 uSole; uniform float uInt; uniform vec3 uLuce; uniform float uBase;
    void main() {
      float d = clamp(dot(normalize(vN), uSole), 0.0, 1.0);
      float lum = dot(vC, vec3(0.2126, 0.7152, 0.0722));
      float k = mix(1.0 - uInt, max(1.0 - lum + uInt, 1.0), d);
      float parete = 1.0 - abs(vN.y);
      k *= mix(1.0, mix(0.88, 1.0, smoothstep(0.0, 8.0, vY)), parete * uBase);
      gl_FragColor = vec4(clamp(vC * k * uLuce, 0.0, 1.0), 1.0);
    }`;
  const comuni = () => ({ uSole: { value: new THREE.Vector3(...SOLE).normalize() }, uInt: { value: int }, uLuce: { value: new THREE.Vector3(1, 1, 1) }, uBase: { value: 1 } });
  const mk = (defines, colore, extra = {}) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, defines, uniforms: { ...comuni(), uColor: { value: new THREE.Vector3(...colore) } }, ...extra });
  // ombra morbida di un albero a terra: disco con bordo sfumato, colore freddo (ombra leggermente azzurrata)
  const ombraAlbero = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; vec4 p = vec4(position,1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); float a = 0.24 * (1.0 - smoothstep(0.25, 1.0, r)); gl_FragColor = vec4(0.22, 0.27, 0.38, a); }` });
  return {
    monumento: (hex) => mk({}, hex),
    tetti: () => { const m = mk({ USE_COLOR_ATTR: '' }, [1, 1, 1], { side: THREE.DoubleSide }); m.uniforms.uInt.value = Math.max(int, 0.32); return m; },      // falde: piu' contrasto fra lato al sole e in ombra, cosi' si legge la forma
    alberi: () => mk({}, [1, 1, 1]),
    ombraAlbero,
  };
}

/* ---------------- utilita' ---------------- */
const hash = (n) => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
const lerpHex = (stops, h) => {      // colore del tetto in funzione dell'altezza: stessa curva C_TETTO di app.js (0-255)
  let i = 0; while (i < stops.length - 2 && h > stops[i + 1][0]) i++;
  const [h0, c0] = stops[i], [h1, c1] = stops[i + 1], t = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
  return c0.map((v, k) => (v + (c1[k] - v) * t) / 255);
};
const COL_TETTO = [[0, [235, 235, 233]], [10, [241, 241, 239]], [30, [248, 248, 247]], [80, [255, 255, 255]]];

/* ---------------- tetti ----------------
   Dato reale: la forma (a falde, a padiglione, a piramide, monofalda, piatto) vale solo dove OSM ha il tag roof:shape (~3,5% degli edifici, codice 1-6 nei bit alti dell'attributo).
   Stilizzazione dichiarata: per gli altri edifici si genera un tetto SOLO se l'impronta e' un rettangolo quasi pieno (>= 90% del suo rettangolo minimo), bassa (3-24 m),
   stretta (lato corto 5-17 m, area <= 800 m2), senza corte; il tipo (falde o padiglione) e la pendenza (24-32 gradi) vengono da un hash dell'indice: non e' un'informazione sul tetto vero.
   L'altezza del DBT e' trattata come altezza di gronda (le pareti arrivano li'), il tetto sale sopra. */
export function tettiCella(THREE, ed, idxs, ox, oy, maxN = 1e9) {
  const pos = [], nor = [], col = [];
  let n = 0;
  let ctr = [0, 0, 0];
  const tri = (a, b, c, color) => {       // normale piatta, girata verso l'esterno del tetto (il materiale e' a doppia faccia)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (nx * ((a[0] + b[0] + c[0]) / 3 - ctr[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ctr[1] - 0.2) + nz * ((a[2] + b[2] + c[2]) / 3 - ctr[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nor.push(nx * 127, ny * 127, nz * 127, 0); col.push(color[0] * 255, color[1] * 255, color[2] * 255, 255); }
  };
  for (const i of idxs) {
    if (n >= maxN) break;
    const a0 = ed.off[i], a1 = ed.off[i + 1], np = a1 - a0, h = ed.h[i], code = ed.roof[i];
    if (np < 4 || ed.nr[i] > 1 || code === 1 || code === 6) continue;
    if (h < 3 || h > (code ? 60 : 24)) continue;
    // anello in metri locali (x est, y nord) e area
    const X = new Float64Array(np), Y = new Float64Array(np);
    let A = 0, best = 0, th = 0;
    for (let k = 0; k < np; k++) { X[k] = ed.px[a0 + k] * FX - ox; Y[k] = ed.py[a0 + k] * FY - oy; }
    for (let k = 0; k < np; k++) {
      const j = (k + 1) % np; A += X[k] * Y[j] - X[j] * Y[k];
      const l = Math.hypot(X[j] - X[k], Y[j] - Y[k]); if (l > best) { best = l; th = Math.atan2(Y[j] - Y[k], X[j] - X[k]); }
    }
    A = Math.abs(A) / 2;
    const c = Math.cos(th), s = Math.sin(th);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let k = 0; k < np; k++) { const u = X[k] * c + Y[k] * s, v = -X[k] * s + Y[k] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const w = u1 - u0, l = v1 - v0, fill = A / (w * l), corto = Math.min(w, l), lungo = Math.max(w, l);
    if (!(fill >= (code ? 0.72 : 0.88)) || corto < (code ? 3 : 5)) continue;
    if (!code && (corto > 17 || A > 800 || lungo / corto > 6)) continue;
    const r = hash(i + 1);
    let tipo = code === 5 ? 'mono' : code === 4 ? 'pir' : code === 3 ? 'pad' : code === 2 ? 'falde' : (r < 0.55 ? 'falde' : 'pad');
    if (tipo !== 'mono' && lungo / corto < 1.2) tipo = 'pir';
    const pend = Math.tan((24 + 8 * hash(i + 77)) * Math.PI / 180);
    // rettangolo minimo con gronda di 0,3 m, riferito agli assi (u lungo il lato piu' lungo trovato; riordino cosi' che 'a' sia l'asse lungo)
    let ua = u0 - 0.3, ub = u1 + 0.3, va = v0 - 0.3, vb = v1 + 0.3, ang = th;
    if (w < l) { // l'asse lungo e' v: ruoto di 90 gradi
      [ua, ub, va, vb] = [va, vb, -ub, -ua]; ang = th + Math.PI / 2;
    }
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (u, v, y) => [u * ca - v * sa, y, -(u * sa + v * ca)];     // (u,v) lungo/corto -> (est, su, sud)
    const W = ub - ua, Lc = vb - va, cu = (ua + ub) / 2, cv = (va + vb) / 2;
    const sh = Math.min(W, Lc), rise = tipo === 'mono' ? Math.max(0.8, Math.min(2.4, sh * 0.16)) : Math.max(1.2, Math.min(4.2, sh * 0.5 * pend));
    const base = lerpHex(COL_TETTO, h);
    const t = 0.93 + 0.05 * hash(i + 5), color = [Math.min(1, base[0] * t), Math.min(1, base[1] * t), Math.min(1, base[2] * t)];
    const hy = h; ctr = P(cu, cv, hy);
    const c1 = P(ua, va, hy), c2 = P(ub, va, hy), c3 = P(ub, vb, hy), c4 = P(ua, vb, hy);
    if (tipo === 'mono') {
      // una sola falda: alta sul lato vb, a gronda sul lato va
      const d3 = P(ub, vb, hy + rise), d4 = P(ua, vb, hy + rise);
      tri(c1, c2, d3, color); tri(c1, d3, d4, color);
      tri(c2, c3, d3, color); tri(c4, c1, d4, color); tri(c3, c4, d4, color); tri(c3, d4, d3, color);
    } else {
      // colmo lungo l'asse maggiore: a due falde da testa a testa, a padiglione accorciato (W - lato corto), a piramide ridotto a un punto
      const e = tipo === 'falde' ? W / 2 : tipo === 'pir' ? 0 : Math.max(0, (W - sh) / 2);
      const rA = P(cu - e, cv, hy + rise), rB = P(cu + e, cv, hy + rise);
      tri(c1, c2, rB, color); tri(c1, rB, rA, color);
      tri(c3, c4, rA, color); tri(c3, rA, rB, color);
      tri(c2, c3, rB, color); tri(c4, c1, rA, color);
    }
    n++;
  }
  if (!n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(nor.filter((_, k) => k % 4 !== 3)), 3, true));
  g.setAttribute('col', new THREE.BufferAttribute(new Uint8Array(col.filter((_, k) => k % 4 !== 3)), 3, true));
  g.computeBoundingSphere();
  return { geom: g, n };
}

/* ---------------- alberi ---------------- */
export function chioma(THREE) {            // chioma: icosaedro (20 facce) schiacciato, poggiato a terra, il centro a ~0,95 del raggio
  const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  g.scale(1, 0.92, 1); g.translate(0, 0.92, 0);
  return g;
}
export function disco(THREE) {
  const g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); g.translate(0, 0.12, 0); return g;
}
const VERDI = [[206, 223, 190], [196, 216, 178], [212, 227, 197], [189, 210, 172]];
export function alberiCella(THREE, matCh, matOm, geoCh, geoDisco, xs, ys, ox, oy, seed) {
  const n = xs.length; if (!n) return null;
  const ch = new THREE.InstancedMesh(geoCh, matCh, n), om = new THREE.InstancedMesh(geoDisco, matOm, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = hash(seed * 7919 + i), rr = 2.1 + 1.9 * r;                   // raggio della chioma 2,1-4,0 m: altezza totale circa 4-7 m (stilizzato, il DBT non da' altezza)
    const x = xs[i] * 4 * FX - ox, y = ys[i] * 4 * FY - oy;
    pos.set(x, 0, -y); sc.set(rr, rr * (0.85 + 0.3 * hash(seed * 31 + i)), rr);
    m.compose(pos, q, sc); ch.setMatrixAt(i, m);
    pos.set(x + rr * 0.55, 0, -(y + rr * 0.55)); sc.set(rr * 1.35, 1, rr * 1.1);   // ombra a terra verso nord-est
    m.compose(pos, q, sc); om.setMatrixAt(i, m);
    const v = VERDI[(hash(seed * 13 + i) * VERDI.length) | 0], t = 0.94 + 0.1 * hash(seed * 17 + i);
    col[i * 3] = Math.min(1, v[0] * t / 255); col[i * 3 + 1] = Math.min(1, v[1] * t / 255); col[i * 3 + 2] = Math.min(1, v[2] * t / 255);
  }
  ch.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  ch.instanceMatrix.needsUpdate = om.instanceMatrix.needsUpdate = true;
  ch.frustumCulled = om.frustumCulled = false; om.renderOrder = 2;
  return { ch, om, n };
}

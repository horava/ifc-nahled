/* ---------- terén z ArcGIS ImageServeru (LERC, výšky float32) ---------- */
async function loadTerrain(src, F, X) {
  const cell = src.cell || 2;
  let W = Math.round((X.e1 - X.e0) / cell) + 1, H = Math.round((X.n1 - X.n0) / cell) + 1;
  const k = Math.max(1, Math.max(W, H) / 400);
  W = Math.max(8, Math.round(W / k)); H = Math.max(8, Math.round(H / k));
  const url = `${src.url}/exportImage?${qs({ bbox: `${X.e0},${X.n0},${X.e1},${X.n1}`, bboxSR: F.sr, imageSR: F.sr, size: `${W},${H}`, format: 'lerc', pixelType: 'F32', noDataInterpretation: 'esriNoDataMatchAny', interpolation: 'RSP_BilinearInterpolation', f: 'image' })}`;
  let r;
  try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('Terén se nepodařilo načíst. Služba nepovoluje přístup z jiné aplikace (CORS), nebo je nedostupná.'); }
  if (!r.ok) throw new Error(`Služba terénu vrátila chybu ${r.status}.`);
  const buf = await r.arrayBuffer();
  try { await Lerc.load({ locateFile: (name) => new URL(name, document.baseURI).href }); } catch (e) { throw new Error('Dekodér výšek (lerc-wasm.wasm) se nepodařilo načíst.'); }
  let img;
  try { img = Lerc.decode(buf); } catch (e) {
    let msg = 'Odpověď služby není výškový rastr (LERC).';
    try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j?.error?.message) msg = j.error.message; } catch (_) { /* binární */ }
    throw new Error(msg);
  }
  const z = img.pixels[0];
  const mask = img.mask;
  let lo = Infinity, hi = -Infinity;
  const vals = new Float32Array(img.width * img.height);
  for (let i = 0; i < vals.length; i++) {
    const v = z[i];
    const ok = (!mask || mask[i]) && Number.isFinite(v) && v > -1000 && v < 10000;
    vals[i] = ok ? v : NaN;
    if (ok) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!Number.isFinite(lo)) throw new Error('Pro okolí modelu služba nevrátila žádné výšky.');
  // díry (NoData) doplnit průměrem
  const mean = (lo + hi) / 2;
  for (let i = 0; i < vals.length; i++) if (Number.isNaN(vals[i])) vals[i] = mean;
  return { X, W: img.width, H: img.height, z: vals, lo, hi };
}
/* aktivní terén = nejvýše položená viditelná načtená vrstva terénu */
function activeDem() {
  for (let i = D.layers.length - 1; i >= 0; i--) { const L = D.layers[i]; if (L.visible && L.state === 'ok' && L.dem) return L.dem; }
  return null;
}
/* výška terénu (bilineárně) v souřadnicích požadavku; mimo rastr null */
function demHeight(dem, E, N) {
  const { X, W, H, z } = dem;
  const fx = (E - X.e0) / (X.e1 - X.e0) * W - 0.5, fy = (X.n1 - N) / (X.n1 - X.n0) * H - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > W - 0.5 || fy > H - 0.5) return null;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(fy)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const a = z[y0 * W + x0], b = z[y0 * W + x1], c = z[y1 * W + x0], d = z[y1 * W + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
/* síť terénu ve scéně; uvExt = výřez obrázku, který se na terén natáhne */
function demGeometry(dem, F, lift, uvExt, clip) {
  const { X, W: W0, z } = dem;
  // volitelný ořez na menší výřez (ostrý detail mapy): jen buňky mřížky, které do něj zasahují
  let i0 = 0, j0 = 0, i1 = dem.W - 1, j1 = dem.H - 1;
  if (clip) {
    const fx = (E) => (E - X.e0) / (X.e1 - X.e0) * dem.W - 0.5, fy = (N) => (X.n1 - N) / (X.n1 - X.n0) * dem.H - 0.5;
    i0 = Math.max(0, Math.floor(fx(clip.e0))); i1 = Math.min(dem.W - 1, Math.ceil(fx(clip.e1)));
    j0 = Math.max(0, Math.floor(fy(clip.n1))); j1 = Math.min(dem.H - 1, Math.ceil(fy(clip.n0)));
  }
  const W = i1 - i0 + 1, H = j1 - j0 + 1;
  const pos = new Float32Array(W * H * 3), uv = uvExt ? new Float32Array(W * H * 2) : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const gi = i + i0, gj = j + j0;
    let E = X.e0 + (gi + 0.5) / W0 * (X.e1 - X.e0), N = X.n1 - (gj + 0.5) / dem.H * (X.n1 - X.n0);
    if (clip) { E = Math.min(Math.max(E, clip.e0), clip.e1); N = Math.min(Math.max(N, clip.n0), clip.n1); }
    const s = dataScene(F, E, N, z[gj * W0 + gi], lift);
    const k = j * W + i;
    pos[k * 3] = s.x; pos[k * 3 + 1] = s.y; pos[k * 3 + 2] = s.z;
    if (uv) { uv[k * 2] = (E - uvExt.e0) / (uvExt.e1 - uvExt.e0); uv[k * 2 + 1] = (N - uvExt.n0) / (uvExt.n1 - uvExt.n0); }
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let t = 0;
  for (let j = 0; j + 1 < H; j++) for (let i = 0; i + 1 < W; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}


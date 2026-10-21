/* =====================================================================
   DATA: MAPOVÉ PODKLADY (WMS, ArcGIS) A VEKTOROVÁ DATA (ArcGIS)
   Výřez kolem modelu se vyžádá v souřadnicích georeference (S-JTSK
   EPSG:5514 nebo EPSG modelu) a položí se pod model do výšky podkladu.
   Do půdorysu se dostane sám, protože půdorys je pohled na stejnou scénu.
   ===================================================================== */
const CUZK = 'https://ags.cuzk.gov.cz';
const DATA_CATALOG = [
  { group: 'Mapy', items: [
    { key: 'orto', name: 'Ortofoto ČR', note: 'ČÚZK', src: { attr: 'ČÚZK', type: 'agsmap', url: `${CUZK}/arcgis1/rest/services/ORTOFOTO/MapServer`, format: 'jpg' } },
    { key: 'km', name: 'Katastrální mapa', note: 'ČÚZK, WMS', src: { attr: 'ČÚZK', type: 'wms', url: 'https://services.cuzk.gov.cz/wms/local-km-wms.asp', layers: 'KN' } },
    { key: 'ztm', name: 'Základní topografická mapa', note: 'ČÚZK', src: { attr: 'ČÚZK', type: 'agsmap', url: `${CUZK}/arcgis1/rest/services/ZTM/MapServer`, format: 'png' } },
    { key: 'zabaged', name: 'ZABAGED polohopis', note: 'ČÚZK, s atributy', src: { attr: 'ČÚZK', type: 'agsmap', url: `${CUZK}/arcgis/rest/services/ZABAGED_POLOHOPIS/MapServer`, format: 'png32', transparent: true, identify: true } },
    { key: 'vrst', name: 'Vrstevnice', note: 'ČÚZK ZABAGED', src: { attr: 'ČÚZK', type: 'agsmap', url: `${CUZK}/arcgis/rest/services/ZABAGED_VRSTEVNICE/MapServer`, format: 'png32', transparent: true } },
  ] },
  { group: 'Digitální technická mapa (DMVS)', items: [
    { key: 'dtm_ti', name: 'DTM – technická infrastruktura', note: 'ČÚZK DMVS, veřejná část, WMS 1.3.0', src: { attr: 'DMVS', type: 'wms', url: 'https://dmvs.cuzk.gov.cz/api/wms/dtm_ti_ver', layers: '*', version: '1.3.0' } },
    { key: 'dtm_di', name: 'DTM – dopravní infrastruktura', note: 'ČÚZK DMVS, WMS 1.3.0', src: { attr: 'DMVS', type: 'wms', url: 'https://dmvs.cuzk.gov.cz/api/wms/dtm_di_ver', layers: '*', version: '1.3.0' } },
  ] },
  { group: 'Terén', items: [
    { key: 'dmr5g', name: 'Terén DMR 5G', note: 'ČÚZK, mřížka 2 m, mapy a vektory se na něj položí', src: { attr: 'ČÚZK', type: 'agsterrain', url: `${CUZK}/arcgis2/rest/services/dmr5g/ImageServer`, cell: 2 } },
    { key: 'dmp1g', name: 'Povrch DMP 1G', note: 'ČÚZK, včetně budov a vegetace', src: { attr: 'ČÚZK', type: 'agsterrain', url: `${CUZK}/arcgis2/rest/services/dmp1g/ImageServer`, cell: 1 } },
  ] },
  { group: '3D budovy', items: [
    { key: 'brno3d', name: 'Brno – budovy LoD2 (barevné)', note: 'Statutární město Brno, SceneServer', src: { attr: 'Statutární město Brno', type: 'i3s', url: 'https://gis.brno.cz/ags1/rest/services/OMI/OMI_3D_budovy_lod2_obarveny_sjtsk/SceneServer' } },
  ] },
  { group: 'Katastr a adresy (RÚIAN, vektory s atributy)', items: [
    { key: 'parcely', name: 'Parcely', note: 'čísla parcel, výměra', src: { attr: 'ČÚZK', type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/5`, label: 'cisloparcely', color: '#1baf7a' } },
    { key: 'budovy', name: 'Stavební objekty', note: 'čísla domovní, podlaží', src: { attr: 'ČÚZK', type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/3`, label: 'cisladomovni', color: '#e34948' } },
    { key: 'adresy', name: 'Adresní místa', note: 'body adres', src: { attr: 'ČÚZK', type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/1`, color: '#6250d6' } },
  ] },
];
/* ---------- zdroje dat (citace) ----------
   ČÚZK žádá uvádět zdroj ve tvaru „ČÚZK, rok“ (data pod licencí CC BY 4.0). U vlastních služeb se bere
   text z popisu služby (ArcGIS copyrightText, WMS Attribution / poskytovatel), jinak adresa serveru. */
function cleanAttr(t) {
  if (!t) return '';
  // DOMParser je inertní (žádné skripty ani načítání obrázků z cizího textu)
  const d = new DOMParser().parseFromString(String(t), 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}
function layerAttr(L) {
  const a = L.src?.attr;
  const host = (() => { try { return new URL(L.src.url).hostname; } catch (e) { return ''; } })();
  const year = new Date().getFullYear();
  if (a === 'DMVS' || (!a && /dmvs\.cuzk\.gov\.cz$/i.test(host))) return `ČÚZK (DMVS), data digitálních technických map krajů, ${year}`;
  if (a === 'ČÚZK' || (!a && /cuzk\.(gov\.)?cz$/i.test(host))) return `ČÚZK, ${year}`;
  if (a) return a;
  if (/(^|\.)brno\.cz$/i.test(host)) return 'Statutární město Brno';
  return host;
}
function dataAttribution(onlyShown) {
  const seen = new Set();
  for (const L of D.layers) {
    if (onlyShown && (!L.visible || L.state !== 'ok')) continue;
    const a = layerAttr(L);
    if (a) seen.add(a);
  }
  return [...seen];
}
let attrShown = null;
function updateDataAttr() {
  const elA = document.getElementById('data-attr');
  if (!elA) return;
  let list = [];
  try { list = S.modelID != null ? dataAttribution(true) : []; } catch (e) { return; }
  const t = list.length ? `Zdroje dat: ${list.join(' · ')}` : '';
  if (t === attrShown) return;
  attrShown = t;
  elA.textContent = t;
  elA.hidden = !t;
}
const DATA_KEY = 'ifc-nahled-data-layers';
const dataGroup = new THREE.Group();
dataGroup.name = 'data';
scene.add(dataGroup);
const D = {
  layers: [], margin: 100, groundH: null, info: false, infoAt: null, infoRes: null, seq: 0, inspect: null,
};
try {
  const saved = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
  if (saved) { D.margin = saved.margin || 100; (saved.layers || []).forEach((l) => D.layers.push({ ...l, id: ++D.seq, state: 'idle' })); }
} catch (e) { /* ignore */ }
function saveDataLayers() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify({ margin: D.margin, layers: D.layers.map((l) => ({ name: l.name, note: l.note, src: l.src, visible: l.visible, opacity: l.opacity })) })); } catch (e) { /* ignore */ }
}
S.data = D;

/* převod mezi lokálními souřadnicemi IFC a souřadnicemi požadavku (EPSG:5514 E/N pro S-JTSK, jinak EPSG modelu) */
function dataFrame() {
  const g = S.geo;
  if (!g?.ok) return null;
  const sr = g.jtsk ? 5514 : g.epsg;
  if (!sr) return null;
  const flip = g.jtsk && (g.jtskPositive || g.epsg === 5513 || g.epsg === 2065) ? -1 : 1;
  const m = (x, y, z) => { const r = geoMapFromLocal({ x, y, z }); return [flip * r.E, flip * r.N, r.H]; };
  const o = m(0, 0, 0), ax = m(1, 0, 0), ay = m(0, 1, 0), az = m(0, 0, 1);
  const bx = [ax[0] - o[0], ax[1] - o[1]], by = [ay[0] - o[0], ay[1] - o[1]];
  const det = bx[0] * by[1] - bx[1] * by[0];
  const hz = az[2] - o[2] || 1;
  return {
    sr,
    toReq: (x, y) => [o[0] + bx[0] * x + by[0] * y, o[1] + bx[1] * x + by[1] * y],
    toLocal: (E, N) => { const dE = E - o[0], dN = N - o[1]; return [(dE * by[1] - dN * by[0]) / det, (bx[0] * dN - bx[1] * dE) / det]; },
    localZ: (H) => (H - o[2]) / hz,
    H: (z) => o[2] + hz * z,
  };
}
/* výška podkladu v H (Bpv): výchozí ±0,000 modelu, mírně pod ní kvůli překryvu s podlahou */
function dataGroundH(F) {
  if (D.groundH != null) return D.groundH;
  return F.H(0);
}
function dataScene(F, E, N, H, dz = 0) {
  const [x, y] = F.toLocal(E, N);
  return toScenePoint(new THREE.Vector3(x, y, F.localZ(H) + dz));
}
/* výřez: obálka modelu v souřadnicích požadavku + okolí */
function dataExtent(F) {
  const b = S.bbox;
  if (b.isEmpty()) return null;
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
    const l = toIfcPoint(new THREE.Vector3(x, b.min.y, z));
    const [E, N] = F.toReq(l.x, l.y);
    e0 = Math.min(e0, E); n0 = Math.min(n0, N); e1 = Math.max(e1, E); n1 = Math.max(n1, N);
  }
  const m = D.margin;
  e0 -= m; n0 -= m; e1 += m; n1 += m;
  const w = e1 - e0, h = n1 - n0;
  const px = 2048 / Math.max(w, h);
  return { e0, n0, e1, n1, W: Math.max(64, Math.round(w * px)), H: Math.max(64, Math.round(h * px)) };
}
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
function imageUrl(src, F, X) {
  const bbox = [X.e0, X.n0, X.e1, X.n1].map((v) => v.toFixed(3)).join(',');
  if (src.type === 'wms') {
    const sep = src.url.includes('?') ? '&' : '?';
    const v13 = String(src.version || '1.1.1').startsWith('1.3');
    // projektované systémy (5514, UTM, 3857) mají ve WMS 1.3.0 pořadí os E, N jako 1.1.1
    const q = { SERVICE: 'WMS', VERSION: v13 ? '1.3.0' : '1.1.1', REQUEST: 'GetMap', LAYERS: src.layers || '', STYLES: '', [v13 ? 'CRS' : 'SRS']: `EPSG:${F.sr}`, BBOX: bbox, WIDTH: X.W, HEIGHT: X.H, FORMAT: src.format || 'image/png', TRANSPARENT: 'TRUE' };
    // jemnější obrázek pro displej s vyšší hustotou: rozšiřující parametry běžných serverů
    // (GeoServer FORMAT_OPTIONS, MapServer MAP_RESOLUTION, QGIS DPI); ostatní je ignorují
    if (X.dpi && X.dpi !== 96) Object.assign(q, { DPI: X.dpi, MAP_RESOLUTION: X.dpi, FORMAT_OPTIONS: `dpi:${X.dpi}` });
    return `${src.url}${sep}${qs(q)}`;
  }
  if (src.type === 'agsimg') {
    return `${src.url}/exportImage?${qs({ bbox, bboxSR: F.sr, imageSR: F.sr, size: `${X.W},${X.H}`, format: 'jpgpng', f: 'image' })}`;
  }
  const p = { bbox, bboxSR: F.sr, imageSR: F.sr, size: `${X.W},${X.H}`, format: src.format || 'png32', transparent: src.transparent ? 'true' : 'false', dpi: X.dpi || 96, f: 'image' };
  if (src.layers) p.layers = `show:${src.layers}`;
  return `${src.url}/export?${qs(p)}`;
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Služba nevrátila obrázek. Buď hlásí chybu, nebo nepovoluje načtení do jiné aplikace (CORS).'));
    img.src = url;
  });
}
async function fetchJson(url) {
  let r;
  try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('Službu se nepodařilo zavolat. Je online a povoluje přístup z jiné aplikace (CORS)?'); }
  if (!r.ok) throw new Error(`Služba vrátila chybu ${r.status}.`);
  const j = await r.json();
  if (j?.error) throw new Error(j.error.message || 'Chyba služby.');
  return j;
}
function disposeLayerObj(L) {
  if (!L.obj) return;
  L.obj.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  dataGroup.remove(L.obj);
  L.obj = null;
}
/* načtení jedné vrstvy */
async function loadDataLayer(L) {
  const F = dataFrame();
  if (!F) { L.state = 'error'; L.error = 'Model není georeferencovaný.'; return; }
  const X = dataExtent(F);
  if (!X) return;
  L.token = (L.token || 0) + 1;
  const token = L.token;
  L.state = 'loading'; L.error = ''; L.warn = ''; renderDataPanel();
  try {
    if (L.src.type === 'agsfeat') {
      if (!L.info) {
        const info = await fetchJson(`${L.src.url}?f=json`);
        L.info = { name: info.name, geometryType: info.geometryType, fields: (info.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type })), displayField: info.displayField };
      }
      const q = await fetchJson(`${L.src.url}/query?${qs({ where: '1=1', geometry: `${X.e0},${X.n0},${X.e1},${X.n1}`, geometryType: 'esriGeometryEnvelope', inSR: F.sr, spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: F.sr, resultRecordCount: 4000, f: 'json' })}`);
      if (token !== L.token) return;
      L.features = q.features || [];
      L.exceeded = !!q.exceededTransferLimit;
    } else if (L.src.type === 'agsterrain') {
      L.dem = await loadTerrain(L.src, F, X);
      if (token !== L.token) return;
    } else if (L.src.type === 'i3s') {
      L.i3s = await loadI3S(L, F, X, () => token === L.token);
      if (token !== L.token) return;
    } else {
      if (L.src.type === 'wms' && (!L.src.layers || L.src.layers === '*')) {
        const cap = await wmsCaps(L.src.url);
        Object.assign(L.src, { layers: cap.all || cap.layers.map((l) => l.name).join(','), version: cap.version, format: cap.format, infoFormat: cap.infoFormat, queryable: cap.queryAll });
        saveDataLayers();
      }
      const img = await loadImage(imageUrl(L.src, F, X));
      if (token !== L.token) return;
      L.img = img; L.ext = X;
    }
    L.state = 'ok';
    if (L.src.type === 'agsterrain') rebuildDataLayers(); else buildDataLayer(L);
  } catch (e) {
    if (token !== L.token) return;
    L.state = 'error'; L.error = e.message || String(e);
  }
  renderDataPanel();
  requestRender(); markPlanDirty(0);
}


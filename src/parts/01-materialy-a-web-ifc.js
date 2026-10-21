/* ---------- IFC loading ---------- */
const matCache = new Map();
function materialFor(c) {
  const key = [c.x, c.y, c.z, c.w].map((v) => v.toFixed(3)).join(',');
  let m = matCache.get(key);
  if (!m) {
    // barvy v IFC jsou zadané v sRGB (jak je vidí autor v Revitu/Archicadu); bez převodu
    // je three.js bere jako lineární a po výstupní korekci vyjdou vybledlé
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(c.x, c.y, c.z, THREE.SRGBColorSpace), side: THREE.DoubleSide });
    if (c.w < 0.999) { m.transparent = true; m.opacity = Math.max(c.w, 0.15); m.depthWrite = false; }
    matCache.set(key, m);
  }
  return m;
}

async function initApi() {
  if (S.api) return S.api;
  const api = new WebIFC.IfcAPI();
  await api.Init((path) => new URL(path, document.baseURI).href, true);
  S.api = api;
  return api;
}

function clearModel() {
  deselect();
  resetFeatures();
  S.modelGen = (S.modelGen || 0) + 1;
  const geos = new Set();
  for (const m of S.meshes) if (m.userData.big) geos.add(m.geometry);
  S.bigChunks = null; S.bigInst = null;
  modelGroup.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
  geos.forEach((g) => g.dispose());
  modelGroup.clear();
  S.elements.clear(); S.storeys = []; S.classes.clear(); S.hidden.clear();
  S.isolated = null; S.meshes = []; S.clipOn = false; S.clipPanel = false;
  selTintCache.forEach((t) => t.dispose()); selTintCache.clear();
  clearMeasures(); updateClipUi();
  if (S.api && S.modelID != null) { try { S.api.CloseModel(S.modelID); } catch (e) { /* ignore */ } }
  S.modelID = null;
}


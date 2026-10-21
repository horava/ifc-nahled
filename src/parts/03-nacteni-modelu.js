function memlog(tag) {
  if (!window.__memdbg) return;
  let wasm = 0; try { wasm = S.api.wasmModule.HEAPU8.length; } catch (e) { /* */ }
  const pm = performance.memory || {};
  console.log(`MEM ${tag} js=${Math.round((pm.usedJSHeapSize || 0) / 1e6)} wasm=${Math.round(wasm / 1e6)} t=${Math.round(performance.now())}`);
}
/* soubor po částech: web-ifc čte soubor postupně, takže přečtené části můžeme hned pustit a
   v paměti nejsou zároveň celý soubor i jeho zpracovaná podoba */
const READ_PART = 16 * 1048576;
async function readParts(src) {
  if (!(src instanceof Blob)) return { parts: [src], part: Math.max(1, src.byteLength), size: src.byteLength };
  const parts = [];
  let t = performance.now();
  for (let off = 0; off < src.size; off += READ_PART) {
    parts.push(await src.slice(off, off + READ_PART).arrayBuffer());
    if (performance.now() - t > 200) { setLoadingStep(`Čtu soubor… ${Math.round(100 * off / src.size)} %`); await nextFrame(); t = performance.now(); }
  }
  return { parts, part: READ_PART, size: src.size };
}
/* web-ifc čte soubor dvakrát za sebou (při druhém průchodu staví svou vnitřní podobu); během druhého
   průchodu už přečtené části pouštíme, takže v paměti nejsou zároveň celý soubor i celý model.
   Kdyby web-ifc četl ještě znovu, otevře se soubor podruhé bez uvolňování. */
function openParts(api, F, allowFree) {
  let passes = 0, backRead = false;
  // čtení přes vlastní zpětné volání: web-ifc si funkci pro čtení drží i po otevření (a s ní by
  // v paměti zůstal celý soubor), proto data bereme z F, které po otevření vyprázdníme
  const id = api.OpenModelFromCallback((off, size) => {
    if (off === 0) passes++;
    // web-ifc chce plný požadovaný úsek (kratší bere jako konec souboru), proto skládáme přes hranice částí
    const n = Math.max(0, Math.min(size, F.size - off));
    const p0 = Math.floor(off / F.part);
    if (allowFree && passes >= 2) for (let i = 0; i < p0; i++) F.parts[i] = null;
    if (!n) return new Uint8Array(0);
    const b0 = F.parts[p0];
    if (!b0) { backRead = true; return new Uint8Array(0); }
    const w0 = off - p0 * F.part;
    if (w0 + n <= b0.byteLength) return new Uint8Array(b0, w0, n);
    const out = new Uint8Array(n);
    let o = 0, p = p0, w = w0;
    while (o < n) {
      const b = F.parts[p];
      if (!b) { backRead = true; break; }
      const k = Math.min(n - o, b.byteLength - w);
      out.set(new Uint8Array(b, w, k), o);
      o += k; p++; w = 0;
    }
    return out;
  }, { COORDINATE_TO_ORIGIN: true });
  F.parts = [];
  if (backRead) { if (id >= 0) try { api.CloseModel(id); } catch (e) { /* */ } return 'retry'; }
  return id;
}
async function loadIfc(source, fileName) {
  // během načítání (geometrie se čte po dávkách s pauzami pro překreslení) nesmí index vlastností ani
  // vazby začít číst rozpracovaný model – počkají na konec načítání
  let loadDone;
  S.loading = true;
  S.loadWait = new Promise((r) => { loadDone = r; });
  try {
    return await loadIfcInner(source, fileName);
  } finally {
    S.loading = false;
    loadDone();
  }
}
async function loadIfcInner(source, fileName) {
  showLoading(`Načítám ${fileName}`);
  await nextFrame();
  try {
    const api = await initApi();
    setLoadingStep('Čtu geometrii…');
    await nextFrame();
    clearModel();
    const t0 = performance.now();
    const blob = source instanceof Blob ? source : null;
    let F = await readParts(source);
    source = null;
    memlog('start');
    const lean = F.size > BIG_FILE;
    setLoadingStep('Zpracovávám soubor…');
    await nextFrame();
    let modelID = openParts(api, F, true);
    if (modelID === 'retry' && blob) { F = await readParts(blob); modelID = openParts(api, F, false); }
    F = null;
    if (modelID === 'retry') throw new Error('Soubor se nepodařilo přečíst celý.');
    memlog('opened');
    if (modelID < 0) throw new Error('Soubor se nepodařilo otevřít. Je to platný IFC (STEP)?');
    S.modelID = modelID;
    S.fileName = fileName;

    const geoCache = new Map();
    const edgeCache = new Map();
    const withEdges = [];
    const onMesh = (flat) => {
      const id = flat.expressID;
      let rec = S.elements.get(id);
      if (!rec) { rec = { meshes: [], cls: '', storey: null }; S.elements.set(id, rec); }
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        let geo = geoCache.get(pg.geometryExpressID);
        if (!geo) {
          const g = api.GetGeometry(modelID, pg.geometryExpressID);
          const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
          const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
          if (!idx.length) { g.delete(); continue; }
          geo = geometryFromIfc(v, idx, lean);
          g.delete();
          geoCache.set(pg.geometryExpressID, geo);
        }
        const mesh = new THREE.Mesh(geo, materialFor(pg.color));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.userData.id = id;
        mesh.userData.geoId = pg.geometryExpressID;
        rec.meshes.push(mesh);
        modelGroup.add(mesh);
        S.meshes.push(mesh);
        withEdges.push(mesh);
      }
    };
    await streamGeometry(api, modelID, onMesh);
    memlog('meshes');
    // web-ifc vynechává IfcSpace, místnosti načteme zvlášť
    try { api.StreamAllMeshesWithTypes(modelID, [WebIFC.IFCSPACE], onMesh); } catch (e) { console.warn('IfcSpace', e); }

    // classes
    for (const [id, rec] of S.elements) {
      let cls = 'IFCUNKNOWN';
      try { cls = api.GetNameFromTypeCode(api.GetLineType(modelID, id)) || cls; } catch (e) { /* keep */ }
      rec.cls = cls;
      if (!S.classes.has(cls)) S.classes.set(cls, { visible: !HIDDEN_BY_DEFAULT.has(U(cls)), count: 0 });
      S.classes.get(cls).count++;
      if (U(cls) === 'IFCSPACE') for (const m of rec.meshes) { m.material = spaceMat; m.renderOrder = 2; }
    }

    memlog('classes');
    // spatial structure
    setLoadingStep('Čtu podlaží…');
    await nextFrame();
    const storeyMap = new Map();
    try {
      const tree = await api.properties.getSpatialStructure(modelID, false);
      const walk = (node, storeyId) => {
        let sid = storeyId;
        if (U(node.type) === 'IFCBUILDINGSTOREY') {
          sid = node.expressID;
          if (!storeyMap.has(sid)) {
            const line = api.GetLine(modelID, sid);
            storeyMap.set(sid, { id: sid, name: line?.Name?.value || line?.LongName?.value || `Podlaží #${sid}`,
              elev: Number(line?.Elevation?.value ?? 0), visible: true, count: 0 });
          }
        }
        if (S.elements.has(node.expressID) && sid != null) S.elements.get(node.expressID).storey = sid;
        (node.children || []).forEach((c) => walk(c, sid));
      };
      walk(tree, null);
      S.tree = tree;
    } catch (e) { console.warn('Spatial structure', e); S.tree = null; }
    S.treeOpen = new Set(); S.treeLimit = new Map(); S.names = new Map();
    S.storeys = [...storeyMap.values()].sort((a, b) => a.elev - b.elev);
    let orphan = 0;
    for (const rec of S.elements.values()) {
      const s = rec.storey != null && storeyMap.get(rec.storey);
      if (s) s.count++; else { rec.storey = -1; orphan++; }
    }
    if (orphan) S.storeys.push({ id: -1, name: 'Mimo podlaží', elev: Infinity, visible: true, count: orphan });
    memlog('spatial');

    // velké modely: sloučené kreslení (hrany se u nich nekreslí)
    const chunked = lean || S.meshes.length >= BIG_MESHES;
    if (chunked) { setLoadingStep('Připravuji zobrazení…'); await nextFrame(); buildBigRender(); memlog('chunked'); }
    // edges (skip for very heavy models)
    if (!chunked && withEdges.length < 6000) {
      for (const mesh of withEdges) {
        if (U(S.elements.get(mesh.userData.id)?.cls) === 'IFCSPACE') continue;
        let eg = edgeCache.get(mesh.userData.geoId);
        if (!eg) { eg = new THREE.EdgesGeometry(mesh.geometry, 30); edgeCache.set(mesh.userData.geoId, eg); }
        const ls = new THREE.LineSegments(eg, edgeMat);
        ls.userData.edge = true;
        mesh.add(ls);
      }
    }

    // bbox (visible only after class defaults)
    modelGroup.updateMatrixWorld(true);
    applyVisibility();
    S.bbox = boxOf(S.meshes.filter((m) => m.visible));
    if (S.bbox.isEmpty()) S.bbox.setFromObject(modelGroup);
    S.baseAngle = detectOrientation();
    S.minStep = THREE.MathUtils.clamp(S.bbox.getSize(new THREE.Vector3()).length() * 0.03, 0.5, 5);
    lastZoomD = null;
    setupClip();
    fitView('iso', false);

    const schema = (() => { try { return api.GetModelSchema(modelID); } catch (e) { return ''; } })();
    let projectName = '', projectGuid = '';
    try {
      const pids = api.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
      if (pids.size()) {
        const p = api.GetLine(modelID, pids.get(0));
        projectName = p?.LongName?.value || p?.Name?.value || '';
        projectGuid = p?.GlobalId?.value || '';
      }
    } catch (e) { /* ignore */ }
    S.meta = { schema, projectName, projectGuid, ms: Math.round(performance.now() - t0) };
    S.guidMap = null;
    S.coordMatrix = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(modelID)); } catch (e) { return new THREE.Matrix4(); } })();
    bcfOnModelLoaded();
    geoOnModelLoaded();
    featuresOnModelLoaded();
    dataOnModelLoaded();
    refsOnMainLoaded();

    renderModelPanel();
    renderProps();
    if (!$('#panel-tree').hidden) renderTree();
    plan.storey = 'auto'; plan.shown = null; plan.view = null;
    if (plan.on) { fillPlanSelect(); fitPlan(); markPlanDirty(0); }
    $('#file-name').textContent = fileName;
    $('#file-name').title = fileName;
    $('#empty-hint').hidden = true;
    memlog('done');
    hideLoading();
    toast(`Načteno: ${S.elements.size.toLocaleString('cs-CZ')} prvků za ${nf.format(S.meta.ms / 1000)} s`);
  } catch (err) {
    console.error(err);
    hideLoading();
    toast(err?.message || 'Model se nepodařilo načíst.', true);
  }
}

function boxOf(meshes) {
  const b = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    b.union(tmp);
  }
  return b;
}


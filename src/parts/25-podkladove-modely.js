/* =====================================================================
   PODKLADOVÉ MODELY – další IFC zobrazené spolu s hlavním modelem
   Zarovnání podle georeference (IfcMapConversion) obou modelů, jinak
   podle souřadnic IFC (sdílený počátek projektu).
   ===================================================================== */
const refsGroup = new THREE.Group();
refsGroup.name = 'refs';
scene.add(refsGroup);
const REF_TINTS = ['#2a78d6', '#1baf7a', '#eb6834', '#6250d6', '#e87ba4'];
let refSeq = 0;
S.refs = [];
/* afinní matice lokální IFC (m) → mapové souřadnice (E/N S-JTSK sjednocené na EPSG:5514) */
function mapAffine(g) {
  const flip = g.jtsk && (g.jtskPositive || g.epsg === 5513 || g.epsg === 2065) ? -1 : 1;
  const m = (x, y, z) => { const r = geoMapFromLocal({ x, y, z }, g); return new THREE.Vector3(flip * r.E, flip * r.N, r.H); };
  const o = m(0, 0, 0);
  return new THREE.Matrix4().makeBasis(m(1, 0, 0).sub(o), m(0, 1, 0).sub(o), m(0, 0, 1).sub(o)).setPosition(o);
}
function sameCrs(a, b) { return !!(a?.ok && b?.ok && ((a.jtsk && b.jtsk) || (a.epsg && a.epsg === b.epsg))); }
function alignRef(R) {
  const Smain = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), N_YUP);
  const Sref = new THREE.Matrix4().multiplyMatrices(R.coord, N_YUP);
  let T;
  if (sameCrs(S.geo, R.geo)) {
    // scéna reference → lokální IFC reference → mapa → lokální IFC hlavního → scéna hlavního
    T = Smain.clone().multiply(mapAffine(S.geo).invert()).multiply(mapAffine(R.geo)).multiply(Sref.clone().invert());
    R.align = 'geo';
  } else {
    T = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), R.coord.clone().invert());
    R.align = 'coord';
  }
  R.group.matrixAutoUpdate = false;
  R.group.matrix.copy(T);
  R.group.matrixWorldNeedsUpdate = true;
  R.group.updateMatrixWorld(true);
}
async function addRefModel(blob, name, key) {
  if (S.modelID == null) { await openMainBlob(blob, name, key); return; }
  if ((S.refs || []).some((R) => R.key === (key || recentKey(name, blob.size)))) { toast('Tento model už je přidaný.'); return; }
  const head = await blob.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) { toast('Tohle nevypadá jako IFC soubor (STEP).', true); return; }
  showLoading(`Přidávám ${name}`);
  await nextFrame();
  const api = S.api;
  let mid = null;
  try {
    setLoadingStep('Čtu geometrii…');
    await nextFrame();
    mid = api.OpenModel(new Uint8Array(await blob.arrayBuffer()), { COORDINATE_TO_ORIGIN: true });
    if (mid < 0) throw new Error('Soubor se nepodařilo otevřít.');
    const R = { id: ++refSeq, key: key || recentKey(name, blob.size), name, blob, mid, group: new THREE.Group(), meshes: [], ids: new Set(), visible: true, ghost: false, tint: REF_TINTS[(refSeq - 1) % REF_TINTS.length] };
    const geoCache = new Map();
    const onMesh = (flat) => {
      const id = flat.expressID;
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        let geo = geoCache.get(pg.geometryExpressID);
        if (!geo) {
          const g = api.GetGeometry(mid, pg.geometryExpressID);
          const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
          const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
          g.delete();
          if (!idx.length) continue;
          const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
          geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
          geo.computeBoundingSphere();
          geoCache.set(pg.geometryExpressID, geo);
        }
        const mesh = new THREE.Mesh(geo, materialFor(pg.color));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.userData.ref = R.id;
        mesh.userData.id = id;
        R.meshes.push(mesh);
        R.ids.add(id);
        R.group.add(mesh);
      }
    };
    api.StreamAllMeshes(mid, onMesh);
    R.coord = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(mid)); } catch (e) { return new THREE.Matrix4(); } })();
    try { R.geo = readGeoref(mid); } catch (e) { R.geo = { ok: false }; }
    try {
      const pids = api.GetLineIDsWithType(mid, WebIFC.IFCPROJECT);
      if (pids.size()) { const p = api.GetLine(mid, pids.get(0)); R.project = p?.LongName?.value || p?.Name?.value || ''; }
    } catch (e) { /* ignore */ }
    R.schema = (() => { try { return api.GetModelSchema(mid); } catch (e) { return ''; } })();
    if (!R.meshes.length) throw new Error('Model neobsahuje žádnou geometrii.');
    refsGroup.add(R.group);
    alignRef(R);
    S.refs.push(R);
    mid = null;
    dataIfcChanged();
    hideLoading();
    saveLastSet();
    if (!key) await recentSave(blob, name, R.project);
    renderModelPanel();
    requestRender(); markPlanDirty(0);
    // kontrola, jestli model leží u hlavního
    const bb = new THREE.Box3().setFromObject(R.group);
    const far = bb.isEmpty() || bb.distanceToPoint(S.bbox.getCenter(new THREE.Vector3())) > Math.max(200, S.bbox.getSize(new THREE.Vector3()).length() * 3);
    toast(`Přidáno: ${name}. ${R.align === 'geo' ? 'Zarovnáno podle georeference.' : 'Zarovnáno podle souřadnic IFC.'}${far ? ' Pozor: model leží daleko od hlavního, zkontrolujte souřadnice.' : ''}`, far);
  } catch (e) {
    console.error(e);
    if (mid != null) { try { api.CloseModel(mid); } catch (_) { /* ignore */ } }
    hideLoading();
    toast(`Model se nepodařilo přidat: ${e?.message || e}`, true);
  }
}
function removeRef(R, keepSet) {
  if (S.refSel?.R === R) deselect();
  disposeRefGhost(R);
  const geos = new Set();
  R.group.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
  geos.forEach((g) => g.dispose());
  refsGroup.remove(R.group);
  try { S.api.CloseModel(R.mid); } catch (e) { /* ignore */ }
  S.refs.splice(S.refs.indexOf(R), 1);
  dataIfcChanged();
  if (!keepSet) saveLastSet();
  renderModelPanel(); requestRender(); markPlanDirty(0);
}
/* průhledné zobrazení podkladového modelu: sloučeno do jednoho objektu v barvě modelu */
function disposeRefGhost(R) {
  if (!R.ghostObj) return;
  R.ghostObj.geometry.dispose(); R.ghostObj.material.dispose();
  R.group.remove(R.ghostObj); R.ghostObj = null;
}
function setRefGhost(R, on) {
  R.ghost = on;
  disposeRefGhost(R);
  if (on) {
    let nv = 0, ni = 0;
    for (const m of R.meshes) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), I = new Uint32Array(ni);
    let vo = 0, io = 0;
    const nm = new THREE.Matrix3();
    for (const m of R.meshes) {
      const w = m.matrix.elements;
      nm.getNormalMatrix(m.matrix);
      const n9 = nm.elements;
      const pos = m.geometry.attributes.position, arr = pos.data.array, st = pos.data.stride, po = pos.offset;
      for (let i = 0; i < pos.count; i++) {
        const a = i * st + po, x = arr[a], y = arr[a + 1], z = arr[a + 2], nx = arr[a + 3], ny = arr[a + 4], nz = arr[a + 5], k = (vo + i) * 3;
        P[k] = w[0] * x + w[4] * y + w[8] * z + w[12]; P[k + 1] = w[1] * x + w[5] * y + w[9] * z + w[13]; P[k + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        Nn[k] = n9[0] * nx + n9[3] * ny + n9[6] * nz; Nn[k + 1] = n9[1] * nx + n9[4] * ny + n9[7] * nz; Nn[k + 2] = n9[2] * nx + n9[5] * ny + n9[8] * nz;
      }
      const ia = m.geometry.index.array;
      for (let i = 0; i < ia.length; i++) I[io + i] = ia[i] + vo;
      io += ia.length; vo += pos.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    R.ghostObj = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(R.tint), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    R.ghostObj.renderOrder = 1;
    R.group.add(R.ghostObj);
  }
  R.meshes.forEach((m) => { m.visible = !on; });
  requestRender(); markPlanDirty(0);
}
async function makeRefMain(R) {
  const old = S.mainBlob ? { blob: S.mainBlob, name: S.fileName, key: S.mainKey } : null;
  const { blob, name, key } = R;
  removeRef(R, true);
  const ok = await openMainBlob(blob, name, key, { keepRefs: true });
  if (ok && old) await addRefModel(old.blob, old.name, old.key);
}
function refsOnMainLoaded() {
  for (const R of S.refs) { try { alignRef(R); } catch (e) { console.warn('align', e); } }
  if (S.refs.length) { requestRender(); markPlanDirty(0); }
  dataIfcChanged();
}
/* změnila se sada IFC modelů: přestavět 3D scény, které skrývají budovy pod IFC */
function dataIfcChanged() {
  footCache = null;
  let any = false;
  for (const L of D.layers) if (L.i3s && L.state === 'ok' && L.src.hideUnderIfc !== false) { buildDataLayer(L); any = true; }
  if (any) { requestRender(); markPlanDirty(0); renderDataPanel(); }
}
/* výběr prvku podkladového modelu */
function selectRef(rid, id) {
  deselect(false);
  const R = S.refs.find((x) => x.id === rid);
  if (!R) return;
  S.refSel = { R, id };
  for (const m of R.meshes) if (m.userData.id === id) { m.userData.mat = m.material; m.material = selTinted(m.material); }
  updateToolbar();
  if ($('#panel-tree').hidden) showPanel('props');
  renderProps();
  requestRender();
}
function refDeselect() {
  const s0 = S.refSel;
  if (!s0) return;
  for (const m of s0.R.meshes) if (m.userData.id === s0.id && m.userData.mat) { m.material = m.userData.mat; m.userData.mat = null; }
  S.refSel = null;
}
async function refPropsView(root, token) {
  const { R, id } = S.refSel;
  const api = S.api, mid = R.mid;
  root.replaceChildren(el('p', 'muted pad', 'Načítám vlastnosti…'));
  try {
    const item = await api.properties.getItemProperties(mid, id, false);
    let cls = '';
    try { cls = api.GetNameFromTypeCode(api.GetLineType(mid, id)); } catch (e) { /* ignore */ }
    const psets = (await api.properties.getPropertySets(mid, id, true)).map((p) => ({ p, from: null }));
    try {
      for (const t of (await api.properties.getTypeProperties(mid, id, true)) || []) for (const p of t.HasPropertySets || []) if (p && typeof p === 'object') psets.push({ p, from: 'Typ' });
    } catch (e) { /* no type */ }
    if (token !== propToken) return;
    root.replaceChildren();
    const head = el('header', 'el-head');
    head.append(el('div', 'el-class', prettyCls(cls)), el('h2', 'el-name', val(item.Name) || classLabel(cls)));
    const badge = el('div', 'cmp-badge ref-badge', `Podkladový model: ${R.name}`);
    badge.style.setProperty('--tint', R.tint);
    head.appendChild(badge);
    const gid = val(item.GlobalId);
    if (gid) {
      const g = el('button', 'guid'); g.type = 'button';
      g.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', gid), el('span', 'guid-a', 'Kopírovat'));
      g.addEventListener('click', () => copy(gid, g));
      head.appendChild(g);
    }
    root.appendChild(head);
    const attrs = [];
    for (const k of ['Description', 'ObjectType', 'Tag', 'PredefinedType', 'LongName']) { const v = val(item[k]); if (v) attrs.push([k, v]); }
    attrs.push(['Express ID', `#${id}`]);
    root.appendChild(table('Atributy', attrs));
    const seen = new Set();
    for (const { p, from } of psets.sort((a, b) => val(a.p.Name).localeCompare(val(b.p.Name), 'cs'))) {
      if (seen.has(p.expressID)) continue;
      seen.add(p.expressID);
      const rows = propRows(p);
      if (rows.length) root.appendChild(table(val(p.Name) || 'Bez názvu', rows, p.Quantities ? 'Množství' : from));
    }
  } catch (e) {
    if (token === propToken) root.replaceChildren(el('p', 'muted pad', 'Vlastnosti se nepodařilo načíst.'));
  }
}
function modelsSection() {
  const sec = el('section', 'group');
  sec.appendChild(el('h3', 'group-title', 'Modely'));
  const main = el('div', 'md-row');
  const mdot = el('span', 'md-dot main');
  const mn = el('div', 'dl-name');
  mn.append(el('span', 'row-label', S.fileName), el('span', 'row-sub', `hlavní · ${S.elements.size.toLocaleString('cs-CZ')} prvků`));
  main.append(mdot, mn);
  sec.appendChild(main);
  for (const R of S.refs) {
    const row = el('div', 'md-row');
    const vis = el('button', 'eye');
    vis.type = 'button';
    vis.innerHTML = R.visible ? EYE : EYE_OFF;
    vis.setAttribute('aria-label', `${R.visible ? 'Skrýt' : 'Zobrazit'}: ${R.name}`);
    vis.addEventListener('click', () => { R.visible = !R.visible; R.group.visible = R.visible; if (!R.visible && S.refSel?.R === R) deselect(); dataIfcChanged(); renderModelPanel(); requestRender(); markPlanDirty(0); });
    const nm = el('div', 'dl-name');
    const lab = el('span', 'row-label', R.name);
    const sw = el('span', 'lg-sw'); sw.style.background = R.tint; lab.prepend(sw);
    nm.append(lab, el('span', 'row-sub', `${R.align === 'geo' ? 'podle georeference' : 'podle souřadnic IFC'} · ${R.ids.size.toLocaleString('cs-CZ')} prvků`));
    const acts = el('div', 'md-acts');
    const gh = el('button', 'sbtn mini-btn' + (R.ghost ? ' primary' : ''), 'Průhledně');
    gh.type = 'button';
    gh.setAttribute('aria-pressed', String(R.ghost));
    gh.addEventListener('click', () => { if (S.refSel?.R === R) deselect(); setRefGhost(R, !R.ghost); renderModelPanel(); });
    const mk = el('button', 'sbtn mini-btn', 'Hlavní');
    mk.type = 'button';
    mk.title = 'Udělat hlavním modelem (strom, hledání, barvení…)';
    mk.addEventListener('click', () => makeRefMain(R));
    const rm = el('button', 'ib small-ib');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Odebrat model ${R.name}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    rm.addEventListener('click', () => removeRef(R));
    acts.append(gh, mk, rm);
    row.append(vis, nm, acts);
    sec.appendChild(row);
  }
  const add = el('label', 'sbtn md-add', '+ Přidat další model…');
  add.htmlFor = 'ref-input';
  add.title = 'Například TZB nebo statika. Zarovná se podle georeference, jinak podle souřadnic IFC.';
  const w0 = el('div', 'pad-x md-add-row');
  w0.appendChild(add);
  sec.appendChild(w0);
  if (S.refs.length) sec.appendChild(el('p', 'muted small pad-x', 'Strom, hledání, barvení a porovnání pracují s hlavním modelem. Ťuknutím na prvek podkladového modelu zobrazíte jeho vlastnosti.'));
  return sec;
}
$('#ref-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addRefModel(f, f.name); });
recentRefresh();

/* reset a napojení na načtení modelu */
function resetFeatures() {
  exitCompare(true);
  S.color = null; S.idx = null; S.idxPromise = null; S.idxFor = null;
  rebuildGhosts();
  S.spaceGeo = null; S.roomLbl = null; S.legendCollapsed = false;
  if (S.search) { S.search.results = []; S.search.active = false; }
  colorMatCache.forEach((m) => m.dispose()); colorMatCache.clear();
  renderLegend();
}
function featuresOnModelLoaded() {
  if (S.search) { S.search.conds = S.search.conds.filter((c) => ATTR_KEYS.includes(c.key)); }
  updatePlanLabelUi();
  if (!$('#panel-search').hidden) renderSearchPanel();
  // index na pozadí, aby hledání a barvení bylo hned po ruce
  setTimeout(() => { if (S.modelID != null) ensureIndex().catch(() => {}); }, 600);
}


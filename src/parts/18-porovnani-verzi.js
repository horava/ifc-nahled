/* =====================================================================
   POROVNÁNÍ DVOU VERZÍ MODELU
   Ze starší verze se uloží jen otisk prvků (vlastnosti, obálka, plocha
   povrchu) a geometrie odebraných prvků. Páruje se podle GlobalId.
   ===================================================================== */
const cmpGroup = new THREE.Group();
scene.add(cmpGroup);
const cmpGhostMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(STATUS.removed), side: THREE.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false });
const cmpGhostSelMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(STATUS.removed), side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
const geoStatCache = new WeakMap();
function geoStats(geo) {
  let s = geoStatCache.get(geo);
  if (s) return s;
  const pos = geo.attributes.position, ix = geo.index?.array;
  let area = 0;
  if (pos && ix) {
    const arr = pos.data ? pos.data.array : pos.array, stride = pos.data ? pos.data.stride : 3, off = pos.offset || 0;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * stride + off, b = ix[i + 1] * stride + off, c = ix[i + 2] * stride + off;
      const ux = arr[b] - arr[a], uy = arr[b + 1] - arr[a + 1], uz = arr[b + 2] - arr[a + 2];
      const vx = arr[c] - arr[a], vy = arr[c + 1] - arr[a + 1], vz = arr[c + 2] - arr[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    }
  }
  if (!geo.boundingBox) geo.computeBoundingBox();
  s = { area, box: geo.boundingBox.clone() };
  geoStatCache.set(geo, s);
  return s;
}
function statsFromArrays(v, idx) {
  let area = 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < v.length; i += 6) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const box = v.length ? new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) : new THREE.Box3();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 6, b = idx[i + 1] * 6, c = idx[i + 2] * 6;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return { area, box };
}
const fmtSize = (b) => { const s = b.getSize(new THREE.Vector3()); return `${nf2.format(s.x)} × ${nf2.format(s.z)} × ${nf2.format(s.y)}`; };
function geomDiff(a, b) {
  const tol = 0.005;
  const dMin = a.box.min.distanceTo(b.box.min), dMax = a.box.max.distanceTo(b.box.max);
  if (dMin > tol || dMax > tol) {
    const sa = a.box.getSize(new THREE.Vector3()), sb = b.box.getSize(new THREE.Vector3());
    if (Math.abs(sa.x - sb.x) <= tol && Math.abs(sa.y - sb.y) <= tol && Math.abs(sa.z - sb.z) <= tol) {
      const ca = a.box.getCenter(new THREE.Vector3()), cb = b.box.getCenter(new THREE.Vector3());
      const d = ca.distanceTo(cb);
      const dz = cb.y - ca.y;
      return { kind: 'posun', text: `Posun o ${nf3.format(d)} m${Math.abs(dz) > tol ? ` (výškově ${dz > 0 ? '+' : ''}${nf3.format(dz)} m)` : ''}` };
    }
    return { kind: 'rozmer', text: `Rozměry ${fmtSize(a.box)} → ${fmtSize(b.box)} m` };
  }
  const m = Math.max(a.area, b.area);
  if (Math.abs(a.area - b.area) > Math.max(0.01, m * 0.005)) return { kind: 'tvar', text: `Změna tvaru (povrch ${nf2.format(a.area)} → ${nf2.format(b.area)} m²)` };
  return null;
}

async function compareWith(file) {
  if (!file || S.modelID == null) return;
  const head = await file.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) { toast('Tohle nevypadá jako IFC soubor (STEP).', true); return; }
  exitCompare(true);
  showLoading(`Porovnávám s ${file.name}`);
  const api = S.api;
  let oldMid = null;
  try {
    setLoadingStep('Čtu vlastnosti aktuální verze…');
    await nextFrame();
    await ensureIndex();
    // otisk aktuální verze
    const gmap = guidMap();
    const newStat = new Map();
    for (const [id, rec] of S.elements) {
      const box = boxOf(rec.meshes);
      let area = 0;
      for (const m of rec.meshes) area += geoStats(m.geometry).area;
      newStat.set(id, { box, area });
    }
    setLoadingStep('Otevírám starší verzi…');
    await nextFrame();
    const buf = await file.arrayBuffer();
    oldMid = api.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: true });
    if (oldMid < 0) throw new Error('Starší verzi se nepodařilo otevřít.');
    S.cmpOldMid = oldMid;
    // geometrie starší verze
    setLoadingStep('Čtu geometrii starší verze…');
    await nextFrame();
    const guidOld = new Map();
    const gOf = (id) => {
      if (guidOld.has(id)) return guidOld.get(id);
      let g = ''; try { g = api.GetLine(oldMid, id, false)?.GlobalId?.value || ''; } catch (e) { /* ignore */ }
      guidOld.set(id, g);
      return g;
    };
    const oldStat = new Map();
    const statCache = new Map(), geoCacheOld = new Map();
    const ghostParts = new Map(); // oldId -> [{gid, matrix}]
    const onMesh = (flat) => {
      const id = flat.expressID;
      const g = gOf(id);
      const removedCand = !g || !gmap.has(g);
      let st = oldStat.get(id);
      if (!st) { st = { box: new THREE.Box3(), area: 0 }; oldStat.set(id, st); }
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        const gid = pg.geometryExpressID;
        let s = statCache.get(gid);
        if (!s || (removedCand && !geoCacheOld.has(gid))) {
          const geom = api.GetGeometry(oldMid, gid);
          const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          geom.delete();
          if (!s) { s = ix.length ? statsFromArrays(v, ix) : { area: 0, box: new THREE.Box3() }; statCache.set(gid, s); }
          if (removedCand && ix.length) {
            const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
            const bg = new THREE.BufferGeometry();
            bg.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
            bg.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
            bg.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
            bg.computeBoundingSphere();
            geoCacheOld.set(gid, bg);
          }
        }
        const W = new THREE.Matrix4().fromArray(pg.flatTransformation); // zatím v souřadnicích starší verze
        if (!s.box.isEmpty()) st.box.union(s.box.clone().applyMatrix4(W));
        st.area += s.area;
        if (removedCand) { if (!ghostParts.has(id)) ghostParts.set(id, []); ghostParts.get(id).push({ gid, W }); }
      }
    };
    api.StreamAllMeshes(oldMid, onMesh);
    try { api.StreamAllMeshesWithTypes(oldMid, [WebIFC.IFCSPACE], onMesh); } catch (e) { /* ignore */ }
    // posun do počátku (COORDINATE_TO_ORIGIN) web-ifc určí až při čtení geometrie, proto matici čteme teprve teď
    const oldCoord = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(oldMid)); } catch (e) { return new THREE.Matrix4(); } })();
    const M = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), oldCoord.clone().invert());
    for (const st of oldStat.values()) if (!st.box.isEmpty()) st.box.applyMatrix4(M);
    for (const parts of ghostParts.values()) for (const part of parts) part.W.premultiply(M);
    // třídy a podlaží starší verze
    setLoadingStep('Čtu strukturu starší verze…');
    await nextFrame();
    const oldCls = new Map();
    for (const id of oldStat.keys()) { try { oldCls.set(id, api.GetNameFromTypeCode(api.GetLineType(oldMid, id))); } catch (e) { oldCls.set(id, ''); } }
    const oldStorey = new Map();
    try {
      const tree = await api.properties.getSpatialStructure(oldMid, false);
      const walk = (node, sname) => {
        let s = sname;
        if (U(node.type) === 'IFCBUILDINGSTOREY') { try { const L = api.GetLine(oldMid, node.expressID); s = L?.Name?.value || L?.LongName?.value || s; } catch (e) { /* ignore */ } }
        if (oldStat.has(node.expressID) && s) oldStorey.set(node.expressID, s);
        (node.children || []).forEach((c) => walk(c, s));
      };
      walk(tree, null);
    } catch (e) { /* ignore */ }
    setLoadingStep('Čtu vlastnosti starší verze…');
    const gen = S.modelGen;
    const oldIdx = await buildIndex(oldMid, new Set(oldStat.keys()), (label, f) => setLoadingStep(`Vlastnosti starší verze: ${label} ${Math.round(f * 100)} %`), () => S.modelGen === gen && S.cmpOldMid === oldMid);
    for (const id of oldStat.keys()) {
      const r = oldIdx.el.get(id) || (oldIdx.el.set(id, { a: Object.create(null), sets: [], tsets: [] }), oldIdx.el.get(id));
      r.a.Třída = prettyCls(oldCls.get(id) || '');
      if (oldStorey.has(id)) r.a.Podlaží = oldStorey.get(id);
    }
    // párování
    setLoadingStep('Porovnávám prvky…');
    await nextFrame();
    const pairs = new Map(); // newId -> oldId
    const oldUsed = new Set();
    for (const oid of oldStat.keys()) {
      const g = gOf(oid);
      const nid = g ? gmap.get(g) : undefined;
      if (nid != null && !pairs.has(nid)) { pairs.set(nid, oid); oldUsed.add(oid); }
    }
    let fallback = 0;
    const unNew = [...S.elements.keys()].filter((id) => !pairs.has(id));
    const unOld = [...oldStat.keys()].filter((id) => !oldUsed.has(id));
    if (unNew.length && unOld.length && pairs.size < 0.5 * Math.min(S.elements.size, oldStat.size)) {
      // GlobalId se mezi verzemi zřejmě změnilo: náhradní párování podle třídy, Tagu nebo názvu a polohy
      const keyOf = (r, st) => {
        if (!r) return '';
        if (r.a.Tag) return `${r.a.Třída}|T|${r.a.Tag}`;
        const c = st.box.getCenter(new THREE.Vector3());
        return `${r.a.Třída}|N|${r.a.Name || ''}|${Math.round(c.x * 5)}|${Math.round(c.y * 5)}|${Math.round(c.z * 5)}`;
      };
      const mapN = new Map(), mapO = new Map();
      const push = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
      unNew.forEach((id) => push(mapN, keyOf(S.idx.el.get(id), newStat.get(id)), id));
      unOld.forEach((id) => push(mapO, keyOf(oldIdx.el.get(id), oldStat.get(id)), id));
      for (const [k, ns] of mapN) {
        const os = mapO.get(k);
        if (ns.length === 1 && os?.length === 1) { pairs.set(ns[0], os[0]); oldUsed.add(os[0]); fallback++; }
      }
    }
    // rozdíly
    const items = new Map();
    let nAdded = 0, nChanged = 0, nSame = 0;
    for (const id of S.elements.keys()) {
      const oid = pairs.get(id);
      if (oid == null) { items.set(id, { status: 'added' }); nAdded++; continue; }
      const a = flatProps(oldIdx.el.get(oid)), b = flatProps(S.idx.el.get(id));
      const diffs = [];
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(k) ?? '', y = b.get(k) ?? '';
        if (x !== y) diffs.push({ k, a: x, b: y });
      }
      diffs.sort((p, q) => (ATTR_KEYS.includes(q.k) - ATTR_KEYS.includes(p.k)) || p.k.localeCompare(q.k, 'cs'));
      const geom = geomDiff(oldStat.get(oid), newStat.get(id));
      if (diffs.length || geom) { items.set(id, { status: 'changed', diffs, geom, oid }); nChanged++; } else { items.set(id, { status: 'same' }); nSame++; }
    }
    // odebrané prvky + jejich „duchové“
    const removed = [];
    for (const oid of oldStat.keys()) {
      if (oldUsed.has(oid)) continue;
      const r = oldIdx.el.get(oid);
      const meshes = [];
      for (const part of ghostParts.get(oid) || []) {
        const bg = geoCacheOld.get(part.gid);
        if (!bg) continue;
        const mesh = new THREE.Mesh(bg, cmpGhostMat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.W);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.renderOrder = 3;
        mesh.userData.ghost = removed.length;
        meshes.push(mesh);
        cmpGroup.add(mesh);
      }
      removed.push({ guid: gOf(oid), cls: r?.a.Třída || prettyCls(oldCls.get(oid) || ''), name: r?.a.Name || '', storey: r?.a.Podlaží || '', props: flatProps(r), box: oldStat.get(oid).box, meshes });
    }
    cmpGroup.updateMatrixWorld(true);
    // nepoužité geometrie uvolnit
    const used = new Set(); cmpGroup.traverse((o) => { if (o.geometry) used.add(o.geometry); });
    geoCacheOld.forEach((g) => { if (!used.has(g)) g.dispose(); });

    S.cmp = { oldName: file.name, items, removed, fallback, counts: { added: nAdded, changed: nChanged, same: nSame, removed: removed.length }, filter: 'changed', kind: 'all', limit: 200 };
    S.cmpGhosts = cmpGroup.children.slice();
    try { api.CloseModel(oldMid); } catch (e) { /* ignore */ }
    oldMid = null; S.cmpOldMid = null;
    hideLoading();
    applyCompareColors();
    $('#tab-cmp').hidden = false;
    showPanel('cmp');
    const c = S.cmp.counts;
    toast(`Porovnáno: +${c.added}  ~${c.changed}  −${c.removed}`);
  } catch (e) {
    console.error(e);
    if (oldMid != null) { try { api.CloseModel(oldMid); } catch (_) { /* ignore */ } }
    S.cmpOldMid = null;
    cmpGroup.clear();
    hideLoading();
    toast(e?.message === 'aborted' ? 'Porovnání přerušeno.' : `Porovnání se nepodařilo: ${e?.message || e}`, true);
  }
}
function applyCompareColors() {
  const cmp = S.cmp;
  if (!cmp) return;
  const ids = { added: new Set(), changed: new Set(), same: new Set() };
  for (const [id, it] of cmp.items) {
    if (it.status === 'changed' && cmp.kind !== 'all') {
      const geo = !!it.geom, props = it.diffs.length > 0;
      if ((cmp.kind === 'geom' && !geo) || (cmp.kind === 'props' && !props)) { ids.same.add(id); continue; }
    }
    ids[it.status].add(id);
  }
  S.isolated = null;
  cmpGroup.visible = true;
  setColoring({
    mode: 'cmp', title: 'Porovnání verzí', only: null,
    items: [
      { label: 'Přidané', color: STATUS.added, ids: ids.added },
      { label: 'Změněné', color: STATUS.changed, ids: ids.changed },
      { label: 'Odebrané', color: STATUS.removed, ids: new Set(), removed: true, count: cmp.removed.length },
      { label: 'Beze změny', ghost: true, ids: ids.same },
    ],
  });
  applyVisibility();
}
function exitCompare(silent) {
  if (S.cmpSel != null) ghostDeselect();
  cmpGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  cmpGroup.clear();
  const was = !!S.cmp;
  S.cmp = null; S.cmpGhosts = [];
  $('#tab-cmp').hidden = true;
  if (was && S.color?.mode === 'cmp') { S.isolated = null; setColoring(null); applyVisibility(); }
  if (was && !silent) { showPanel('model'); renderProps(); }
  requestRender();
}
/* výběr odebraného prvku (duch ze starší verze) */
function selectGhost(i) {
  deselect(false);
  const g = S.cmp?.removed[i];
  if (!g) return;
  S.cmpSel = i;
  g.meshes.forEach((m) => { m.material = cmpGhostSelMat; });
  const c = g.box.getCenter(new THREE.Vector3());
  const r = Math.max(g.box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  tween(c.clone().add(dir.multiplyScalar(r * 3.2)), c, true);
  updateToolbar();
  if ($('#panel-cmp').hidden && $('#panel-tree').hidden) showPanel('props');
  renderProps();
  requestRender();
}
function ghostDeselect() {
  const g = S.cmp?.removed[S.cmpSel];
  if (g) g.meshes.forEach((m) => { m.material = cmpGhostMat; });
  S.cmpSel = null;
}
function selectAny(id) {
  if (typeof id === 'string' && id[0] === 'g') selectGhost(Number(id.slice(1)));
  else if (typeof id === 'string' && id[0] === 'r') { const [a, b] = id.slice(1).split(':').map(Number); selectRef(a, b); }
  else select(id);
}
function anyName(id) {
  if (typeof id === 'string' && id[0] === 'r') {
    const [a, b] = id.slice(1).split(':').map(Number);
    const R = S.refs.find((x) => x.id === a);
    let n = ''; try { n = val(S.api.GetLine(R.mid, b)?.Name); } catch (e) { /* ignore */ }
    return `${n || 'prvek'} (${R?.name || 'podkladový model'})`;
  }
  if (typeof id === 'string' && id[0] === 'g') { const g = S.cmp?.removed[Number(id.slice(1))]; return g ? `${g.name || g.cls} (odebraný)` : ''; }
  return nodeName(id) || classLabel(S.elements.get(id)?.cls || '');
}
function ghostPropsView(root) {
  const g = S.cmp.removed[S.cmpSel];
  root.replaceChildren();
  const head = el('header', 'el-head');
  head.append(el('div', 'el-class', g.cls), el('h2', 'el-name', g.name || g.cls));
  if (g.storey) head.appendChild(el('div', 'el-storey', g.storey));
  head.appendChild(el('div', 'cmp-badge removed', 'Odebráno – prvek je jen ve starší verzi'));
  if (g.guid) {
    const b = el('button', 'guid');
    b.type = 'button';
    b.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', g.guid), el('span', 'guid-a', 'Kopírovat'));
    b.addEventListener('click', () => copy(g.guid, b));
    head.appendChild(b);
  }
  root.appendChild(head);
  const bySet = new Map();
  for (const [k, v] of g.props) {
    const dot = k.indexOf('.');
    const set = ATTR_KEYS.includes(k) || dot < 0 ? 'Atributy' : k.slice(0, dot);
    const name = set === 'Atributy' ? (ATTR_LABEL[k] || k) : k.slice(dot + 1);
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set).push([name, v]);
  }
  for (const [s, rows] of bySet) root.appendChild(table(s, rows, 'Starší verze'));
}
function cmpDiffSection(id) {
  const it = S.cmp?.items.get(id);
  if (!it) return null;
  const sec = el('section', 'pset cmp-sec');
  const h = el('h3', 'pset-title', 'Změna oproti starší verzi');
  sec.appendChild(h);
  if (it.status === 'added') { sec.appendChild(el('div', 'cmp-badge added', 'Přidáno – prvek ve starší verzi není')); return sec; }
  if (it.status === 'same') { sec.appendChild(el('div', 'cmp-badge same', 'Beze změny')); return sec; }
  sec.appendChild(el('div', 'cmp-badge changed', 'Změněno'));
  const dl = el('dl', 'kv cmp-kv');
  if (it.geom) dl.append(el('dt', null, 'Geometrie'), el('dd', null, it.geom.text));
  for (const d of it.diffs.slice(0, 80)) {
    const dd = el('dd');
    dd.append(el('span', 'cmp-old', d.a || '—'), el('span', 'cmp-arrow', ' → '), el('span', 'cmp-new', d.b || '—'));
    dl.append(el('dt', null, ATTR_LABEL[d.k] || d.k), dd);
  }
  if (it.diffs.length > 80) dl.append(el('dt', null, '…'), el('dd', null, `a dalších ${it.diffs.length - 80} změn`));
  sec.appendChild(dl);
  return sec;
}
function cmpSummary(it) {
  if (it.status !== 'changed') return '';
  const parts = [];
  if (it.geom) parts.push(it.geom.kind === 'posun' ? it.geom.text.replace(/ \(.*\)$/, '') : it.geom.kind === 'rozmer' ? 'rozměry' : 'tvar');
  if (it.diffs.length) {
    const names = it.diffs.slice(0, 3).map((d) => (ATTR_KEYS.includes(d.k) ? (ATTR_LABEL[d.k] || d.k).replace(/ \(.*\)$/, '') : d.k.slice(d.k.indexOf('.') + 1)));
    parts.push(names.join(', ') + (it.diffs.length > 3 ? ` +${it.diffs.length - 3}` : ''));
  }
  return parts.join(' · ');
}
function renderCmpPanel() {
  const root = $('#panel-cmp');
  root.replaceChildren();
  const cmp = S.cmp;
  if (!cmp) { root.appendChild(el('p', 'muted pad', 'Porovnání není spuštěné.')); return; }
  const head = el('div', 'summary');
  head.appendChild(el('div', 'summary-title', 'Porovnání verzí'));
  const facts = el('dl', 'facts');
  facts.append(el('dt', null, 'Starší'), el('dd', 'cmp-file', cmp.oldName), el('dt', null, 'Aktuální'), el('dd', 'cmp-file', S.fileName));
  head.appendChild(facts);
  const acts = el('div', 'res-acts');
  const b1 = el('button', 'sbtn', 'Export CSV'); b1.type = 'button'; b1.addEventListener('click', exportCompareCsv);
  const b2 = el('button', 'sbtn', 'Ukončit porovnání'); b2.type = 'button'; b2.addEventListener('click', () => exitCompare());
  acts.append(b1, b2);
  head.appendChild(acts);
  root.appendChild(head);
  if (cmp.fallback) {
    root.appendChild(el('div', 'notice', `GlobalId se mezi verzemi z velké části liší. ${cmp.fallback.toLocaleString('cs-CZ')} prvků bylo spárováno náhradně podle třídy, Tagu nebo názvu a polohy, výsledek berte orientačně.`));
  }
  // přepínače kategorií = filtr seznamu
  const cats = [['changed', 'Změněné', STATUS.changed], ['added', 'Přidané', STATUS.added], ['removed', 'Odebrané', STATUS.removed], ['same', 'Beze změny', null]];
  const seg = el('div', 'cmp-cats');
  cats.forEach(([k, label, color]) => {
    const b = el('button', 'cmp-cat');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(cmp.filter === k));
    const sw = el('span', 'lg-sw' + (color ? '' : ' ghost'));
    if (color) sw.style.background = color;
    b.append(sw, el('span', 'cmp-cat-n', cmp.counts[k].toLocaleString('cs-CZ')), el('span', 'cmp-cat-l', label));
    b.addEventListener('click', () => { cmp.filter = k; cmp.limit = 200; renderCmpPanel(); });
    seg.appendChild(b);
  });
  root.appendChild(seg);
  if (cmp.filter === 'changed') {
    const kinds = el('div', 'seg cmp-kind');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Druh změny');
    [['all', 'Vše'], ['geom', 'Geometrie'], ['props', 'Vlastnosti']].forEach(([k, l]) => {
      const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', String(cmp.kind === k));
      b.addEventListener('click', () => { cmp.kind = k; applyCompareColors(); renderCmpPanel(); });
      kinds.appendChild(b);
    });
    root.appendChild(kinds);
  }
  // seznam
  const list = el('div', 'res');
  let rows = [];
  if (cmp.filter === 'removed') {
    rows = cmp.removed.map((g, i) => ({ id: `g${i}`, cls: g.cls, name: g.name, storey: g.storey, sub: '' }));
  } else {
    for (const [id, it] of cmp.items) {
      if (it.status !== cmp.filter) continue;
      if (it.status === 'changed' && cmp.kind === 'geom' && !it.geom) continue;
      if (it.status === 'changed' && cmp.kind === 'props' && !it.diffs.length) continue;
      const r = S.idx.el.get(id);
      rows.push({ id, cls: r?.a.Třída || '', name: r?.a.Name || '', storey: r?.a.Podlaží || '', sub: cmpSummary(it) });
    }
  }
  if (!rows.length) list.appendChild(el('p', 'muted pad', 'V této skupině nic není.'));
  const groups = new Map();
  rows.forEach((r) => { const g = classLabel(r.cls); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  let shown = 0;
  for (const [g, rs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (shown >= cmp.limit) break;
    const sec = el('section', 'res-group');
    sec.appendChild(el('h3', 'group-title', `${g} · ${rs.length.toLocaleString('cs-CZ')}`));
    for (const r of rs) {
      if (shown++ >= cmp.limit) break;
      const b = el('button', 'res-item');
      b.type = 'button';
      b.appendChild(el('span', 'res-name', r.name || r.cls));
      const sub = [r.storey, r.sub].filter(Boolean).join(' · ');
      if (sub) b.appendChild(el('span', 'res-sub', sub));
      b.addEventListener('click', () => {
        list.querySelectorAll('.res-item.on').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        if (typeof r.id === 'string') { cmpGroup.visible = true; selectGhost(Number(r.id.slice(1))); } else revealAndSelect(r.id);
      });
      sec.appendChild(b);
    }
    list.appendChild(sec);
  }
  if (rows.length > cmp.limit) {
    const more = el('button', 'link more', `Zobrazit další (${(rows.length - cmp.limit).toLocaleString('cs-CZ')})`);
    more.type = 'button';
    more.addEventListener('click', () => { cmp.limit += 400; renderCmpPanel(); });
    list.appendChild(more);
  }
  root.appendChild(list);
}
async function exportCompareCsv() {
  const cmp = S.cmp;
  if (!cmp) return;
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Stav', 'GlobalId', 'Třída', 'Název', 'Podlaží', 'Změna', 'Před', 'Po'].map(q).join(';')];
  const st = { added: 'Přidáno', changed: 'Změněno' };
  for (const [id, it] of cmp.items) {
    if (it.status === 'same') continue;
    const r = S.idx.el.get(id);
    const base = [st[it.status], r?.a.GlobalId, r?.a.Třída, r?.a.Name, r?.a.Podlaží];
    if (it.status === 'added') { lines.push([...base, '', '', ''].map(q).join(';')); continue; }
    if (it.geom) lines.push([...base, 'Geometrie', '', it.geom.text].map(q).join(';'));
    for (const d of it.diffs) lines.push([...base, d.k, d.a, d.b].map(q).join(';'));
  }
  for (const g of cmp.removed) lines.push(['Odebráno', g.guid, g.cls, g.name, g.storey, '', '', ''].map(q).join(';'));
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  await saveFile(`${base}-zmeny.csv`, new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }), 'text/csv');
}

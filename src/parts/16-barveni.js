/* =====================================================================
   BARVENÍ PODLE VLASTNOSTI (+ zvýraznění výsledků a porovnání verzí)
   S.color = { mode, title, items: [{label, color, ids:Set, ghost}], byId: Map, only }
   ===================================================================== */
const CAT_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const SEQ_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const STATUS = { added: '#0ca30c', changed: '#fab219', removed: '#d03b3b' };
const OTHER_COLOR = '#9aa19e';
const colorMatCache = new Map();
const isDarkTheme = () => { const c = new THREE.Color(cssVar('--panel') || '#f8faf9'); return (c.r + c.g + c.b) / 3 < 0.35; };
function seqColor(t) { // t 0..1 po rampě (vynechá nejsvětlejší krok, aby barva nesplynula s pozadím)
  const ramp = SEQ_RAMP.slice(1);
  const x = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = new THREE.Color(ramp[i]), b = new THREE.Color(ramp[Math.min(i + 1, ramp.length - 1)]);
  return '#' + a.lerp(b, f).getHexString();
}
function colorMat(color, space, ghost) {
  const key = `${color}|${space ? 1 : 0}|${ghost ? 1 : 0}`;
  let m = colorMatCache.get(key);
  if (!m) {
    if (ghost) {
      m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, transparent: true, opacity: space ? 0.04 : 0.09, depthWrite: false });
    } else {
      m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide });
      // místnosti neprůhledné (průhlednost tisíců objektů je na iPadu drahá), jen mírně dopředu kvůli podlaze
      if (space) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, side: spaceSideBack ? THREE.BackSide : THREE.DoubleSide });
    }
    colorMatCache.set(key, m);
  }
  return m;
}
function ghostColor() { return cssVar('--muted') || '#8a9490'; }
/* obarvené místnosti v řezu: kreslí se jen vnitřní strana. Podlaha místnosti tak nebliká se stropem
   místnosti pod ní a sousední místnosti se neperou o společnou stěnu (plochy leží přesně na sobě). */
var spaceSideBack = false; // var: renderFrame běží už před touto řádkou
function setSpaceSide(back) {
  if (!!back === !!spaceSideBack) return;
  spaceSideBack = back;
  const side = back ? THREE.BackSide : THREE.DoubleSide;
  for (const [key, m] of colorMatCache) {
    if (!key.endsWith('|1|0')) continue;
    m.side = side; m.needsUpdate = true;
    const t = selTintCache.get(m);
    if (t) { t.side = side; t.needsUpdate = true; }
  }
}

function setColoring(state) {
  S.color = state;
  if (state) {
    if (state.rest === undefined) state.rest = null;
    state.byId = new Map();
    state.items.forEach((it, i) => it.ids.forEach((id) => state.byId.set(id, i)));
    if (state.only == null) state.only = null;
  }
  paintModel();
  renderLegend();
  if (!$('#panel-model').hidden) renderModelPanel();
}
const ghostEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false });
function paintModel() {
  const st = S.color;
  ghostEdgeMat.color.copy(edgeMat.color);
  const keep = S.selected;
  if (keep != null) deselect(false);
  for (const [id, rec] of S.elements) {
    let mat = null, ghost = false;
    if (st) {
      const i = st.byId.get(id);
      const it = i != null ? st.items[i] : st.rest;
      // izolované „Nevyplněno“ se kreslí plně šedě, jinak by nebylo vidět
      if (it) { ghost = !!it.ghost && !(it.missing && st.only === i); mat = colorMat(ghost ? (it.color || ghostColor()) : it.color, U(rec.cls) === 'IFCSPACE', ghost); }
    }
    for (const m of rec.meshes) {
      if (m.userData.baseMat === undefined) m.userData.baseMat = m.material;
      m.material = mat || m.userData.baseMat;
      m.userData.ghost = ghost;
      for (const c of m.children) if (c.userData.edge) c.material = ghost ? ghostEdgeMat : edgeMat;
    }
  }
  syncMeshVisibility();
  if (keep != null && S.elements.has(keep)) select(keep, { keepPanel: true });
  requestRender();
  markPlanDirty();
}
/* sloučení duchů do jednoho meshe (a jedněch hran): tisíce průhledných objektů se jinak
   musí každý snímek řadit a kreslit zvlášť, což na iPadu prohlížení výrazně zpomalí */
const ghostGroup = new THREE.Group();
scene.add(ghostGroup);
const ghostMergeMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
function rebuildGhosts() {
  ghostGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  ghostGroup.clear();
  if (!S.color) return;
  const list = [];
  let nv = 0, ni = 0, ne = 0;
  for (const [id, rec] of S.elements) {
    if (!rec.meshes[0]?.userData.ghost || rec.meshes[0].userData.big || !isVisible(id, rec)) continue;
    for (const m of rec.meshes) {
      const pos = m.geometry.attributes.position, ix = m.geometry.index;
      if (!pos || !ix) continue;
      list.push(m);
      nv += pos.count; ni += ix.count;
      const e = m.children.find((c) => c.userData.edge);
      if (e) ne += e.geometry.attributes.position.count;
    }
  }
  if (!list.length) return;
  const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), I = new Uint32Array(ni), E = ne ? new Float32Array(ne * 3) : null;
  let vo = 0, io = 0, eo = 0;
  const nm = new THREE.Matrix3();
  for (const m of list) {
    m.updateMatrixWorld();
    const w = m.matrixWorld.elements;
    nm.getNormalMatrix(m.matrixWorld);
    const n9 = nm.elements;
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    const arr = pos.data ? pos.data.array : pos.array, st = pos.data ? pos.data.stride : 3, po = pos.offset || 0;
    const narr = nor ? (nor.data ? nor.data.array : nor.array) : null, nst = nor ? (nor.data ? nor.data.stride : 3) : 3, no = nor?.offset || 0;
    for (let i = 0; i < pos.count; i++) {
      const a = i * st + po, x = arr[a], y = arr[a + 1], z = arr[a + 2], k = (vo + i) * 3;
      P[k] = w[0] * x + w[4] * y + w[8] * z + w[12];
      P[k + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
      P[k + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
      if (narr) {
        const b = i * nst + no, nx = narr[b], ny = narr[b + 1], nz = narr[b + 2];
        Nn[k] = n9[0] * nx + n9[3] * ny + n9[6] * nz; Nn[k + 1] = n9[1] * nx + n9[4] * ny + n9[7] * nz; Nn[k + 2] = n9[2] * nx + n9[5] * ny + n9[8] * nz;
      }
    }
    const ia = m.geometry.index.array;
    for (let i = 0; i < ia.length; i++) I[io + i] = ia[i] + vo;
    io += ia.length; vo += pos.count;
    const e = E && m.children.find((c) => c.userData.edge);
    if (e) {
      const ea = e.geometry.attributes.position.array;
      for (let i = 0; i < ea.length; i += 3) {
        const x = ea[i], y = ea[i + 1], z = ea[i + 2];
        E[eo++] = w[0] * x + w[4] * y + w[8] * z + w[12];
        E[eo++] = w[1] * x + w[5] * y + w[9] * z + w[13];
        E[eo++] = w[2] * x + w[6] * y + w[10] * z + w[14];
      }
    }
  }
  ghostMergeMat.color.set(ghostColor());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, ghostMergeMat);
  mesh.renderOrder = 1;
  ghostGroup.add(mesh);
  if (E) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(E, 3));
    eg.computeBoundingSphere();
    const ls = new THREE.LineSegments(eg, ghostEdgeMat);
    ls.visible = S.edges;
    ls.userData.ghostEdges = true;
    ghostGroup.add(ls);
  }
}
function refreshColoring() {
  if (!S.color) return;
  colorMatCache.forEach((m) => m.dispose());
  colorMatCache.clear();
  if (S.color.mode === 'prop') colorByKey(S.color.key, true);
  else if (S.color.mode === 'search') paintModel();
  else paintModel();
  if (S.cmp) cmpGhostMat.color.set(STATUS.removed);
}
/* barvení podle vlastnosti */
/* místnosti modelu (prvky IfcSpace s geometrií) a jejich vlastnosti pro výběr barvení */
function spaceIds() { return [...S.elements.entries()].filter(([, r]) => U(r.cls) === 'IFCSPACE').map(([id]) => id); }
function spaceKeys() {
  if (!S.idx?.ready) return null;
  if (!S.idx.spaceKeys) {
    const k = keyCatalog(S.idx, spaceIds());
    k.delete('Třída'); k.delete('GlobalId');
    S.idx.spaceKeys = k;
  }
  return S.idx.spaceKeys;
}
/* barva pro i-tou hodnotu: nejdřív 8 ověřených barev, pak další odstíny po zlatém úhlu */
function catColor(i) {
  const dark = isDarkTheme();
  const pal = dark ? CAT_COLORS.dark : CAT_COLORS.light;
  if (i < pal.length) return pal[i];
  const j = i - pal.length;
  const h = ((j * 137.508 + 22) % 360) / 360;
  const l = dark ? [0.6, 0.48, 0.7][j % 3] : [0.46, 0.6, 0.36][j % 3];
  const sat = [0.62, 0.5, 0.7][(j >> 1) % 3];
  return '#' + new THREE.Color().setHSL(h, sat, l).getHexString();
}
/* barvení místností podle vlastnosti; ostatní prvky zprůhlední, legenda ukazuje všechny hodnoty */
function colorByKey(key, keepOnly) {
  if (!key) { setColoring(null); return; }
  if (!S.idx?.ready) { ensureIndex().then(() => colorByKey(key)).catch(() => {}); return; }
  const groups = new Map(); const missing = new Set();
  let allNum = true;
  for (const id of spaceIds()) {
    const v = getProp(S.idx.el.get(id), key);
    if (v == null || v === '') { missing.add(id); continue; }
    if (typeof v !== 'number') allNum = false;
    const k = typeof v === 'number' ? v : fmtVal(v);
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k).add(id);
  }
  const items = [];
  const u = S.idx.units.get(key) || '';
  if (key === 'Podlaží') {
    // pořadí podle výšky, postupná barva
    const order = S.storeys.filter((s0) => s0.id !== -1).map((s0) => s0.name).filter((n) => groups.has(n));
    order.forEach((n, i) => items.push({ label: n, color: seqColor(order.length > 1 ? i / (order.length - 1) : 0.5), ids: groups.get(n) }));
  } else if (allNum && groups.size) {
    // čísla: každá hodnota zvlášť, barva podle velikosti
    const vals = [...groups.keys()].sort((a, b) => a - b);
    vals.forEach((v, i) => items.push({ label: fmtVal(v) + u, color: seqColor(vals.length > 1 ? i / (vals.length - 1) : 0.5), ids: groups.get(v) }));
  } else {
    const coll = new Intl.Collator('cs', { numeric: true });
    [...groups.keys()].map(String).sort(coll.compare).forEach((v, i) => {
      const ids = groups.get(v) ?? groups.get(Number(v));
      items.push({ label: v, color: catColor(i), ids });
    });
  }
  // místnosti bez hodnoty jen průhledně, aby nezakrývaly obarvené (např. zóny přes celé podlaží); v legendě je jde zobrazit samostatně
  if (missing.size) items.push({ label: 'Nevyplněno', color: OTHER_COLOR, ids: missing, missing: true, ghost: true });
  const prevOnly = keepOnly && S.color?.key === key ? S.color.only : null;
  setColoring({ mode: 'prop', key, title: keyLabel(key), items, rest: { ghost: true }, only: prevOnly });
  if (!keepOnly) showColoredSpaces(items);
}
/* když barvení dopadne na skryté místnosti, zapnout je, jinak by barvy nebyly vidět */
function showColoredSpaces(items) {
  const sc = [...S.classes.entries()].find(([k]) => U(k) === 'IFCSPACE');
  if (!sc || sc[1].visible) return;
  const hit = items.some((it) => { for (const id of it.ids) if (U(S.elements.get(id)?.cls) === 'IFCSPACE') return true; return false; });
  if (!hit) return;
  sc[1].visible = true;
  applyVisibility();
  if (!$('#panel-model').hidden) renderModelPanel();
  toast('Zobrazil jsem místnosti, aby bylo barvení vidět.');
}
function colorBySearch() {
  const ids = new Set(S.search.results);
  const rest = new Set([...S.elements.keys()].filter((id) => !ids.has(id)));
  const pal = isDarkTheme() ? CAT_COLORS.dark : CAT_COLORS.light;
  S.isolated = null;
  setColoring({ mode: 'search', title: 'Výsledky hledání', items: [{ label: 'Nalezené prvky', color: pal[1], ids }, { label: 'Ostatní prvky', ghost: true, ids: rest }], only: null });
  applyVisibility();
  showColoredSpaces([{ ids }]);
  fitToIds(S.search.results);
}
/* legenda: ťuknutí na položku = jen tato skupina */
function setColorOnly(i, silent) {
  const st = S.color;
  if (!st) return;
  const prev = st.only;
  st.only = i;
  if (i == null) S.isolated = null;
  else S.isolated = new Set(st.items[i].ids);
  if (S.cmp) cmpGroup.visible = i == null || st.items[i]?.removed;
  if (st.items[prev]?.missing || st.items[i]?.missing) paintModel();
  if (!silent) { applyVisibility(); renderModelPanel(); renderLegend(); }
}
function renderLegend() {
  const box = $('#legend');
  const st = S.color;
  if (!st) { box.hidden = true; $('#sample-badge').classList.remove('under-legend'); return; }
  box.hidden = false;
  $('#sample-badge').classList.add('under-legend');
  $('#lg-title').textContent = st.title;
  const list = $('#lg-list');
  list.replaceChildren();
  box.classList.toggle('collapsed', !!S.legendCollapsed);
  st.items.forEach((it, i) => {
    const n = it.removed ? it.count : it.ids.size;
    const b = el('button', 'lg-item');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(st.only === i));
    const sw = el('span', 'lg-sw' + (it.ghost ? ' ghost' : ''));
    if (!it.ghost || it.removed) sw.style.background = it.color;
    b.append(sw, el('span', 'lg-label', it.label), el('span', 'lg-count', n.toLocaleString('cs-CZ')));
    b.title = st.only === i ? 'Zobrazit vše' : 'Zobrazit jen tuto skupinu';
    b.addEventListener('click', () => setColorOnly(st.only === i ? null : i));
    list.appendChild(b);
  });
  $('#lg-hint').textContent = st.only != null ? 'Zobrazena jen jedna skupina. Ťuknutím ji zrušíte.' : 'Ťuknutím zobrazíte jen jednu skupinu.';
}
$('#lg-close').addEventListener('click', () => {
  if (S.color?.mode === 'cmp') { S.legendCollapsed = true; renderLegend(); return; }
  if (S.color?.only != null) S.isolated = null;
  setColoring(null);
  applyVisibility();
});
$('#lg-collapse').addEventListener('click', () => { S.legendCollapsed = !S.legendCollapsed; renderLegend(); });
$('#lg-title').addEventListener('click', () => { if (S.legendCollapsed) { S.legendCollapsed = false; renderLegend(); } });
function colorSection() {
  const sec = el('section', 'group color-sec');
  sec.appendChild(el('h3', 'group-title', 'Barvení místností'));
  if (!S.idx?.ready ? ![...S.classes.keys()].some((k) => U(k) === 'IFCSPACE') : !spaceIds().length) {
    sec.appendChild(el('p', 'muted small pad-x', 'Model nemá místnosti (IfcSpace) s geometrií.'));
    return sec;
  }
  const wrap = el('div', 'color-row');
  const sel = el('select', 'color-key');
  sel.setAttribute('aria-label', 'Obarvit místnosti podle vlastnosti');
  if (!S.idx?.ready) {
    const o = el('option', null, 'Připravuji vlastnosti…'); sel.appendChild(o); sel.disabled = true;
    wrap.appendChild(sel);
    sec.append(wrap, el('p', 'muted small pad-x idx-progress', ''));
    ensureIndex().catch(() => {});
    return sec;
  }
  const skeys = spaceKeys();
  fillKeySelect(sel, S.color?.mode === 'prop' ? S.color.key : '', 'Bez barvení', skeys);
  sel.addEventListener('change', () => { if (S.color?.only != null) S.isolated = null; colorByKey(sel.value); applyVisibility(); });
  wrap.appendChild(sel);
  sec.appendChild(wrap);
  if (!S.color) {
    const quick = el('div', 'chips color-quick');
    const keys = skeys;
    const cands = ['Podlaží', 'LongName'];
    for (const k of [...keys.keys()]) if (/\.(Ucel|Účel|Usage|OccupancyType|Category|Kategorie|FireRating|Oddeleni|Oddělení|Uzivatel|Uživatel)$/i.test(k) && cands.length < 6) cands.push(k);
    cands.filter((k) => keys.has(k)).forEach((k) => {
      const b = el('button', 'chip', keyLabel(k).replace(/ \(.*\)$/, ''));
      b.type = 'button';
      b.addEventListener('click', () => colorByKey(k));
      quick.appendChild(b);
    });
    sec.appendChild(quick);
  }
  return sec;
}


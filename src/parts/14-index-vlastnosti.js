/* =====================================================================
   INDEX VLASTNOSTÍ – jeden průchod vazbami IFC, sdílí ho hledání,
   barvení, popisky místností a porovnání verzí.
   Sady vlastností se ukládají jednou a prvky na ně jen odkazují
   (typové sady sdílí tisíce prvků), aby index nebral moc paměti.
   ===================================================================== */
const ATTR_KEYS = ['Třída', 'Podlaží', 'Name', 'LongName', 'Typ', 'Materiál', 'Tag', 'ObjectType', 'PredefinedType', 'Description', 'GlobalId'];
const ATTR_LABEL = { Name: 'Název (Name)', LongName: 'Dlouhý název (LongName)', Typ: 'Typ', Materiál: 'Materiál', Tag: 'Tag', ObjectType: 'ObjectType', PredefinedType: 'PredefinedType', Description: 'Popis (Description)', GlobalId: 'GlobalId', Třída: 'Třída IFC', Podlaží: 'Podlaží' };
const deacc = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const yieldUi = () => new Promise((r) => setTimeout(r, 0));
const refId = (x) => (x && typeof x === 'object' ? x.value : x);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rawVal(v) {
  if (v == null) return null;
  if (Array.isArray(v)) { const a = v.map(rawVal).filter((x) => x != null && x !== ''); return a.length ? a.map(fmtVal).join(', ') : null; }
  if (typeof v === 'object') return 'value' in v ? rawVal(v.value) : null;
  if (v === true || v === 'T' || v === '.T.') return 'Ano';
  if (v === false || v === 'F' || v === '.F.') return 'Ne';
  if (v === 'U' || v === '.U.') return null;
  if (typeof v === 'string') return v.trim();
  return v;
}
function propValue(p) {
  if (p.NominalValue !== undefined) return rawVal(p.NominalValue);
  if (p.EnumerationValues) return rawVal(p.EnumerationValues);
  if (p.ListValues) return rawVal(p.ListValues);
  if (p.UpperBoundValue || p.LowerBoundValue) {
    const a = rawVal(p.LowerBoundValue), b = rawVal(p.UpperBoundValue);
    return a == null && b == null ? null : `${fmtVal(a)} – ${fmtVal(b)}`;
  }
  for (const k of Object.keys(QUNIT)) if (p[k] != null) return rawVal(p[k]);
  return null;
}
const fmtVal = (v) => (v == null ? '' : typeof v === 'number' ? nf.format(v) : String(v));

function parseSet(mid, sid, cache, units) {
  if (cache.has(sid)) return cache.get(sid);
  let out = { name: '', props: [], map: null, text: '' };
  try {
    const ps = S.api.GetLine(mid, sid, true);
    const name = val(ps?.Name) || 'Bez názvu';
    const items = ps?.HasProperties || ps?.Quantities || [];
    const props = [];
    for (const p of items) {
      if (!p || typeof p !== 'object') continue;
      const pn = val(p.Name);
      if (!pn) continue;
      if (Array.isArray(p.HasProperties)) { // složená vlastnost
        for (const q of p.HasProperties) {
          if (!q || typeof q !== 'object') continue;
          const v = propValue(q);
          if (v != null && v !== '') props.push([`${name}.${pn}.${val(q.Name)}`, v]);
        }
        continue;
      }
      const v = propValue(p);
      if (v == null || v === '') continue;
      const key = `${name}.${pn}`;
      props.push([key, v]);
      if (ps.Quantities && units && !units.has(key)) {
        const qk = Object.keys(QUNIT).find((k) => p[k] != null);
        if (qk) units.set(key, qk === 'LengthValue' ? ` ${unitLabel(S.geo?.pu ?? 1)}` : QUNIT[qk]);
      }
    }
    out = { name, props, map: new Map(props), text: deacc(props.map((x) => fmtVal(x[1])).join(' | ')) };
  } catch (e) { /* vadná sada */ }
  cache.set(sid, out);
  return out;
}
function materialNames(mid, mat, cache) {
  if (mat == null) return '';
  if (cache.has(mat)) return cache.get(mat);
  const names = new Set();
  try {
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 7) return;
      if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
      if (o.type === WebIFC.IFCMATERIAL && o.Name) names.add(val(o.Name));
      for (const k of Object.keys(o)) if (k !== 'type' && o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
    };
    walk(S.api.GetLine(mid, mat, true), 0);
  } catch (e) { /* ignore */ }
  const s = [...names].filter(Boolean).join(', ');
  cache.set(mat, s);
  return s;
}

/* index pro prvky `want` (Set expressID) v modelu `mid` */
async function buildIndex(mid, want, progress, isAlive) {
  const api = S.api;
  const idx = { mid, el: new Map(), units: new Map(), ready: false };
  const cache = new Map(), mcache = new Map();
  const get = (id) => {
    let r = idx.el.get(id);
    if (!r) { r = { a: Object.create(null), sets: [], tsets: [], atext: null }; idx.el.set(id, r); }
    return r;
  };
  let last = performance.now();
  const alive = () => { if (!S.api || (isAlive && !isAlive())) throw new Error('aborted'); };
  const tick = async (k, n, label) => {
    if (performance.now() - last > 14) { progress?.(label, n ? k / n : 0); await yieldUi(); alive(); last = performance.now(); }
  };
  // 1) typy prvků a jejich sady vlastností
  const typeOf = new Map(), typeInfo = new Map();
  let v = api.GetLineIDsWithType(mid, WebIFC.IFCRELDEFINESBYTYPE);
  for (let i = 0, n = v.size(); i < n; i++) {
    await tick(i, n, 'Typy prvků');
    let rel; try { rel = api.GetLine(mid, v.get(i), false); } catch (e) { continue; }
    const tid = refId(rel?.RelatingType);
    if (tid == null) continue;
    for (const o of rel.RelatedObjects || []) { const oid = refId(o); if (want.has(oid)) typeOf.set(oid, tid); }
  }
  for (const tid of new Set(typeOf.values())) {
    let t; try { t = api.GetLine(mid, tid, false); } catch (e) { continue; }
    const sets = [];
    for (const r of t?.HasPropertySets || []) { const s = parseSet(mid, refId(r), cache, idx.units); if (s.props.length) sets.push(s); }
    typeInfo.set(tid, { name: val(t?.Name), sets });
  }
  // 2) sady vlastností a množství prvků
  v = api.GetLineIDsWithType(mid, WebIFC.IFCRELDEFINESBYPROPERTIES);
  for (let i = 0, n = v.size(); i < n; i++) {
    await tick(i, n, 'Sady vlastností');
    let rel; try { rel = api.GetLine(mid, v.get(i), false); } catch (e) { continue; }
    const objs = (rel?.RelatedObjects || []).map(refId).filter((id) => want.has(id));
    if (!objs.length) continue;
    let defs = rel.RelatingPropertyDefinition;
    defs = Array.isArray(defs) ? defs : [defs];
    for (const d of defs) {
      const s = parseSet(mid, refId(d), cache, idx.units);
      if (!s.props.length) continue;
      for (const o of objs) get(o).sets.push(s);
    }
  }
  // 3) materiály (prvku nebo jeho typu)
  const matOf = new Map();
  try {
    v = api.GetLineIDsWithType(mid, WebIFC.IFCRELASSOCIATESMATERIAL);
    for (let i = 0, n = v.size(); i < n; i++) {
      await tick(i, n, 'Materiály');
      let rel; try { rel = api.GetLine(mid, v.get(i), false); } catch (e) { continue; }
      const objs = (rel?.RelatedObjects || []).map(refId).filter((id) => want.has(id) || typeInfo.has(id));
      if (!objs.length) continue;
      const names = materialNames(mid, refId(rel.RelatingMaterial), mcache);
      if (names) for (const o of objs) matOf.set(o, names);
    }
  } catch (e) { if (e?.message === 'aborted') throw e; }
  // 4) atributy
  let k = 0;
  for (const id of want) {
    await tick(k++, want.size, 'Atributy');
    const r = get(id);
    let L; try { L = api.GetLine(mid, id, false); } catch (e) { continue; }
    for (const a of ['Name', 'LongName', 'Description', 'ObjectType', 'Tag', 'PredefinedType', 'GlobalId']) {
      const x = rawVal(L?.[a]);
      if (x != null && x !== '') r.a[a] = typeof x === 'number' ? fmtVal(x) : x;
    }
    const tid = typeOf.get(id);
    const ti = tid != null ? typeInfo.get(tid) : null;
    if (ti) { if (ti.name) r.a.Typ = ti.name; r.tsets = ti.sets; }
    const m = matOf.get(id) ?? (tid != null ? matOf.get(tid) : null);
    if (m) r.a.Materiál = m;
  }
  return idx;
}
/* hodnota vlastnosti prvku: atribut, vlastní sada, pak sada typu */
function getProp(r, key) {
  if (!r) return null;
  if (key in r.a) return r.a[key];
  for (const s of r.sets) if (s.map.has(key)) return s.map.get(key);
  for (const s of r.tsets) if (s.map.has(key)) return s.map.get(key);
  return null;
}
/* všechny vlastnosti prvku jako text (pro porovnání verzí) */
function flatProps(r) {
  const out = new Map();
  if (!r) return out;
  for (const s of r.tsets) for (const [k, v] of s.props) out.set(k, fmtVal(v));
  for (const s of r.sets) for (const [k, v] of s.props) out.set(k, fmtVal(v));
  for (const k of Object.keys(r.a)) if (k !== 'GlobalId') out.set(k, fmtVal(r.a[k]));
  return out;
}
function keyCatalog(idx, onlyIds) {
  const keys = new Map();
  const entries = onlyIds ? onlyIds.map((id) => idx.el.get(id)).filter(Boolean) : idx.el.values();
  for (const r of entries) {
    const seen = new Set();
    const add = (key, v) => {
      if (seen.has(key) || v == null || v === '') return;
      seen.add(key);
      let k = keys.get(key);
      if (!k) { k = { count: 0, nums: 0, values: new Map() }; keys.set(key, k); }
      k.count++;
      if (typeof v === 'number') k.nums++;
      const sv = fmtVal(v);
      if (k.values.size < 400 || k.values.has(sv)) k.values.set(sv, (k.values.get(sv) || 0) + 1);
    };
    for (const a of Object.keys(r.a)) add(a, r.a[a]);
    for (const s of r.sets) for (const [kk, v] of s.props) add(kk, v);
    for (const s of r.tsets) for (const [kk, v] of s.props) add(kk, v);
  }
  return keys;
}
/* seznam klíčů pro výběr: atributy, pak sady (abecedně) */
function keyGroups(keysIn) {
  const keys = keysIn || S.idx?.keys;
  if (!keys) return [];
  const attrs = ATTR_KEYS.filter((k) => keys.has(k)).map((k) => ({ key: k, label: ATTR_LABEL[k] || k, count: keys.get(k).count }));
  const bySet = new Map();
  for (const [k, info] of keys) {
    if (ATTR_KEYS.includes(k)) continue;
    const dot = k.indexOf('.');
    const set = k.slice(0, dot), name = k.slice(dot + 1);
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set).push({ key: k, label: name, count: info.count });
  }
  const coll = new Intl.Collator('cs', { numeric: true });
  const groups = [{ label: 'Atributy', items: attrs }];
  [...bySet.keys()].sort(coll.compare).forEach((s) => groups.push({ label: s, items: bySet.get(s).sort((a, b) => coll.compare(a.label, b.label)) }));
  return groups;
}
function keyLabel(key) {
  if (ATTR_LABEL[key]) return ATTR_LABEL[key];
  const dot = key.indexOf('.');
  return dot > 0 ? `${key.slice(dot + 1)} (${key.slice(0, dot)})` : key;
}
function fillKeySelect(sel, current, emptyLabel, keys) {
  sel.replaceChildren();
  if (emptyLabel) { const o = el('option', null, emptyLabel); o.value = ''; sel.appendChild(o); }
  for (const g of keyGroups(keys)) {
    if (!g.items.length) continue;
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const it of g.items) {
      const o = el('option', null, `${it.label} (${it.count.toLocaleString('cs-CZ')})`);
      o.value = it.key;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  sel.value = current || '';
}

function ensureIndex() {
  if (S.loading) return S.loadWait.then(() => ensureIndex());
  if (S.modelID == null) return Promise.reject(new Error('Žádný model'));
  if (S.idx?.ready && S.idx.mid === S.modelID) return Promise.resolve(S.idx);
  if (S.idxPromise && S.idxFor === S.modelID && S.idxGen === S.modelGen) return S.idxPromise;
  const mid = S.modelID, gen = S.modelGen;
  const alive = () => S.modelID === mid && S.modelGen === gen;
  S.idxFor = mid; S.idxGen = gen; S.idxProgress = 0; S.idxLabel = '';
  S.idxPromise = (async () => {
    await yieldUi();
    if (!alive()) throw new Error('aborted');
    const idx = await buildIndex(mid, new Set(S.elements.keys()), (label, f) => { S.idxLabel = label; S.idxProgress = f; onIndexProgress(); }, alive);
    if (!alive()) throw new Error('aborted');
    const stName = new Map(S.storeys.map((s) => [s.id, s.name]));
    for (const [id, rec] of S.elements) {
      let r = idx.el.get(id);
      if (!r) { r = { a: Object.create(null), sets: [], tsets: [], atext: null }; idx.el.set(id, r); }
      r.a.Třída = prettyCls(rec.cls);
      if (rec.storey !== -1 && stName.has(rec.storey)) r.a.Podlaží = stName.get(rec.storey);
    }
    idx.keys = keyCatalog(idx);
    idx.ready = true;
    S.idx = idx;
    onIndexReady();
    return idx;
  })();
  S.idxPromise.catch((e) => { if (e?.message !== 'aborted') console.warn('index', e); });
  return S.idxPromise;
}
let idxUiTimer = 0;
function onIndexProgress() {
  if (idxUiTimer) return;
  idxUiTimer = setTimeout(() => {
    idxUiTimer = 0;
    const pct = `${Math.round((S.idxProgress || 0) * 100)} %`;
    document.querySelectorAll('.idx-progress').forEach((n) => { n.textContent = `Připravuji index vlastností: ${S.idxLabel || ''} ${pct}`; });
  }, 120);
}
function onIndexReady() {
  if (!$('#panel-search').hidden) renderSearchPanel();
  if (!$('#panel-model').hidden) renderModelPanel();
  if (plan.on) { S.roomLbl = null; markPlanDirty(0); }
}


/* ---------- panel: properties ---------- */
const val = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(val).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    if ('value' in v) return val(v.value);
    return '';
  }
  if (v === true || v === 'T' || v === '.T.') return 'Ano';
  if (v === false || v === 'F' || v === '.F.') return 'Ne';
  if (typeof v === 'number') return nf.format(v);
  return String(v);
};
const QUNIT = { LengthValue: ' m', AreaValue: ' m²', VolumeValue: ' m³', WeightValue: ' kg', CountValue: ' ks', TimeValue: ' s' };

function propRows(set) {
  const rows = [];
  const items = set.HasProperties || set.Quantities || [];
  for (const p of items) {
    if (!p) continue;
    const name = val(p.Name) || '—';
    let v = '';
    if (p.NominalValue !== undefined) v = val(p.NominalValue);
    else if (p.EnumerationValues) v = val(p.EnumerationValues);
    else if (p.ListValues) v = val(p.ListValues);
    else if (p.UpperBoundValue || p.LowerBoundValue) v = `${val(p.LowerBoundValue)} – ${val(p.UpperBoundValue)}`;
    else if (p.HasProperties) v = `${p.HasProperties.length} položek`;
    else {
      const k = Object.keys(QUNIT).find((key) => p[key] !== undefined && p[key] !== null);
      if (k) v = val(p[k]) + QUNIT[k];
    }
    rows.push([name, v]);
  }
  return rows;
}

/* všechny přímé atributy entity v pořadí podle schématu, i nevyplněné ($) – aby šlo zkontrolovat,
   co dodavatel nevyplnil. Odkazy na jiné entity (umístění, geometrie, historie) se vynechávají. */
const ATTR_SKIP = new Set(['expressID', 'type', 'GlobalId', 'OwnerHistory', 'ObjectPlacement', 'Representation',
  'RepresentationContexts', 'UnitsInContext', 'RepresentationMaps', 'HasPropertySets']);
function attrValue(v, pu) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.some((x) => x?.type === 5) ? null : v.map((x) => attrValue(x, pu)).filter(Boolean).join(', ');
  if (typeof v !== 'object') return val(v);
  if (v.type === 5) return null; // odkaz
  if (v.type === 4 || v._representationValue != null) {
    const n = GEO_NUM(v);
    if (n == null) return '';
    const len = /LENGTHMEASURE$/.test(v.name || '') && pu;
    return len ? `${nf.format(n)} ${unitLabel(pu)}` : nf.format(n);
  }
  return val(v);
}
function entityAttrRows(item, { pu = null, skipFilled = null } = {}) {
  const rows = [];
  for (const k of Object.keys(item)) {
    if (ATTR_SKIP.has(k)) continue;
    const v = attrValue(item[k], pu);
    if (v === null) continue;
    if (v && skipFilled?.has(k)) continue; // vyplněné hodnoty ukáže v lepším formátu spatialRows
    rows.push([k, v]);
  }
  return rows;
}
const SPATIAL_KEYS = new Set(['Elevation', 'ElevationOfRefHeight', 'ElevationOfTerrain', 'BuildingAddress', 'RefLatitude', 'RefLongitude',
  'RefElevation', 'LandTitleNumber', 'SiteAddress', 'CompositionType']);

/* Které sady a vlastnosti mají ostatní prvky stejné třídy (z indexu vlastností; počítají se jen vyplněné).
   Slouží k ukázání vlastností, které prvku úplně chybí – barvení je hlásí jako nevyplněné. */
function classPropSchema(cls) {
  const idx = S.idx;
  if (!idx?.ready || idx.mid !== S.modelID) return null;
  if (!idx.schema) idx.schema = new Map();
  if (idx.schema.has(cls)) return idx.schema.get(cls);
  const sets = new Map();
  let total = 0;
  for (const [eid, rec] of S.elements) {
    if (rec.cls !== cls) continue;
    total++;
    const r = idx.el.get(eid);
    if (!r) continue;
    const seen = new Set();
    for (const s of [...r.sets, ...r.tsets]) {
      let m = sets.get(s.name);
      if (!m) sets.set(s.name, (m = new Map()));
      for (const [k] of s.props) {
        const pn = k.slice(s.name.length + 1).split('.')[0];
        const key = `${s.name}\u0000${pn}`;
        if (seen.has(key)) continue;
        seen.add(key);
        m.set(pn, (m.get(pn) || 0) + 1);
      }
    }
  }
  const sch = { total, sets };
  idx.schema.set(cls, sch);
  return sch;
}
function missingRow(dl, name, n, total) {
  const dd = el('dd', 'kv-missing', `chybí · vyplněno u ${n.toLocaleString('cs-CZ')} z ${total.toLocaleString('cs-CZ')}`);
  dd.title = 'Vlastnost v prvku není, ostatní prvky stejné třídy ji mají';
  dl.append(el('dt', 'kv-missing-k', softBreak(name)), dd);
}
/* doplní do zobrazených sad chybějící vlastnosti a přidá sady, které prvku chybí celé */
function addMissingProps(root, cls, shown) {
  const sch = classPropSchema(cls);
  if (!sch || sch.total < 2) return;
  const coll = new Intl.Collator('cs', { numeric: true });
  for (const [setName, props] of [...sch.sets].sort((a, b) => coll.compare(a[0], b[0]))) {
    const have = shown.get(setName);
    const miss = [...props].filter(([pn]) => !have?.names.has(pn));
    if (!miss.length) continue;
    let dl;
    if (have) dl = have.dl;
    else {
      const sec = table(setName, [], 'chybí');
      sec.classList.add('pset-missing');
      root.appendChild(sec);
      dl = sec.querySelector('dl');
    }
    miss.forEach(([pn, n]) => missingRow(dl, pn, n, sch.total));
  }
}

/* dlouhé názvy ve tvaru ElevationWithFlooring: zalomit mezi slovy, ne uprostřed slova */
const softBreak = (k) => (String(k).length > 14 ? String(k).replace(/([a-z])([A-Z])/g, '$1\u200b$2') : k);
function table(title, rows, extra) {
  const sec = el('section', 'pset');
  const h = el('h3', 'pset-title', title);
  if (extra) h.appendChild(el('span', 'pset-tag', extra));
  sec.appendChild(h);
  const dl = el('dl', 'kv');
  rows.forEach(([k, v]) => {
    dl.append(el('dt', null, softBreak(k)), el('dd', v ? null : 'kv-empty', v || '—'));
  });
  sec.appendChild(dl);
  return sec;
}

let propToken = 0;
/* vlastnosti prvku bez geometrie (projekt, pozemek, budova, podlaží…) */
function inspect(id, from) {
  deselect(false);
  S.inspectId = id;
  S.inspectFrom = from || null;
  updateToolbar(); requestRender();
  if (!$('#panel-tree').hidden) renderTree();
  showPanel('props');
  renderProps();
}
const fmtUnitLen = (v) => {
  const pu = S.geo?.pu ?? 1;
  const m = v * pu;
  return `${nf3s.format(m)} m${Math.abs(pu - 1) > 1e-9 ? ` (v souboru ${nf.format(v)} ${unitLabel(pu)})` : ''}`;
};
function addressText(a) {
  if (!a || typeof a !== 'object') return '';
  const lines = (Array.isArray(a.AddressLines) ? a.AddressLines : []).map(val).filter(Boolean);
  const town = [val(a.PostalCode), val(a.Town)].filter(Boolean).join(' ');
  return [...lines, town, val(a.Region), val(a.Country)].filter(Boolean).join(', ');
}
function dmsText(v) {
  const a = Array.isArray(v) ? v : v?.value;
  if (!Array.isArray(a) || a.length < 3) return '';
  const n = a.map((x) => Number(GEO_NUM(x)));
  const deg = n[0] + n[1] / 60 + n[2] / 3600 + (n[3] || 0) / 3.6e9;
  return `${n[0]}° ${Math.abs(n[1])}′ ${Math.abs(n[2] + (n[3] || 0) / 1e6).toFixed(3).replace('.', ',')}″ (${nf6.format(deg)}°)`;
}
/* místnosti (IfcSpace) uvnitř prostorového prvku: podle stromu i podle přiřazení geometrie */
function spacesIn(id) {
  const out = new Set();
  let node = null;
  const stack = S.tree ? [S.tree] : [];
  while (stack.length && !node) {
    const n = stack.pop();
    if (n.expressID === id) node = n; else for (const c of n.children || []) stack.push(c);
  }
  if (node) {
    const st2 = [node];
    while (st2.length) {
      const n = st2.pop();
      if (n !== node && U(n.type || '') === 'IFCSPACE') out.add(n.expressID);
      for (const c of n.children || []) st2.push(c);
    }
  }
  if (S.storeys.some((s0) => s0.id === id)) {
    for (const [eid, rec] of S.elements) if (rec.storey === id && U(rec.cls) === 'IFCSPACE') out.add(eid);
  }
  return [...out];
}
function spaceSection(ids, label) {
  const coll = new Intl.Collator('cs', { numeric: true });
  const items = ids.map((sid) => {
    let name = '', ln = '';
    try { const l = S.api.GetLine(S.modelID, sid); name = val(l?.Name); ln = val(l?.LongName); } catch (e) { /* ignore */ }
    return { sid, name, ln };
  }).sort((a, b) => coll.compare(a.name || a.ln, b.name || b.ln));
  const sec = el('section', 'pset');
  const h = el('h3', 'pset-title', 'Místnosti');
  const right = el('span', 'pset-right');
  right.appendChild(el('span', 'pset-tag', String(items.length)));
  const xb = el('button', 'sbtn mini-btn xlsx-btn', 'Excel');
  xb.type = 'button';
  xb.title = 'Exportovat tyto místnosti do Excelu';
  xb.addEventListener('click', () => exportRoomsXlsx(ids, label).catch((e) => toast(`Export se nepodařil: ${e?.message || e}`, true)));
  right.appendChild(xb);
  h.appendChild(right);
  sec.appendChild(h);
  const list = el('div', 'space-list');
  const LIMIT = 300;
  items.slice(0, LIMIT).forEach(({ sid, name, ln }) => {
    const b = el('button', 'space-item');
    b.type = 'button';
    b.append(el('span', 'space-no', name || `#${sid}`), el('span', 'space-ln', ln && ln !== name ? ln : ''));
    b.addEventListener('click', () => {
      const rec = S.elements.get(sid);
      if (!rec) { inspect(sid, null); return; }
      const c = S.classes.get(rec.cls);
      if (c && !c.visible) { c.visible = true; S.isolated = null; applyVisibility(); renderModelPanel(); }
      if (S.hidden.has(sid)) { S.hidden.delete(sid); applyVisibility(); }
      select(sid);
    });
    list.appendChild(b);
  });
  if (items.length > LIMIT) list.appendChild(el('p', 'muted small', `… a dalších ${items.length - LIMIT}`));
  sec.appendChild(list);
  return sec;
}
/* atributy typické pro prostorové třídy */
function spatialRows(id, cls) {
  const rows = [];
  let L;
  try { L = S.api.GetLine(S.modelID, id, true); } catch (e) { return rows; }
  const c = U(cls);
  const num = (k) => GEO_NUM(L?.[k]);
  if (c === 'IFCBUILDINGSTOREY') {
    const e = num('Elevation');
    if (e != null) {
      rows.push(['Elevation', fmtUnitLen(e)]);
      if (S.geo?.ok) {
        const H = geoMapFromLocal({ x: 0, y: 0, z: e * (S.geo.pu ?? 1) }).H;
        rows.push([`${geoLabels()[2]} podlahy`, nf3s.format(H)]);
      }
    }
    const st = S.storeys.find((s0) => s0.id === id);
    if (st) rows.push(['Prvků s geometrií', st.count.toLocaleString('cs-CZ')]);
    rows.push(['Počet místností', String(spacesIn(id).length)]);
  }
  if (c === 'IFCBUILDING') {
    const r = num('ElevationOfRefHeight'), t = num('ElevationOfTerrain');
    if (r != null) rows.push(['ElevationOfRefHeight', fmtUnitLen(r)]);
    if (t != null) rows.push(['ElevationOfTerrain', fmtUnitLen(t)]);
    const ad = addressText(L?.BuildingAddress);
    if (ad) rows.push(['BuildingAddress', ad]);
    rows.push(['Počet místností', String(spacesIn(id).length)]);
  }
  if (c === 'IFCSITE') {
    const la = dmsText(L?.RefLatitude), lo = dmsText(L?.RefLongitude);
    if (la) rows.push(['RefLatitude', la]);
    if (lo) rows.push(['RefLongitude', lo]);
    const re = num('RefElevation');
    if (re != null) rows.push(['RefElevation', fmtUnitLen(re)]);
    const lt = val(L?.LandTitleNumber);
    if (lt) rows.push(['LandTitleNumber', lt]);
    const ad = addressText(L?.SiteAddress);
    if (ad) rows.push(['SiteAddress', ad]);
  }
  if (c === 'IFCPROJECT') {
    if (S.meta?.schema) rows.push(['Schéma', S.meta.schema]);
    rows.push(['Jednotky délky', unitLabel(S.geo?.pu ?? 1)]);
    if (S.geo?.ok) rows.push(['Georeference', S.geo.epsg ? `EPSG:${S.geo.epsg}` : (S.geo.crs?.name || 'ano')]);
  }
  const ct = val(L?.CompositionType);
  if (ct) rows.push(['CompositionType', ct]);
  return rows;
}
async function renderProps() {
  const root = $('#panel-props');
  const token = ++propToken;
  if (S.cmpSel != null && S.cmp) { ghostPropsView(root); return; }
  if (S.refSel) { refPropsView(root, token); return; }
  if (S.selected == null && S.inspectId == null) {
    root.replaceChildren();
    const empty = el('div', 'props-empty');
    empty.append(el('p', 'props-empty-title', 'Žádný vybraný prvek'),
      el('p', 'muted', 'Klepněte na prvek v modelu. Zobrazí se jeho atributy a všechny sady vlastností včetně vlastností typu. Vlastnosti projektu, pozemku, budovy a podlaží zobrazíte klepnutím na jejich název ve Stromu.'));
    root.appendChild(empty);
    return;
  }
  const id = S.selected ?? S.inspectId, api = S.api, mid = S.modelID;
  const rec = S.elements.get(id);
  let cls = rec?.cls;
  if (!cls) { try { cls = api.GetNameFromTypeCode(api.GetLineType(mid, id)); } catch (e) { cls = 'IfcObject'; } }
  root.replaceChildren(el('p', 'muted pad', 'Načítám vlastnosti…'));
  try {
    const item = await api.properties.getItemProperties(mid, id, false);
    const psets = (await api.properties.getPropertySets(mid, id, true)).map((p) => ({ p, from: null }));
    // typ prvku (otevřený ze stromu): sady vlastností jsou přímo na typu
    for (const r of item.HasPropertySets || []) {
      try { const ps = await api.properties.getItemProperties(mid, refId(r), true); if (ps) psets.push({ p: ps, from: null }); } catch (e) { /* */ }
    }
    let typeNames = [];
    try {
      const types = await api.properties.getTypeProperties(mid, id, true);
      for (const t of types || []) {
        if (val(t.Name)) typeNames.push(val(t.Name));
        for (const p of t.HasPropertySets || []) if (p && typeof p === 'object') psets.push({ p, from: 'Typ' });
      }
    } catch (e) { /* no type */ }
    let materials = [];
    try {
      const mats = await api.properties.getMaterialsProperties(mid, id, true, true);
      const names = new Set();
      const walk = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 6) return;
        if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
        if (o.type === WebIFC.IFCMATERIAL && o.Name) names.add(val(o.Name));
        for (const k of Object.keys(o)) if (k !== 'type' && typeof o[k] === 'object') walk(o[k], depth + 1);
      };
      walk(mats, 0);
      materials = [...names].filter(Boolean);
    } catch (e) { /* no materials */ }
    if (token !== propToken) return;

    root.replaceChildren();
    const head = el('header', 'el-head');
    if (!rec && S.inspectFrom === 'tree') {
      const back = el('button', 'link back-link', '← Zpět do stromu'); back.type = 'button';
      back.addEventListener('click', () => showPanel('tree'));
      head.appendChild(back);
    }
    head.appendChild(el('div', 'el-class', prettyCls(cls)));
    head.appendChild(el('h2', 'el-name', val(item.Name) || classLabel(cls)));
    const ln = val(item.LongName);
    if (!rec && ln && ln !== val(item.Name)) head.appendChild(el('div', 'el-storey', ln));
    const st = rec ? S.storeys.find((s0) => s0.id === rec.storey) : null;
    if (st) head.appendChild(el('div', 'el-storey', st.name));
    const gid = val(item.GlobalId);
    if (gid) {
      const g = el('button', 'guid');
      g.type = 'button';
      g.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', gid), el('span', 'guid-a', 'Kopírovat'));
      g.addEventListener('click', () => copy(gid, g));
      head.appendChild(g);
    }
    if (rec) {
      const nb = el('button', 'sbtn primary bcf-new', 'Přidat BCF záznam');
      nb.type = 'button';
      nb.addEventListener('click', () => bcfStartNew());
      head.appendChild(nb);
    }
    root.appendChild(head);
    if (rec && S.cmp) { const cs = cmpDiffSection(id); if (cs) root.appendChild(cs); }

    const attrs = entityAttrRows(item, { pu: S.geo?.pu ?? null, skipFilled: rec ? null : SPATIAL_KEYS });
    attrs.push(['Express ID', `#${id}`]);
    if (typeNames.length) attrs.push(['Typ', typeNames.join(', ')]);
    if (materials.length) attrs.push(['Materiál', materials.join(', ')]);
    if (!rec) { try { attrs.push(...spatialRows(id, cls)); } catch (e) { console.warn(e); } }
    root.appendChild(table('Atributy', attrs));
    if (rec) {
      // skladba (vrstvy) materiálu; vazby se při prvním použití dočtou na pozadí a panel se překreslí
      if (S.rel?.gen === S.modelGen) {
        const mrows = materialRowsFor(id);
        if (mrows.length > 1 || mrows.some((r) => r.label !== 'Materiál')) root.appendChild(table('Skladba materiálu', mrows.map((r) => [r.label, r.value])));
      } else ensureRelIdx().then(() => { if (token === propToken) renderProps(); }).catch(() => {});
    }
    if (!rec && ['IFCBUILDINGSTOREY', 'IFCBUILDING'].includes(U(cls))) {
      try { const sp = spacesIn(id); if (sp.length) root.appendChild(spaceSection(sp, val(item.Name) || '')); } catch (e) { console.warn(e); }
    }
    if (rec) try { const pos = geoElementRows(rec); if (pos.length) root.appendChild(table(S.geo?.ok ? 'Poloha v mapě' : 'Poloha v projektu', pos)); } catch (e) { console.warn(e); }

    const sorted = [...psets].sort((a, b) => {
      const qa = a.p.Quantities ? 1 : 0, qb = b.p.Quantities ? 1 : 0;
      return qa - qb || (a.from ? 1 : 0) - (b.from ? 1 : 0) || val(a.p.Name).localeCompare(val(b.p.Name), 'cs');
    });
    const seen = new Set(), shown = new Map();
    for (const { p: ps, from } of sorted) {
      if (seen.has(ps.expressID)) continue;
      seen.add(ps.expressID);
      const rows = propRows(ps);
      if (!rows.length) continue;
      const nm = val(ps.Name) || 'Bez názvu';
      const sec = table(nm, rows, ps.Quantities ? 'Množství' : from);
      root.appendChild(sec);
      const e = shown.get(nm) || { dl: sec.querySelector('dl'), names: new Set() };
      rows.forEach(([k]) => e.names.add(k));
      shown.set(nm, e);
    }
    if (!sorted.length) root.appendChild(el('p', 'muted pad', 'Nemá žádné sady vlastností.'));
    // vlastnosti, které mají ostatní prvky stejné třídy a tomuto chybí (index se případně dopočítá na pozadí)
    if (rec) {
      if (S.idx?.ready && S.idx.mid === S.modelID) addMissingProps(root, rec.cls, shown);
      else ensureIndex().then(() => { if (token === propToken) renderProps(); }).catch(() => {});
    }
  } catch (e) {
    console.error(e);
    if (token === propToken) root.replaceChildren(el('p', 'muted pad', 'Vlastnosti se nepodařilo načíst.'));
  }
}

async function copy(text, btn) {
  const lab = btn.querySelector('.guid-a');
  try {
    await navigator.clipboard.writeText(text);
    lab.textContent = 'Zkopírováno';
  } catch (e) {
    const r = document.createRange();
    r.selectNodeContents(btn.querySelector('.guid-v'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    lab.textContent = 'Označeno';
  }
  setTimeout(() => { lab.textContent = 'Kopírovat'; }, 1600);
}


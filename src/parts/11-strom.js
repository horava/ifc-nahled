/* ---------- IFC tree ---------- */
const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCFACILITY', 'IFCFACILITYPART', 'IFCBRIDGE', 'IFCROAD', 'IFCRAILWAY']);
const TREE_PAGE = 200;
function nodeName(id) {
  if (S.names.has(id)) return S.names.get(id);
  let n = '';
  try {
    const l = S.api.GetLine(S.modelID, id);
    const name = l?.Name?.value || '', ln = l?.LongName?.value || '';
    n = name && ln && ln !== name ? `${name} – ${ln}` : (name || ln);
  } catch (e) { /* ignore */ }
  S.names.set(id, n);
  return n;
}
function typeOfNode(node) { return S.elements.get(node.expressID)?.cls || node.type || ''; }
function prettyCls(t) {
  const u = U(t);
  if (u.startsWith('IFC') && t === u) return 'Ifc' + u.slice(3).toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return t;
}
/* descendant element ids with geometry (memoized per node object) */
const descCache = new WeakMap();
function descIds(node) {
  if (descCache.has(node)) return descCache.get(node);
  const out = [];
  if (S.elements.has(node.expressID)) out.push(node.expressID);
  for (const c of node.children || []) { const d = descIds(c); for (let i = 0; i < d.length; i++) out.push(d[i]); } // bez spread: velké modely
  descCache.set(node, out);
  return out;
}
/* children shown in the tree: spatial children first; many elements grouped by class */
function treeChildren(node) {
  const kids = node.children || [];
  const spatial = kids.filter((k) => SPATIAL.has(U(k.type)));
  const elems = kids.filter((k) => !SPATIAL.has(U(k.type)));
  if (elems.length <= 12) return [...spatial, ...elems];
  const groups = new Map();
  for (const e of elems) {
    const c = typeOfNode(e);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(e);
  }
  const g = [...groups.entries()].sort((a, b) => classLabel(a[0]).localeCompare(classLabel(b[0]), 'cs'))
    .map(([cls, children]) => ({ group: true, key: `${node.expressID}:${cls}`, cls, children }));
  return [...spatial, ...g];
}
const nodeKey = (n) => (n.group ? n.key : String(n.expressID));
/* cesta ke hledanému prvku; skupina (např. „Dveře“) už se znovu neseskupuje,
   jinak by se hledání zacyklilo */
function findPath(node, id, path = []) {
  if (!node.group && node.expressID === id) return [...path, node];
  if (!node.group && !descIds(node).includes(id)) return null; // rychlé odříznutí větví bez prvku
  const kids = node.group ? node.children : treeChildren(node);
  for (const c of kids) {
    const r = findPath(c, id, [...path, node]);
    if (r) return r;
  }
  return null;
}
function setHiddenFor(ids, hide) {
  for (const id of ids) { if (hide) S.hidden.add(id); else S.hidden.delete(id); }
  if (S.isolated) S.isolated = null;
  applyVisibility();
}
/* ---------- podrobnosti prvku ve stromu (typ, vrstvy materiálu, otvory a jejich výplně) ----------
   Vazby se jednou projdou a uloží (typ, materiál, otvory, výplně), podrobnosti konkrétního prvku se
   čtou až při rozbalení. */
function ensureRelIdx() {
  if (S.loading) return S.loadWait.then(() => ensureRelIdx());
  if (S.rel && S.rel.mid === S.modelID && S.rel.gen === S.modelGen) return Promise.resolve(S.rel);
  if (S.relPending) return S.relPending;
  const api = S.api, mid = S.modelID, gen = S.modelGen;
  S.relPending = (async () => {
    const R = { mid, gen, type: new Map(), mat: new Map(), voids: new Map(), fills: new Map() };
    const each = async (T, fn) => {
      let v; try { v = api.GetLineIDsWithType(mid, T); } catch (e) { return; }
      for (let i = 0, n = v.size(); i < n; i++) {
        if (i % 400 === 399) { await yieldUi(); if (S.modelGen !== gen) throw new Error('aborted'); }
        let rel; try { rel = api.GetLine(mid, v.get(i), false); } catch (e) { continue; }
        if (rel) fn(rel);
      }
    };
    const push = (m, k, v) => { if (k == null || v == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    await each(WebIFC.IFCRELDEFINESBYTYPE, (r) => { const t = refId(r.RelatingType); for (const o of r.RelatedObjects || []) R.type.set(refId(o), t); });
    await each(WebIFC.IFCRELASSOCIATESMATERIAL, (r) => { const m = refId(r.RelatingMaterial); for (const o of r.RelatedObjects || []) R.mat.set(refId(o), m); });
    await each(WebIFC.IFCRELVOIDSELEMENT, (r) => push(R.voids, refId(r.RelatingBuildingElement), refId(r.RelatedOpeningElement)));
    await each(WebIFC.IFCRELFILLSELEMENT, (r) => push(R.fills, refId(r.RelatingOpeningElement), refId(r.RelatedBuildingElement)));
    if (S.modelGen === gen) S.rel = R;
    return R;
  })().finally(() => { S.relPending = null; });
  return S.relPending;
}
const lineType = (id) => { try { return S.api.GetLineType(S.modelID, id); } catch (e) { return 0; } };
const lineOf = (id) => { try { return S.api.GetLine(S.modelID, id, false); } catch (e) { return null; } };
const numRaw = (x) => Number(x && typeof x === 'object' ? x.value : x);
const fmtThickness = (v) => {
  const mm = Number(v) * (S.geo?.pu ?? 1) * 1000;
  return Number.isFinite(mm) ? `${nf.format(Math.round(mm * 10) / 10)} mm` : '';
};
/* materiál prvku (nebo jeho typu) jako řádky: vrstvy s tloušťkou, složky, profily, seznam */
function materialRowsFor(id) {
  const R = S.rel;
  if (!R) return [];
  let mId = R.mat.get(id);
  if (mId == null) { const t = R.type.get(id); if (t != null) mId = R.mat.get(t); }
  if (mId == null) return [];
  const name = (mid) => val(lineOf(mid)?.Name) || '';
  const rows = [];
  const walk = (x, depth) => {
    if (x == null || depth > 4) return;
    const L = lineOf(x);
    if (!L) return;
    switch (L.type) {
      case WebIFC.IFCMATERIALLAYERSETUSAGE: walk(refId(L.ForLayerSet), depth + 1); break;
      case WebIFC.IFCMATERIALLAYERSET:
        for (const ly of L.MaterialLayers || []) {
          const l = lineOf(refId(ly));
          if (!l) continue;
          const nm = name(refId(l.Material)) || val(l.Name) || 'Vrstva';
          rows.push({ label: 'Vrstva materiálu', value: [nm, fmtThickness(numRaw(l.LayerThickness))].filter(Boolean).join(' · ') });
        }
        break;
      case WebIFC.IFCMATERIALPROFILESETUSAGE: walk(refId(L.ForProfileSet), depth + 1); break;
      case WebIFC.IFCMATERIALPROFILESET:
        for (const pr of L.MaterialProfiles || []) {
          const q = lineOf(refId(pr));
          if (!q) continue;
          const prof = lineOf(refId(q.Profile));
          rows.push({ label: 'Profil', value: [name(refId(q.Material)), val(prof?.ProfileName) || val(q.Name)].filter(Boolean).join(' · ') });
        }
        break;
      case WebIFC.IFCMATERIALCONSTITUENTSET:
        for (const c of L.MaterialConstituents || []) {
          const q = lineOf(refId(c));
          if (!q) continue;
          const fr = numRaw(q.Fraction);
          rows.push({ label: 'Složka materiálu', value: [val(q.Name), name(refId(q.Material)), Number.isFinite(fr) && fr > 0 ? `${nf.format(Math.round(fr * 1000) / 10)} %` : ''].filter(Boolean).join(' · ') });
        }
        break;
      case WebIFC.IFCMATERIALLIST: for (const m of L.Materials || []) rows.push({ label: 'Materiál', value: name(refId(m)) }); break;
      case WebIFC.IFCMATERIAL: rows.push({ label: 'Materiál', value: val(L.Name) || '' }); break;
      default: break;
    }
  };
  walk(mId, 0);
  return rows.filter((r) => r.value);
}
function elementDetails(id) {
  const R = S.rel;
  if (!R) return [];
  const out = [];
  const tid = R.type.get(id);
  if (tid != null) {
    const t = lineOf(tid);
    let tc = ''; try { tc = S.api.GetNameFromTypeCode(lineType(tid)); } catch (e) { /* */ }
    out.push({ label: `Typ · ${prettyCls(tc)}`, value: val(t?.Name) || 'bez názvu', inspect: tid });
  }
  out.push(...materialRowsFor(id));
  for (const op of R.voids.get(id) || []) {
    const o = lineOf(op);
    const oname = val(o?.Name) || val(o?.Tag) || `#${op}`;
    const fill = (R.fills.get(op) || [])[0];
    if (fill != null) out.push({ label: 'Otvor s výplní', value: `${oname} → ${nodeName(fill) || prettyCls(S.elements.get(fill)?.cls || '')}`, select: S.elements.has(fill) ? fill : null, inspect: S.elements.has(fill) ? null : fill });
    else out.push({ label: 'Otvor / prostup', value: oname, inspect: op });
  }
  return out;
}
const hasDetails = (id) => { const R = S.rel; return !!R && (R.type.has(id) || R.mat.has(id) || R.voids.has(id)); };
function renderTree(reveal = false) {
  const root = $('#panel-tree');
  if (S.modelID == null || !S.tree) { root.replaceChildren(el('p', 'muted pad', 'Strom modelu není k dispozici.')); return; }
  if (reveal && S.selected != null) {
    const path = findPath(S.tree, S.selected);
    if (path) path.slice(0, -1).forEach((n) => S.treeOpen.add(nodeKey(n)));
  }
  const scroll = root.scrollTop;
  root.replaceChildren();
  const ul = el('ul', 'tree');
  const add = (node, depth, parentUl) => {
    const key = nodeKey(node);
    const li = el('li');
    const row = el('div', 'tnode');
    row.style.paddingLeft = `${4 + depth * 14}px`;
    const kids = node.group ? node.children : treeChildren(node);
    const open = S.treeOpen.has(key);
    // prvek (ne prostorová struktura): rozbalí se i na typ, vrstvy materiálu a otvory
    const isEl = !node.group && !SPATIAL.has(U(node.type)) && hasDetails(node.expressID);
    const det = open && isEl ? elementDetails(node.expressID) : [];
    const expandable = kids.length || isEl;
    const tw = el('button', 'twist' + (expandable ? '' : ' leaf'));
    tw.type = 'button';
    tw.setAttribute('aria-label', open ? 'Sbalit' : 'Rozbalit');
    tw.setAttribute('aria-expanded', String(open));
    tw.innerHTML = expandable ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' : '';
    if (open) tw.classList.add('open');
    tw.addEventListener('click', () => { if (!expandable) return; if (open) S.treeOpen.delete(key); else S.treeOpen.add(key); renderTree(); });
    const ids = node.group ? node.children.reduce((acc, c) => { const d = descIds(c); for (let i = 0; i < d.length; i++) acc.push(d[i]); return acc; }, []) : descIds(node);
    const allHidden = ids.length > 0 && ids.every((i) => S.hidden.has(i));
    const eye = el('button', 'eye');
    eye.type = 'button';
    eye.disabled = !ids.length;
    eye.innerHTML = allHidden ? EYE_OFF : EYE;
    eye.setAttribute('aria-label', allHidden ? 'Zobrazit' : 'Skrýt');
    eye.addEventListener('click', () => setHiddenFor(ids, !allHidden));
    const lab = el('button', 'tlabel');
    lab.type = 'button';
    const t = node.group ? node.cls : typeOfNode(node);
    const nm = node.group ? classLabel(node.cls) : (nodeName(node.expressID) || prettyCls(t));
    lab.append(el('span', 'tname', nm), el('span', 'tcls', node.group ? `${prettyCls(node.cls)} · ${node.children.length}` : prettyCls(t)));
    const hasGeo = !node.group && S.elements.has(node.expressID);
    if (!node.group && (node.expressID === S.selected || node.expressID === S.inspectId)) row.classList.add('is-sel');
    if (allHidden) row.classList.add('is-off');
    lab.addEventListener('click', () => {
      if (hasGeo) { if (S.selected === node.expressID) deselect(); else select(node.expressID, { keepPanel: true }); }
      else if (!node.group) inspect(node.expressID, 'tree');
      else if (kids.length) { if (open) S.treeOpen.delete(key); else S.treeOpen.add(key); renderTree(); }
    });
    const cnt = el('span', 'row-count', ids.length && (kids.length || node.group) ? ids.length.toLocaleString('cs-CZ') : '');
    row.append(tw, eye, lab, cnt);
    li.appendChild(row);
    if (open && det.length) {
      const sub = el('ul', 'tree');
      for (const d of det) {
        const dli = el('li');
        const drow = el('div', 'tnode tdetail');
        drow.style.paddingLeft = `${4 + (depth + 1) * 14}px`;
        const b = el('button', 'tlabel');
        b.type = 'button';
        b.append(el('span', 'tname', d.value), el('span', 'tcls', d.label));
        if (d.select != null) b.addEventListener('click', () => select(d.select, { keepPanel: true }));
        else if (d.inspect != null) b.addEventListener('click', () => inspect(d.inspect, 'tree'));
        else b.disabled = true;
        drow.append(el('span'), el('span'), b, el('span'));
        dli.appendChild(drow);
        sub.appendChild(dli);
      }
      li.appendChild(sub);
    }
    if (open && kids.length) {
      const sub = el('ul', 'tree');
      const lim = S.treeLimit.get(key) || TREE_PAGE;
      kids.slice(0, lim).forEach((k) => add(k, depth + 1, sub));
      if (kids.length > lim) {
        const more = el('button', 'link tmore', `Zobrazit dalších ${Math.min(TREE_PAGE, kids.length - lim)} z ${kids.length - lim}`);
        more.type = 'button';
        more.style.marginLeft = `${18 + (depth + 1) * 14}px`;
        more.addEventListener('click', () => { S.treeLimit.set(key, lim + TREE_PAGE); renderTree(); });
        const mli = el('li'); mli.appendChild(more); sub.appendChild(mli);
      }
      li.appendChild(sub);
    }
    parentUl.appendChild(li);
  };
  // project / site / building open by default
  if (!S.treeOpen.size) {
    const openDown = (n, d) => { if (d > 2) return; S.treeOpen.add(nodeKey(n)); treeChildren(n).forEach((c) => { if (SPATIAL.has(U(c.type))) openDown(c, d + 1); }); };
    openDown(S.tree, 0);
    S.treeOpen.add('__init');
  }
  add(S.tree, 0, ul);
  root.appendChild(ul);
  if (!S.rel || S.rel.gen !== S.modelGen) ensureRelIdx().then(() => { if (!$('#panel-tree').hidden) renderTree(); }).catch(() => {});
  if (reveal) {
    const sel = root.querySelector('.tnode.is-sel');
    // jen uvnitř panelu (scrollIntoView by posunul i stránku)
    if (sel) root.scrollTop += sel.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight / 2 + sel.offsetHeight / 2;
    else root.scrollTop = scroll;
  } else root.scrollTop = scroll;
}


/* =====================================================================
   VYHLEDÁVÁNÍ A FILTR
   ===================================================================== */
const OPS = [
  ['eq', '='], ['ne', '≠'], ['has', 'obsahuje'], ['start', 'začíná na'],
  ['gt', '>'], ['lt', '<'], ['set', 'je vyplněno'], ['unset', 'není vyplněno'],
];
const numOf = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/\s/g, '').replace(',', '.').match(/^[-+]?\d*\.?\d+(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : NaN;
};
function condMatch(c, v) {
  const empty = v == null || v === '';
  if (c.op === 'set') return !empty;
  if (c.op === 'unset') return empty;
  if (empty) return c.op === 'ne';
  const a = deacc(fmtVal(v)), b = deacc(c.value);
  switch (c.op) {
    case 'eq': { const x = numOf(v), y = numOf(c.value); return (typeof v === 'number' && !isNaN(y)) ? Math.abs(x - y) < 1e-9 : a === b; }
    case 'ne': { const x = numOf(v), y = numOf(c.value); return (typeof v === 'number' && !isNaN(y)) ? Math.abs(x - y) >= 1e-9 : a !== b; }
    case 'has': return a.includes(b);
    case 'start': return a.startsWith(b);
    case 'gt': { const x = numOf(v), y = numOf(c.value); return !isNaN(x) && !isNaN(y) && x > y; }
    case 'lt': { const x = numOf(v), y = numOf(c.value); return !isNaN(x) && !isNaN(y) && x < y; }
    default: return true;
  }
}
function attrText(r, rec) {
  if (r.atext == null) r.atext = deacc(`${Object.values(r.a).join(' | ')} | ${classLabel(rec.cls)}`);
  return r.atext;
}
function tokenHit(r, rec, t) {
  if (attrText(r, rec).includes(t)) return true;
  for (const s of r.sets) if (s.text.includes(t)) return true;
  for (const s of r.tsets) if (s.text.includes(t)) return true;
  return false;
}
/* krátká ukázka, kde se hledaný text našel */
function hitSnippet(r, t) {
  if (!t) return '';
  for (const k of ['Tag', 'Typ', 'Materiál', 'ObjectType', 'Description', 'GlobalId', 'Podlaží']) {
    if (r.a[k] && deacc(r.a[k]).includes(t)) return `${ATTR_LABEL[k] || k}: ${r.a[k]}`;
  }
  for (const s of [...r.sets, ...r.tsets]) {
    for (const [k, v] of s.props) if (deacc(fmtVal(v)).includes(t)) return `${k.slice(k.indexOf('.') + 1)}: ${fmtVal(v)}`;
  }
  return '';
}
function runSearch() {
  const st = S.search;
  const tokens = deacc(st.q.trim()).split(/\s+/).filter(Boolean);
  const conds = st.conds.filter((c) => c.key && (c.op === 'set' || c.op === 'unset' || String(c.value).trim() !== ''));
  st.active = !!(tokens.length || conds.length);
  st.results = [];
  if (!st.active || !S.idx?.ready) return;
  for (const [id, rec] of S.elements) {
    const r = S.idx.el.get(id);
    if (!r) continue;
    if (tokens.length && !tokens.every((t) => tokenHit(r, rec, t))) continue;
    if (conds.length && !conds.every((c) => condMatch(c, getProp(r, c.key)))) continue;
    st.results.push(id);
  }
  st.tokens = tokens;
}
function revealAndSelect(id) {
  const rec = S.elements.get(id);
  if (!rec) return;
  if (S.hidden.has(id)) S.hidden.delete(id);
  if (S.isolated && !S.isolated.has(id)) S.isolated = null;
  const c = S.classes.get(rec.cls);
  if (c && !c.visible && !S.isolated) c.visible = true;
  const st = S.storeys.find((s0) => s0.id === rec.storey);
  if (st && !st.visible && !S.isolated) st.visible = true;
  applyVisibility();
  select(id, { keepPanel: true });
  focusSelected();
}
function fitToIds(ids) {
  const meshes = [];
  for (const id of ids) { const rec = S.elements.get(id); if (rec) meshes.push(...rec.meshes); }
  if (!meshes.length) return;
  const b = boxOf(meshes);
  const c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = r / Math.sin(Math.min(fov, fov * camera.aspect) / 2) * 1.05;
  const dir = camera.position.clone().sub(controls.target).normalize();
  tween(c.clone().add(dir.multiplyScalar(dist)), c, true);
}

let searchTimer = 0;
function renderSearchPanel() {
  const root = $('#panel-search');
  if (!S.search) S.search = { q: '', conds: [], results: [], limit: 150, active: false, tokens: [] };
  const st = S.search;
  root.replaceChildren();
  if (S.modelID == null) { root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor tlačítkem nahoře.')); return; }
  const box = el('div', 'search-box');
  const inp = el('input', 'search-input');
  inp.type = 'search'; inp.id = 'search-q'; inp.placeholder = 'Číslo místnosti, název, GlobalId, hodnota…';
  inp.setAttribute('aria-label', 'Hledat v modelu');
  inp.autocomplete = 'off'; inp.spellcheck = false;
  inp.value = st.q;
  inp.addEventListener('input', () => {
    st.q = inp.value; st.limit = 150;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { runSearch(); renderSearchResults(); }, 180);
  });
  box.appendChild(inp);
  root.appendChild(box);

  if (!S.idx?.ready) {
    root.appendChild(el('p', 'muted pad idx-progress', 'Připravuji index vlastností…'));
    ensureIndex().catch(() => {});
    return;
  }
  // podmínky
  const fl = el('div', 'flt-list');
  st.conds.forEach((c, i) => fl.appendChild(condRow(c, i)));
  root.appendChild(fl);
  const add = el('button', 'link flt-add', st.conds.length ? '+ Další podmínka' : '+ Filtr podle vlastnosti');
  add.type = 'button';
  add.addEventListener('click', () => { st.conds.push({ key: 'Třída', op: 'eq', value: '' }); renderSearchPanel(); });
  root.appendChild(add);
  const res = el('div', 'res');
  res.id = 'search-res';
  root.appendChild(res);
  runSearch();
  renderSearchResults();
}
function condRow(c, i) {
  const st = S.search;
  const row = el('div', 'flt-row');
  const ks = el('select', 'flt-key');
  ks.setAttribute('aria-label', 'Vlastnost');
  fillKeySelect(ks, c.key);
  const ops = el('select', 'flt-op');
  ops.setAttribute('aria-label', 'Podmínka');
  OPS.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; ops.appendChild(o); });
  ops.value = c.op;
  const vi = el('input', 'flt-val');
  vi.setAttribute('aria-label', 'Hodnota');
  vi.autocomplete = 'off'; vi.spellcheck = false;
  vi.value = c.value;
  vi.placeholder = 'hodnota';
  const dl = el('datalist');
  dl.id = `flt-dl-${i}`;
  vi.setAttribute('list', dl.id);
  const fillDl = () => {
    dl.replaceChildren();
    const info = S.idx.keys.get(c.key);
    if (!info) return;
    [...info.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).forEach(([v]) => { const o = el('option'); o.value = v; dl.appendChild(o); });
  };
  fillDl();
  const showVal = () => { vi.hidden = c.op === 'set' || c.op === 'unset'; };
  showVal();
  const rerun = () => { st.limit = 150; runSearch(); renderSearchResults(); };
  ks.addEventListener('change', () => { c.key = ks.value; c.value = ''; vi.value = ''; fillDl(); rerun(); });
  ops.addEventListener('change', () => { c.op = ops.value; showVal(); rerun(); });
  vi.addEventListener('input', () => { c.value = vi.value; clearTimeout(searchTimer); searchTimer = setTimeout(rerun, 200); });
  const rm = el('button', 'ib flt-rm');
  rm.type = 'button';
  rm.setAttribute('aria-label', 'Odebrat podmínku');
  rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  rm.addEventListener('click', () => { st.conds.splice(i, 1); renderSearchPanel(); });
  const line2 = el('div', 'flt-line');
  line2.append(ops, vi, rm);
  row.append(ks, line2, dl);
  return row;
}
function renderSearchResults() {
  const box = $('#search-res');
  if (!box) return;
  const st = S.search;
  box.replaceChildren();
  if (!st.active) {
    const help = el('div', 'search-help');
    help.append(
      el('p', null, 'Hledá v názvech, číslech místností, typech, materiálech, GlobalId i v hodnotách všech sad vlastností. Víc slov = musí platit všechna.'),
      el('p', 'muted', 'Filtrem vyberete prvky podle konkrétní vlastnosti, například FireRating = EI 30 nebo Plocha > 20.'),
    );
    box.appendChild(help);
    return;
  }
  const n = st.results.length;
  const head = el('div', 'res-head');
  head.appendChild(el('span', 'res-count', n ? `${n.toLocaleString('cs-CZ')} ${n === 1 ? 'prvek' : n < 5 ? 'prvky' : 'prvků'}` : 'Nic nenalezeno'));
  box.appendChild(head);
  if (!n) return;
  const acts = el('div', 'res-acts');
  const mk = (label, fn, primary) => { const b = el('button', 'sbtn' + (primary ? ' primary' : ''), label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  mk('Izolovat', () => { setColorOnly(null, true); S.isolated = new Set(st.results); applyVisibility(); renderModelPanel(); fitToIds(st.results); }, true);
  mk('Zvýraznit', () => colorBySearch());
  mk('Skrýt', () => { if (S.selected != null && st.results.includes(S.selected)) deselect(); st.results.forEach((id) => S.hidden.add(id)); if (S.isolated) st.results.forEach((id) => S.isolated.delete(id)); applyVisibility(); renderModelPanel(); });
  mk('Zrušit', () => { st.q = ''; st.conds = []; if (S.color?.mode === 'search') setColoring(null); showAll(); renderSearchPanel(); });
  box.appendChild(acts);

  // skupiny podle třídy
  const groups = new Map();
  for (const id of st.results) {
    const rec = S.elements.get(id);
    const g = classLabel(rec.cls);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(id);
  }
  const coll = new Intl.Collator('cs', { numeric: true });
  const nameOf = (id) => S.idx.el.get(id)?.a.Name || '';
  let shown = 0;
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [g, ids] of ordered) {
    if (shown >= st.limit) break;
    const sec = el('section', 'res-group');
    sec.appendChild(el('h3', 'group-title', `${g} · ${ids.length.toLocaleString('cs-CZ')}`));
    ids.sort((a, b) => coll.compare(nameOf(a), nameOf(b)));
    for (const id of ids) {
      if (shown >= st.limit) break;
      shown++;
      const r = S.idx.el.get(id);
      const rec = S.elements.get(id);
      const b = el('button', 'res-item' + (S.selected === id ? ' on' : ''));
      b.type = 'button';
      const nm = r.a.Name || r.a.LongName || prettyCls(rec.cls);
      const ln = r.a.LongName && r.a.LongName !== nm ? ` – ${r.a.LongName}` : '';
      b.appendChild(el('span', 'res-name', nm + ln));
      const sub = [r.a.Podlaží, hitSnippet(r, st.tokens?.[0])].filter(Boolean).join(' · ');
      if (sub) b.appendChild(el('span', 'res-sub', sub));
      b.addEventListener('click', () => { revealAndSelect(id); box.querySelectorAll('.res-item.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); });
      sec.appendChild(b);
    }
    box.appendChild(sec);
  }
  if (n > shown) {
    const more = el('button', 'link more', `Zobrazit další (${(n - shown).toLocaleString('cs-CZ')})`);
    more.type = 'button';
    more.addEventListener('click', () => { st.limit += 300; renderSearchResults(); });
    box.appendChild(more);
  }
}


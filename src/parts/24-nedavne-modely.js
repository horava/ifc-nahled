/* =====================================================================
   NEDÁVNÉ MODELY – otevřené IFC soubory uložené v zařízení (IndexedDB)
   ===================================================================== */
const RECENT_MAX = 8;
const SET_KEY = 'ifc-nahled-last-set';
const recentDb = {
  db: null,
  async open() {
    if (this.db !== null) return this.db;
    this.db = await new Promise((res) => {
      try {
        const rq = indexedDB.open('ifc-nahled-models', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('files', { keyPath: 'key' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(false);
      } catch (e) { res(false); }
    });
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    if (!db) throw new Error('Úložiště v zařízení není dostupné.');
    return new Promise((res, rej) => {
      const t = db.transaction('files', mode);
      const os = t.objectStore('files');
      let out;
      try { out = fn(os); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out?.result ?? out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Zápis do úložiště se nezdařil (možná je plné).'));
    });
  },
  all() { return this.run('readonly', (os) => os.getAll()); },
  get(key) { return this.run('readonly', (os) => os.get(key)); },
  put(rec) { return this.run('readwrite', (os) => os.put(rec)); },
  del(key) { return this.run('readwrite', (os) => os.delete(key)); },
};
const recentKey = (name, size) => `${name}|${size}`;
async function recentRefresh() {
  try {
    const all = await recentDb.all();
    S.recent = all.map(({ blob, buf, ...m }) => m).sort((a, b) => b.opened - a.opened);
  } catch (e) { S.recent = null; }
}
async function recentSave(blob, name, project) {
  if (!blob || /^ukazkovy-pavilon\.ifc$/i.test(name)) return null;
  const key = recentKey(name, blob.size);
  try {
    let rec = { key, name, size: blob.size, opened: Date.now(), project: project || '', blob };
    try { await recentDb.put(rec); } catch (e) {
      // starší Safari neumí uložit Blob → uložit obsah jako ArrayBuffer
      rec = { key, name, size: blob.size, opened: Date.now(), project: project || '', buf: await blob.arrayBuffer() };
      await recentDb.put(rec);
    }
    const all = (await recentDb.all()).sort((a, b) => b.opened - a.opened);
    for (const r of all.slice(RECENT_MAX)) await recentDb.del(r.key);
    try { navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn('recent', e);
    toast(`Model se nepodařilo uložit do zařízení: ${e?.message || e}`, true);
  }
  await recentRefresh();
  return key;
}
async function recentBlob(key) {
  const r = await recentDb.get(key);
  if (!r) throw new Error('Model už v zařízení není.');
  return { blob: r.blob || new Blob([r.buf]), name: r.name };
}
function saveLastSet() {
  try {
    const main = S.mainKey || null;
    localStorage.setItem(SET_KEY, JSON.stringify({ main, refs: (S.refs || []).map((R) => R.key).filter(Boolean) }));
  } catch (e) { /* ignore */ }
}
function lastSet() { try { return JSON.parse(localStorage.getItem(SET_KEY) || 'null'); } catch (e) { return null; } }
/* otevření hlavního modelu ze souboru nebo z nedávných */
async function openMainBlob(blob, name, key, opts = {}) {
  const head = await blob.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) {
    toast(/\.ifczip$/i.test(name) ? 'Soubory .ifczip zatím neumím. Rozbalte je na .ifc.' : 'Tohle nevypadá jako IFC soubor (STEP).', true);
    return false;
  }
  // nový model = nová sestava; podkladové modely zůstávají jen při přepnutí hlavního
  if (!opts.keepRefs) [...(S.refs || [])].forEach((R) => removeRef(R, true));
  $('#sample-badge').hidden = true;
  await loadIfc(blob, name);
  if (S.modelID == null || S.fileName !== name) return false;
  S.mainBlob = blob;
  S.mainKey = key || recentKey(name, blob.size);
  if (!key) recentSave(blob, name, S.meta?.projectName).then(() => { if (!$('#panel-model').hidden) renderModelPanel(); });
  else { recentDb.get(key).then((r) => { if (r) { r.opened = Date.now(); recentDb.put(r).then(recentRefresh); } }).catch(() => {}); }
  saveLastSet();
  if (S.bigChunks && blob.size > BIG_FILE) toast('Velký model: kvůli plynulosti se kreslí bez hran a se stínováním po ploškách.');
  return true;
}
async function openRecent(key, asRef) {
  try {
    const { blob, name } = await recentBlob(key);
    if (asRef) await addRefModel(blob, name, key);
    else await openMainBlob(blob, name, key);
  } catch (e) { toast(e?.message || String(e), true); }
}
async function restoreLastSet() {
  const st = lastSet();
  if (!st?.main) return;
  await openRecent(st.main, false);
  for (const k of st.refs || []) await openRecent(k, true);
}
const fmtMB = (b) => (b >= 1048576 ? `${nf.format(Math.round(b / 104857.6) / 10)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
function recentSection() {
  const sec = el('section', 'group');
  sec.appendChild(el('h3', 'group-title', 'Nedávné modely v zařízení'));
  if (S.recent == null) { sec.appendChild(el('p', 'muted small pad-x', 'Načítám…')); recentRefresh().then(() => renderModelPanel()); return sec; }
  if (!S.recent.length) { sec.appendChild(el('p', 'muted small pad-x', 'Otevřené modely se tu uloží, příště je otevřete jedním ťuknutím i bez internetu.')); return sec; }
  const st = lastSet();
  if (st?.refs?.length && st.main && S.recent.some((r) => r.key === st.main) && !(S.mainKey === st.main && (S.refs || []).length)) {
    const all = [st.main, ...st.refs].every((k) => S.recent.some((r) => r.key === k));
    if (all) {
      const b = el('button', 'sbtn primary rc-set', `Obnovit poslední sestavu (${st.refs.length + 1} modely)`);
      b.type = 'button';
      b.addEventListener('click', restoreLastSet);
      const w0 = el('div', 'pad-x rc-set-row'); w0.appendChild(b); sec.appendChild(w0);
    }
  }
  const list = el('div', 'rc-list');
  const LIM = S.recentAll ? 99 : 3;
  for (const r of S.recent.slice(0, LIM)) {
    const isMain = r.key === S.mainKey, isRef = (S.refs || []).some((R) => R.key === r.key);
    const row = el('div', 'rc-row' + (isMain || isRef ? ' on' : ''));
    const open = el('button', 'rc-open');
    open.type = 'button';
    open.disabled = isMain;
    open.title = isMain ? 'Otevřený hlavní model' : 'Otevřít jako hlavní model';
    open.append(el('span', 'row-label', r.name), el('span', 'row-sub', [r.project, new Date(r.opened).toLocaleDateString('cs-CZ'), fmtMB(r.size), isMain ? 'hlavní' : isRef ? 'podkladový' : ''].filter(Boolean).join(' · ')));
    open.addEventListener('click', () => openRecent(r.key, false));
    row.appendChild(open);
    if (S.modelID != null && !isMain && !isRef) {
      const add = el('button', 'sbtn mini-btn', '+ Přidat');
      add.type = 'button';
      add.title = 'Přidat k otevřenému modelu jako podkladový';
      add.addEventListener('click', () => openRecent(r.key, true));
      row.appendChild(add);
    }
    const rm = el('button', 'ib small-ib');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Smazat ze zařízení: ${r.name}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    rm.addEventListener('click', async () => { try { await recentDb.del(r.key); } catch (e) { /* ignore */ } await recentRefresh(); renderModelPanel(); });
    row.appendChild(rm);
    list.appendChild(row);
  }
  sec.appendChild(list);
  if (S.recent.length > LIM) {
    const more = el('button', 'link more', `Zobrazit všechny (${S.recent.length})`);
    more.type = 'button';
    more.addEventListener('click', () => { S.recentAll = true; renderModelPanel(); });
    sec.appendChild(more);
  }
  const total = S.recent.reduce((a, r) => a + (r.size || 0), 0);
  sec.appendChild(el('p', 'muted small pad-x', `V zařízení: ${S.recent.length} ${S.recent.length === 1 ? 'model' : S.recent.length < 5 ? 'modely' : 'modelů'}, ${fmtMB(total)}. Uchovává se posledních ${RECENT_MAX}.`));
  return sec;
}


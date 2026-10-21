/* ---------- panel switching ---------- */
const app = $('#app');
function showPanel(name) {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.panel-body').forEach((p0) => { p0.hidden = p0.id !== `panel-${name}`; });
  if (name === 'geo') renderGeo();
  if (name === 'tree') renderTree(true);
  if (name === 'search') { renderSearchPanel(); if (!matchMedia('(hover: none)').matches) setTimeout(() => $('#search-q')?.focus(), 30); }
  if (name === 'cmp') renderCmpPanel();
  if (name === 'data') renderDataPanel();
  if (name === 'model') renderModelPanel();
  // záložku posunout do viditelné části lišty (scrollIntoView by na telefonu posunul celou stránku)
  const tabEl = document.querySelector(`.tab[data-tab="${name}"]`), bar = tabEl?.parentElement;
  if (bar && bar.scrollWidth > bar.clientWidth) {
    const br = bar.getBoundingClientRect(), tr = tabEl.getBoundingClientRect();
    if (tr.left < br.left) bar.scrollLeft -= br.left - tr.left;
    else if (tr.right > br.right) bar.scrollLeft += tr.right - br.right;
  }
  setSheetOpen(true);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.tab)));
$('#btn-sheet').addEventListener('click', () => setSheetOpen(!app.classList.contains('sheet-open')));

/* ---------- spodní panel (telefon, tablet na výšku) ----------
   Tři výšky: proužek (záložky a začátek obsahu), půlka, celá výška. Za úchyt se táhne, ťuknutí přepíná.
   Část 3D pohledu pod panelem se nepočítá: střed kreslení se posune nad panel (setViewOffset),
   lišta, akce a hlášky se zvednou nad panel (--sheet-cover). */
const SHEET_MQ = matchMedia('(max-width: 719px), (orientation: portrait) and (max-width: 1100px)');
const SHEET_STATES = ['peek', 'half', 'full'];
const sheet = { state: 'half', cover: 0 };
try { const st = localStorage.getItem('ifc-nahled-sheet'); if (SHEET_STATES.includes(st)) sheet.state = st; } catch (e) { /* ignore */ }
const panelEl = $('.panel'), mainEl = $('.main');
const isSheet = () => SHEET_MQ.matches;
function sheetHeights() {
  const M = mainEl.clientHeight;
  return { peek: Math.round(Math.min(150, M * 0.4)), half: Math.round(M * 0.5), full: Math.max(Math.round(M - 8), 160) };
}
function setSheetOpen(open) {
  const was = app.classList.contains('sheet-open');
  app.classList.toggle('sheet-open', open);
  $('#btn-sheet').setAttribute('aria-expanded', String(open));
  if (was !== open) applySheet();
}
function applySheet() {
  if (isSheet()) app.style.setProperty('--sheet-h', `${sheetHeights()[sheet.state]}px`);
  else app.style.removeProperty('--sheet-h');
  followSheet();
}
/* jak vysoko panel zakrývá 3D pohled; při celé výšce se nepočítá (3D není vidět) */
function measureCover() {
  if (!isSheet() || !app.classList.contains('sheet-open')) return 0;
  const v = viewport.getBoundingClientRect(), p = panelEl.getBoundingClientRect();
  const c = Math.max(0, Math.min(v.bottom, p.bottom) - Math.max(v.top, p.top));
  return c > v.height * 0.62 ? 0 : Math.round(c);
}
function setCover(c) {
  if (c === sheet.cover) return;
  sheet.cover = c;
  app.style.setProperty('--sheet-cover', `${c}px`);
  updateViewOffset();
}
function updateViewOffset() {
  const w = viewport.clientWidth, h = viewport.clientHeight, c = sheet.cover;
  // posun obrazu bez změny měřítka: střed kreslení je uprostřed nezakryté části
  if (c > 0 && w && h) camera.setViewOffset(w, h, 0, c / 2, w, h); else camera.clearViewOffset();
  requestRender();
}
let followT = 0;
function followSheet(done) {
  // během animace panelu (0,25 s) sleduje jeho skutečnou polohu
  const id = ++followT, t0 = performance.now();
  const step = () => {
    if (id !== followT) return;
    setCover(measureCover());
    if (performance.now() - t0 < 320) requestAnimationFrame(step);
    else if (done) done();
  };
  requestAnimationFrame(step);
}
function setSheetState(st) {
  sheet.state = st;
  try { localStorage.setItem('ifc-nahled-sheet', st); } catch (e) { /* ignore */ }
  applySheet();
}
/* vybraný prvek zakrytý panelem posunout nad panel (bez změny vzdálenosti) */
function ensureSelVisible() {
  if (!sheet.cover || S.selected == null) return;
  const rec = S.elements.get(S.selected);
  if (!rec || !rec.meshes.length) return;
  const c = boxOf(rec.meshes).getCenter(new THREE.Vector3());
  const p = c.clone().project(camera);
  const h = viewport.clientHeight, y = (1 - p.y) / 2 * h;
  if (p.z > 1 || y < h - sheet.cover - 24) return;
  const off = camera.position.clone().sub(controls.target);
  undoMute = true; // automatický posun není krok pro Zpět
  try { tween(c.clone().add(off), c, true); } finally { undoMute = false; }
}
panelEl.addEventListener('transitionend', (e) => { if (e.target === panelEl) setCover(measureCover()); });
const grabEl = $('#sheet-grab');
grabEl.addEventListener('pointerdown', (e) => {
  if (!isSheet()) return;
  e.preventDefault();
  grabEl.setPointerCapture(e.pointerId);
  const H = sheetHeights(), h0 = panelEl.getBoundingClientRect().height, y0 = e.clientY;
  const trail = [{ y: e.clientY, t: e.timeStamp }];
  let moved = false;
  app.classList.add('sheet-drag');
  const move = (ev) => {
    const dy = ev.clientY - y0;
    if (Math.abs(dy) > 5) moved = true;
    if (!moved) return;
    app.style.setProperty('--sheet-h', `${Math.round(Math.min(H.full, Math.max(56, h0 - dy)))}px`);
    trail.push({ y: ev.clientY, t: ev.timeStamp });
    if (trail.length > 6) trail.shift();
    setCover(measureCover());
  };
  const up = (ev) => {
    grabEl.removeEventListener('pointermove', move);
    grabEl.removeEventListener('pointerup', up);
    grabEl.removeEventListener('pointercancel', up);
    app.classList.remove('sheet-drag');
    if (!moved) { setSheetState(SHEET_STATES[(SHEET_STATES.indexOf(sheet.state) + 1) % 3]); return; }
    const a = trail[0], b = trail[trail.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px/ms, kladná = dolů
    const h = h0 - (ev.clientY - y0) - v * 180;
    if (h < H.peek * 0.6) { setSheetOpen(false); app.style.setProperty('--sheet-h', `${H[sheet.state]}px`); return; }
    const st = SHEET_STATES.reduce((best, k) => (Math.abs(H[k] - h) < Math.abs(H[best] - h) ? k : best), 'peek');
    setSheetState(st);
    followSheet(ensureSelVisible);
  };
  grabEl.addEventListener('pointermove', move);
  grabEl.addEventListener('pointerup', up);
  grabEl.addEventListener('pointercancel', up);
});
grabEl.addEventListener('keydown', (e) => {
  const i = SHEET_STATES.indexOf(sheet.state);
  if (e.key === 'ArrowUp' && i < 2) { e.preventDefault(); setSheetState(SHEET_STATES[i + 1]); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (i > 0) setSheetState(SHEET_STATES[i - 1]); else setSheetOpen(false); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheetState(SHEET_STATES[(i + 1) % 3]); }
});
try { SHEET_MQ.addEventListener('change', applySheet); } catch (e) { SHEET_MQ.addListener?.(applySheet); }
new ResizeObserver(() => { if (isSheet()) applySheet(); }).observe(mainEl);

/* ---------- loading UI ---------- */
function showLoading(title) { $('#loading-title').textContent = title; $('#loading-step').textContent = 'Připravuji…'; $('#loading').hidden = false; }
function setLoadingStep(t) { $('#loading-step').textContent = t; }
function hideLoading() { $('#loading').hidden = true; }
let toastTimer;
/* nápověda, která se ukáže jen prvních pár použití (počítadlo v zařízení) */
function hint(key, msg, times = 3) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem('ifc-nahled-hints') || '{}') || {}; } catch (e) { /* ignore */ }
  if ((seen[key] || 0) >= times) return;
  seen[key] = (seen[key] || 0) + 1;
  try { localStorage.setItem('ifc-nahled-hints', JSON.stringify(seen)); } catch (e) { /* ignore */ }
  toast(msg);
}
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-error', !!isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3200);
}

/* ---------- file input & drop ---------- */
async function openFile(file) {
  if (!file) return;
  const head = await file.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) {
    toast(/\.ifczip$/i.test(file.name) ? 'Soubory .ifczip zatím neumím. Rozbalte je na .ifc.' : 'Tohle nevypadá jako IFC soubor (STEP).', true);
    return;
  }
  await openMainBlob(file, file.name);
}
$('#file-input').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
/* přetažení souboru z počítače. Na iPadu se táhnou i odkazy a obrázky z aplikace
   (dlouhé podržení) – ty ignorujeme, jinak by překryvná vrstva zůstala viset přes celou obrazovku. */
const dropEl = $('#drop');
let dropTimer = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
function hideDrop() { dropEl.hidden = true; clearTimeout(dropTimer); }
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dropEl.hidden = false;
  clearTimeout(dropTimer);
  dropTimer = setTimeout(hideDrop, 1500); // pojistka, když prohlížeč nepošle dragleave
}));
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideDrop(); });
document.addEventListener('dragend', hideDrop);
document.addEventListener('drop', (e) => {
  hideDrop();
  if (!isFileDrag(e)) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.(bcfzip|bcf|zip)$/i.test(f.name)) bcfImport(f); else openFile(f);
});
dropEl.addEventListener('pointerdown', hideDrop);
// odkazy a obrázky v rozhraní se nemají tahat
document.addEventListener('dragstart', (e) => { if (e.target?.closest?.('#app, .modal')) e.preventDefault(); });

/* nečekaná chyba: ukázat ji místo tichého zamrznutí (pomůže s laděním na iPadu) */
window.addEventListener('error', (e) => { try { toast(`Chyba: ${e.message || e.error || 'neznámá'}`, true); } catch (_) { /* ignore */ } });
window.addEventListener('unhandledrejection', (e) => { try { toast(`Chyba: ${e.reason?.message || e.reason || 'neznámá'}`, true); } catch (_) { /* ignore */ } });


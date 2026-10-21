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
  document.querySelector(`.tab[data-tab="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  app.classList.add('sheet-open');
  $('#btn-sheet').setAttribute('aria-expanded', 'true');
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.tab)));
$('#btn-sheet').addEventListener('click', () => {
  const open = !app.classList.contains('sheet-open');
  app.classList.toggle('sheet-open', open);
  $('#btn-sheet').setAttribute('aria-expanded', String(open));
});

/* ---------- loading UI ---------- */
function showLoading(title) { $('#loading-title').textContent = title; $('#loading-step').textContent = 'Připravuji…'; $('#loading').hidden = false; }
function setLoadingStep(t) { $('#loading-step').textContent = t; }
function hideLoading() { $('#loading').hidden = true; }
let toastTimer;
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


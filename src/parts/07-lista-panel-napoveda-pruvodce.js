/* ---------- toolbar ---------- */
function anyFilterOn() {
  return !!(S.hidden.size || S.isolated || [...S.classes.entries()].some(([k, c]) => !c.visible && !HIDDEN_BY_DEFAULT.has(U(k))) || S.storeys.some((s) => !s.visible));
}
function updateToolbar() {
  const has = S.selected != null;
  const filt = anyFilterOn();
  const canUndo = undoStack.length > 0;
  $('#btn-hide').hidden = !has;
  $('#btn-isolate').hidden = !has;
  $('#btn-focus').hidden = !has;
  $('#btn-desel').hidden = !has;
  $('#btn-showall').hidden = !filt;
  $('#btn-undo').disabled = !canUndo;
  // při měření, odečítání souřadnic a nastavování řezu mají přednost jejich panely
  $('#actbar').hidden = !(has || filt) || S.measure.on || coord.on || (S.clipOn && S.clipPanel);
  $('#btn-clip').setAttribute('aria-pressed', String(S.clipOn));
  $('#btn-measure').setAttribute('aria-pressed', String(S.measure.on));
  $('#btn-edges').setAttribute('aria-pressed', String(S.edges));
}
/* Celý: celý model ze současného směru; shora / zespodu nebo při druhém stisku z výchozího 3D pohledu */
let fitSnap = null;
$('#btn-fit').addEventListener('click', () => {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const tol = Math.max(camera.position.distanceTo(controls.target) * 0.002, 1e-4);
  const again = fitSnap && camera.position.distanceTo(fitSnap.pos) < tol && controls.target.distanceTo(fitSnap.target) < tol;
  const steep = Math.abs(dir.y) > 0.97 || dir.y < -0.05;
  fitSnap = fitView(again || steep ? 'iso' : 'keep');
});
$('#btn-top').addEventListener('click', () => fitView('top'));
$('#btn-clip').addEventListener('click', () => toggleClip());
$('#btn-measure').addEventListener('click', () => toggleMeasure());
$('#btn-orbit').addEventListener('click', () => setOrbitMode(ORBIT_MODES[(ORBIT_MODES.indexOf(S.orbitMode) + 1) % ORBIT_MODES.length]));
orbitUi();
$('#btn-edges').addEventListener('click', () => {
  S.edges = !S.edges;
  modelGroup.traverse((o) => { if (o.userData.edge) o.visible = S.edges; });
  ghostGroup.children.forEach((o) => { if (o.userData.ghostEdges) o.visible = S.edges; });
  updateToolbar(); requestRender();
});
$('#btn-hide').addEventListener('click', () => {
  if (S.selected == null) return;
  const id = S.selected;
  deselect(false);
  if (S.isolated) S.isolated.delete(id);
  S.hidden.add(id);
  applyVisibility(); renderProps(); renderModelPanel();
});
$('#btn-isolate').addEventListener('click', () => {
  if (S.selected == null) return;
  S.isolated = new Set([S.selected]);
  applyVisibility(); renderModelPanel();
  focusSelected();
});
$('#btn-focus').addEventListener('click', focusSelected);
$('#btn-showall').addEventListener('click', showAll);
$('#btn-desel').addEventListener('click', () => deselect());
$('#btn-undo').addEventListener('click', undo);
function showAll() {
  S.hidden.clear(); S.isolated = null;
  if (S.color) { S.color.only = null; renderLegend(); }
  cmpGroup.visible = true;
  S.storeys.forEach((s) => { s.visible = true; });
  S.classes.forEach((c, k) => { c.visible = !HIDDEN_BY_DEFAULT.has(U(k)); });
  applyVisibility(); renderModelPanel();
}

/* Více: když se lišta nevejde (telefon, iPad na výšku, půdorys vedle), méně používané nástroje jdou do vyskakovací řady */
const toolbarEl = $('.toolbar'), morePop = $('#more-pop'), moreBtn = $('#btn-more');
const optTools = [...toolbarEl.querySelectorAll('.tool.opt')].map((b) => {
  const slot = document.createComment('slot');
  b.before(slot);
  return { b, slot };
});
function setMoreOpen(open) {
  morePop.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
}
function layoutToolbar() {
  setMoreOpen(false);
  optTools.forEach(({ b, slot }) => { if (b.parentElement !== toolbarEl) slot.after(b); });
  moreBtn.hidden = true;
  if (toolbarEl.scrollWidth <= toolbarEl.clientWidth + 1) return;
  optTools.forEach(({ b }) => morePop.appendChild(b));
  moreBtn.hidden = false;
}
moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setMoreOpen(morePop.hidden); });
morePop.addEventListener('click', (e) => { if (e.target.closest('.tool')) setTimeout(() => setMoreOpen(false), 120); });
document.addEventListener('pointerdown', (e) => { if (!morePop.hidden && !e.target.closest('#more-pop, #btn-more')) setMoreOpen(false); });
new ResizeObserver(() => layoutToolbar()).observe($('#pane3d'));
document.fonts?.ready?.then(layoutToolbar);

/* ---------- Zpět: skrytí, izolace, filtry podlaží a kategorií, řez a skoky kamery ---------- */
let undoMute = false, visKey = null, visState = null;
function visSnapshot() {
  return {
    hidden: [...S.hidden], isolated: S.isolated ? [...S.isolated] : null,
    storeys: S.storeys.map((s) => [s.id, s.visible]), classes: [...S.classes].map(([k, c]) => [k, c.visible]),
  };
}
function pushUndo(part) {
  if (undoMute || S.loading) return;
  const now = performance.now();
  const top = undoStack[undoStack.length - 1];
  // jedna akce = jeden krok (izolace mění viditelnost i kameru)
  if (top && now - top.t < 120) { for (const k of Object.keys(part)) if (!(k in top)) top[k] = part[k]; }
  else { undoStack.push({ t: now, ...part }); if (undoStack.length > 40) undoStack.shift(); }
  updateToolbar();
}
/* volá se z applyVisibility: když se viditelnost změnila, uloží předchozí stav */
function trackVis() {
  if (undoMute || S.loading) return;
  const v = visSnapshot(), k = JSON.stringify(v);
  if (visKey != null && k !== visKey) pushUndo({ vis: visState });
  visKey = k; visState = v;
}
function trackCam() {
  pushUndo({ cam: { pos: camera.position.clone(), target: controls.target.clone() } });
}
function trackClip(wasOn) { if (wasOn !== S.clipOn) pushUndo({ clip: wasOn }); }
function resetUndo() {
  undoStack.length = 0;
  visState = visSnapshot(); visKey = JSON.stringify(visState);
  updateToolbar();
}
function undo() {
  const e = undoStack.pop();
  if (!e) return;
  undoMute = true;
  try {
    if (e.vis) {
      const v = e.vis;
      S.hidden.clear(); v.hidden.forEach((id) => S.hidden.add(id));
      S.isolated = v.isolated ? new Set(v.isolated) : null;
      const sm = new Map(v.storeys), cm = new Map(v.classes);
      S.storeys.forEach((s) => { if (sm.has(s.id)) s.visible = sm.get(s.id); });
      S.classes.forEach((c, k) => { if (cm.has(k)) c.visible = cm.get(k); });
      if (S.selected != null && !isVisible(S.selected, S.elements.get(S.selected))) deselect(false);
      applyVisibility(); renderModelPanel(); renderProps();
      visState = visSnapshot(); visKey = JSON.stringify(visState);
    }
    if ('clip' in e) toggleClip(e.clip);
    if (e.cam) tween(e.cam.pos, e.cam.target, true);
  } finally { undoMute = false; }
  updateToolbar();
}
document.addEventListener('keydown', (e) => {
  if (!(e.key === 'z' || e.key === 'Z') || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  undo();
});

/* ---------- panel: model ---------- */
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/></svg>';

function rowList(title, items, onToggle, onOnly, onName) {
  const sec = el('section', 'group');
  const h = el('h3', 'group-title', title);
  sec.appendChild(h);
  const ul = el('ul', 'rows');
  items.forEach((it) => {
    const li = el('li', 'row' + (it.visible ? '' : ' is-off'));
    const vis = el('button', 'eye');
    vis.type = 'button';
    vis.innerHTML = it.visible ? EYE : EYE_OFF;
    vis.setAttribute('aria-label', `${it.visible ? 'Skrýt' : 'Zobrazit'}: ${it.label}`);
    vis.addEventListener('click', () => onToggle(it));
    const name = el(onName && it.id !== -1 ? 'button' : 'span', 'row-name' + (onName && it.id !== -1 ? ' row-link' : ''));
    if (onName && it.id !== -1) { name.type = 'button'; name.title = 'Zobrazit vlastnosti'; name.addEventListener('click', () => onName(it)); }
    name.appendChild(el('span', 'row-label', it.label));
    if (it.sub) name.appendChild(el('span', 'row-sub', it.sub));
    const count = el('span', 'row-count', it.count.toLocaleString('cs-CZ'));
    const only = el('button', 'only', 'Jen toto');
    only.type = 'button';
    only.addEventListener('click', () => onOnly(it));
    li.append(vis, name, count, only);
    ul.appendChild(li);
  });
  sec.appendChild(ul);
  return sec;
}

/* ---------- návod (otazník v horní liště), O aplikaci a licence ---------- */
function aboutLink() {
  const b = el('button', 'link about-link', 'O aplikaci a licence');
  b.type = 'button';
  b.addEventListener('click', openAbout);
  return b;
}
let helpSec = 'start';
function showHelpSec(sec) {
  if (!document.querySelector(`#help-body > section[data-sec="${sec}"]`)) sec = 'start';
  helpSec = sec;
  document.querySelectorAll('#help-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.sec === sec)));
  document.querySelectorAll('#help-body > section').forEach((x) => { x.hidden = x.dataset.sec !== sec; });
  $('#help-body').scrollTop = 0;
  const nb = document.querySelector(`#help-nav button[data-sec="${sec}"]`);
  if (nb && !$('#help-modal').hidden) nb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (sec === 'licenses') {
    $('#lic-text').hidden = true;
    document.querySelectorAll('.lic').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  }
}
// verze = číslo vydání (stejné jako VERSION v sw.js), zapsané do app.js při sestavení
const APP_VERSION = __VERSION__, APP_BUILD = __BUILD__;
async function appVersionText() { return `verze ${APP_VERSION} (sestavení ${APP_BUILD})`; }
$('#app-ver').textContent = `v${APP_VERSION}`;
$('#app-ver').addEventListener('click', () => openAbout());
function openHelp(sec = helpSec) {
  appVersionText().then((t) => { $('#about-version').textContent = t; });
  $('#help-modal').hidden = false;
  showHelpSec(sec);
  $('#help-body').focus({ preventScroll: true });
}
function closeHelp() { $('#help-modal').hidden = true; }
function openAbout() { openHelp('about'); }
$('#btn-help').addEventListener('click', () => openHelp());
$('#help-close').addEventListener('click', closeHelp);
$('#help-modal').addEventListener('click', (e) => { if (e.target.id === 'help-modal') closeHelp(); });
$('#help-nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sec]');
  if (b) showHelpSec(b.dataset.sec);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#help-modal').hidden) closeHelp();
});
$('#help-tour').addEventListener('click', () => { closeHelp(); startTour(); });

/* ---------- průvodce při prvním spuštění ---------- */
const TOUR_KEY = 'ifc-nahled-tour';
const TOUR = [
  { title: 'Vítej v IFC prohlížečce',
    html: '<p>Prohlížeč BIM modelů ve formátu IFC. Modely se zpracují přímo v tomto zařízení a nikam se neodesílají.</p><p>Během minuty ti ukážu to nejdůležitější. Otevřený je ukázkový pavilon, na kterém si můžeš všechno vyzkoušet.</p>',
    next: 'Projít průvodce' },
  { target: 'label[for="file-input"]', title: 'Otevři vlastní model',
    html: '<p>Tlačítko nabídne soubory IFC ze Souborů, iCloudu, OneDrivu a dalších úložišť. Na počítači můžeš soubor i přetáhnout do okna.</p><p>Otevřené modely se ukládají do zařízení, příště je najdeš v panelu Model v části Nedávné modely.</p>' },
  { target: '#viewport', pad: -10, title: 'Ovládání 3D pohledu',
    html: '<ul><li><b>Jeden prst</b> otáčí, <b>dva prsty</b> posouvají a přibližují.</li><li><b>Ťuknutí</b> vybere prvek, další ťuknutí na stejné místo vybere prvek pod ním.</li><li><b>Dvojité ťuknutí</b> nastaví střed otáčení.</li><li>Myš: levé tlačítko otáčí, pravé posouvá, kolečko přibližuje.</li></ul>' },
  { target: '.toolbar', title: 'Nástroje',
    html: '<p><b>Zpět</b> vrátí poslední krok, <b>Celý</b> ukáže celý model (druhým stiskem z výchozího 3D pohledu), dále <b>Řez</b>, <b>Měřit</b> s přichytáváním k lomovým bodům a <b>Půdorys</b> podlaží. Co se nevejde, je pod <b>Více</b>.</p><p>Po výběru prvku se nad lištou objeví <b>Zaměřit</b>, <b>Skrýt</b> a <b>Izolovat</b>, po skrytí <b>Vše</b>.</p>' },
  { target: '.panel .tabs', title: 'Panel s informacemi',
    html: '<ul><li><b>Model</b>: podlaží, místnosti, barvení, další modely a exporty</li><li><b>Strom</b> a <b>Hledat</b>: struktura a vyhledávání ve vlastnostech</li><li><b>Vlastnosti</b> vybraného prvku</li><li><b>BCF</b> záznamy, <b>Geo</b> georeference a <b>Data</b> s mapovými podklady</li></ul>' },
  { target: '#btn-sheet', title: 'Skrytí panelu',
    html: '<p>Tímto tlačítkem panel schováš nebo zase ukážeš. Na telefonu a na iPadu na výšku vyjíždí zespodu: za proužek nahoře ho povytáhneš, zmenšíš nebo stáhneš dolů.</p><p>Vedle je přepínač světlého a tmavého režimu.</p>' },
  { target: '#btn-help', title: 'Návod je vždy po ruce',
    html: '<p>Pod otazníkem je podrobný návod ke všem funkcím, informace o aplikaci a licence. Odtud můžeš tohoto průvodce spustit znovu.</p>',
    next: 'Začít' },
];
let tourI = -1;
function startTour() {
  tourI = 0;
  $('#tour').hidden = false;
  renderTour();
}
function endTour() {
  tourI = -1;
  $('#tour').hidden = true;
  try { localStorage.setItem(TOUR_KEY, 'done'); } catch (e) { /* ignore */ }
}
function renderTour() {
  const st = TOUR[tourI];
  const last = tourI === TOUR.length - 1;
  $('#tour-step').textContent = `${tourI + 1} / ${TOUR.length}`;
  $('#tour-title').textContent = st.title;
  $('#tour-text').innerHTML = st.html;
  $('#tour-back').hidden = tourI === 0;
  $('#tour-skip').hidden = last;
  $('#tour-next').textContent = st.next || (last ? 'Hotovo' : 'Další');
  placeTour();
  requestAnimationFrame(placeTour);
  $('#tour-next').focus({ preventScroll: true });
}
function placeTour() {
  if (tourI < 0) return;
  const st = TOUR[tourI];
  const tour = $('#tour'), card = $('#tour-card'), spot = $('#tour-spot');
  const vw = window.innerWidth, vh = window.innerHeight, m = 12;
  const tEl = st.target ? document.querySelector(st.target) : null;
  const r = tEl ? tEl.getBoundingClientRect() : null;
  const visible = r && r.width > 4 && r.height > 4 && r.top < vh && r.bottom > 0 && getComputedStyle(tEl).visibility !== 'hidden';
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let x, y;
  if (!visible) {
    spot.hidden = true;
    tour.classList.add('no-spot');
    x = (vw - cw) / 2; y = (vh - ch) / 2;
  } else {
    tour.classList.remove('no-spot');
    spot.hidden = false;
    const p = st.pad ?? 6;
    const L = Math.max(4, r.left - p), T = Math.max(4, r.top - p);
    const R = Math.min(vw - 4, r.right + p), B = Math.min(vh - 4, r.bottom + p);
    Object.assign(spot.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    const cx = r.left + r.width / 2 - cw / 2, cy = r.top + r.height / 2 - ch / 2;
    if (B + m + ch <= vh - m) { x = cx; y = B + m; }
    else if (T - m - ch >= m) { x = cx; y = T - m - ch; }
    else if (R + m + cw <= vw - m) { x = R + m; y = cy; }
    else if (L - m - cw >= m) { x = L - m - cw; y = cy; }
    else { x = cx; y = Math.min(B - ch - 24, vh - ch - m); } // velký cíl (3D pohled): karta uvnitř dole
  }
  card.style.left = `${Math.round(Math.min(Math.max(m, x), vw - cw - m))}px`;
  card.style.top = `${Math.round(Math.min(Math.max(m, y), vh - ch - m))}px`;
}
$('#tour-next').addEventListener('click', () => {
  if (tourI >= TOUR.length - 1) endTour();
  else { tourI++; renderTour(); }
});
$('#tour-back').addEventListener('click', () => { if (tourI > 0) { tourI--; renderTour(); } });
$('#tour-skip').addEventListener('click', endTour);
window.addEventListener('resize', () => requestAnimationFrame(placeTour));
document.addEventListener('keydown', (e) => {
  if (tourI < 0) return;
  if (e.key === 'Escape') { e.preventDefault(); endTour(); }
  else if (e.key === 'ArrowRight') $('#tour-next').click();
  else if (e.key === 'ArrowLeft' && tourI > 0) $('#tour-back').click();
});
function maybeStartTour() {
  let done = false;
  try { done = localStorage.getItem(TOUR_KEY) === 'done'; } catch (e) { done = true; }
  if (done || tourI >= 0 || !$('#help-modal').hidden) return;
  setTimeout(() => { if (tourI < 0 && $('#help-modal').hidden) startTour(); }, 500);
}
document.querySelectorAll('.lic').forEach((b) => b.addEventListener('click', async () => {
  const pre = $('#lic-text');
  document.querySelectorAll('.lic').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  pre.hidden = false;
  pre.textContent = 'Načítám…';
  try {
    const r = await fetch(b.dataset.file);
    if (!r.ok) throw new Error(String(r.status));
    pre.textContent = await r.text();
  } catch (e) {
    pre.textContent = 'Text licence se nepodařilo načíst. Najdete ho v repozitáři aplikace ve složce licenses/.';
  }
  pre.scrollTop = 0;
}));
function renderModelPanel() {
  const root = $('#panel-model');
  root.replaceChildren();
  if (S.modelID == null) {
    root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor tlačítkem nahoře.'));
    root.appendChild(recentSection());
    root.appendChild(aboutLink());
    return;
  }
  const summary = el('div', 'summary');
  const proj = el('div', 'summary-title', S.meta.projectName || S.fileName);
  const facts = el('dl', 'facts');
  const fact = (k, v) => { facts.append(el('dt', null, k), el('dd', null, v)); };
  fact('Schéma', S.meta.schema || '—');
  fact('Prvků s geometrií', S.elements.size.toLocaleString('cs-CZ'));
  fact('Podlaží', String(S.storeys.filter((s) => s.id !== -1).length));
  summary.append(proj, facts);
  const spaceCls = [...S.classes.entries()].find(([k]) => U(k) === 'IFCSPACE');
  if (spaceCls) {
    const [, c] = spaceCls;
    const sb = el('button', 'sbtn space-toggle' + (c.visible ? ' on' : ''), c.visible ? `Skrýt místnosti (${c.count})` : `Zobrazit místnosti (${c.count})`);
    sb.type = 'button';
    sb.setAttribute('aria-pressed', String(c.visible));
    sb.addEventListener('click', () => { c.visible = !c.visible; S.isolated = null; applyVisibility(); renderModelPanel(); });
    const xb = el('button', 'sbtn', 'Místnosti do Excelu');
    xb.type = 'button';
    xb.title = 'Tabulka všech místností: plocha, výška, objem, souřadnice a všechny vlastnosti';
    xb.addEventListener('click', () => exportRoomsXlsx(null).catch((e) => toast(`Export se nepodařil: ${e?.message || e}`, true)));
    const row2 = el('div', 'btn-row');
    row2.append(sb, xb);
    summary.appendChild(row2);
  }
  const cb = el('label', 'sbtn cmp-start', S.cmp ? `Porovnáno se: ${S.cmp.oldName}` : 'Porovnat se starší verzí…');
  cb.htmlFor = 'cmp-input';
  cb.title = 'Vyberte starší verzi téhož modelu. Zobrazí se přidané, změněné a odebrané prvky.';
  summary.appendChild(cb);
  root.appendChild(summary);

  if (S.isolated || S.hidden.size) {
    const note = el('div', 'notice');
    note.append(el('span', null, S.isolated ? (S.isolated.size === 1 ? 'Zobrazen jen izolovaný prvek.' : `Zobrazeno jen ${S.isolated.size.toLocaleString('cs-CZ')} vybraných prvků.`) : `Skryto ručně: ${S.hidden.size} prvků.`));
    const b = el('button', 'link', 'Zobrazit vše');
    b.type = 'button';
    b.addEventListener('click', showAll);
    note.appendChild(b);
    root.appendChild(note);
  }

  root.appendChild(modelsSection());
  root.appendChild(recentSection());
  root.appendChild(colorSection());

  root.appendChild(rowList('Podlaží', [...S.storeys].reverse().map((s) => ({ ...s, label: s.name, ref: s })),
    (it) => { it.ref.visible = !it.ref.visible; S.isolated = null; applyVisibility(); renderModelPanel(); },
    (it) => { S.storeys.forEach((s) => { s.visible = s === it.ref; }); S.isolated = null; applyVisibility(); renderModelPanel(); },
    (it) => inspect(it.ref.id, 'model')));

  const cls = [...S.classes.entries()].map(([k, c]) => ({ label: classLabel(k), sub: CLASS_LABELS[U(k)] ? k : '', count: c.count, visible: c.visible, ref: c, key: k }))
    .sort((a, b) => a.label.localeCompare(b.label, 'cs'));
  root.appendChild(rowList('Kategorie', cls,
    (it) => { it.ref.visible = !it.ref.visible; S.isolated = null; applyVisibility(); renderModelPanel(); },
    (it) => { S.classes.forEach((c) => { c.visible = c === it.ref; }); S.isolated = null; applyVisibility(); renderModelPanel(); }));
  root.appendChild(aboutLink());
}


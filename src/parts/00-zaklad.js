import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as WebIFC from 'web-ifc';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import proj4 from 'proj4';
import * as Lerc from 'lerc/LercDecode.es.js';

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const nf = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 });
const nf3 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CLASS_LABELS = {
  IFCWALL: 'Stěny', IFCWALLSTANDARDCASE: 'Stěny', IFCWALLELEMENTEDCASE: 'Stěny', IFCCURTAINWALL: 'Lehké obvodové pláště',
  IFCSLAB: 'Desky a stropy', IFCROOF: 'Střechy', IFCWINDOW: 'Okna', IFCDOOR: 'Dveře', IFCCOLUMN: 'Sloupy',
  IFCBEAM: 'Nosníky', IFCMEMBER: 'Pruty', IFCPLATE: 'Desky (plechy, skla)', IFCSTAIR: 'Schodiště', IFCSTAIRFLIGHT: 'Ramena schodiště',
  IFCRAMP: 'Rampy', IFCRAMPFLIGHT: 'Ramena rampy', IFCRAILING: 'Zábradlí', IFCCOVERING: 'Povrchy a podhledy',
  IFCFOOTING: 'Základy', IFCPILE: 'Piloty', IFCFURNISHINGELEMENT: 'Vybavení', IFCFURNITURE: 'Nábytek',
  IFCBUILDINGELEMENTPROXY: 'Obecné prvky (proxy)', IFCSPACE: 'Místnosti', IFCOPENINGELEMENT: 'Otvory',
  IFCFLOWSEGMENT: 'Rozvody', IFCPIPESEGMENT: 'Potrubí', IFCPIPEFITTING: 'Tvarovky potrubí', IFCDUCTSEGMENT: 'Vzduchovody',
  IFCDUCTFITTING: 'Tvarovky VZT', IFCFLOWTERMINAL: 'Koncové prvky', IFCAIRTERMINAL: 'Vyústě VZT',
  IFCSANITARYTERMINAL: 'Zařizovací předměty', IFCLIGHTFIXTURE: 'Svítidla', IFCCABLECARRIERSEGMENT: 'Kabelové trasy',
  IFCFLOWFITTING: 'Tvarovky', IFCFLOWCONTROLLER: 'Armatury', IFCVALVE: 'Ventily', IFCDISTRIBUTIONCONTROLELEMENT: 'Řídicí prvky',
  IFCENERGYCONVERSIONDEVICE: 'Zdroje energie', IFCFLOWMOVINGDEVICE: 'Čerpadla a ventilátory', IFCFLOWSTORAGEDEVICE: 'Zásobníky',
  IFCELECTRICAPPLIANCE: 'Elektrospotřebiče', IFCOUTLET: 'Zásuvky', IFCSWITCHINGDEVICE: 'Spínače',
  IFCSITE: 'Pozemek', IFCGEOGRAPHICELEMENT: 'Terén a krajina', IFCTRANSPORTELEMENT: 'Výtahy a dopravníky',
};
const HIDDEN_BY_DEFAULT = new Set(['IFCSPACE', 'IFCOPENINGELEMENT']);
const U = (c) => String(c || '').toUpperCase();
const classLabel = (c) => CLASS_LABELS[U(c)] || c;

/* ---------- state ---------- */
const S = {
  api: null, modelID: null, fileName: '',
  elements: new Map(),   // id -> { meshes, cls, storey }
  storeys: [],           // { id, name, elev, visible, count }
  classes: new Map(),    // cls -> { visible, count }
  hidden: new Set(), isolated: null, selected: null,
  meshes: [], bbox: new THREE.Box3(), clipOn: false, clipPanel: false, edges: true,
  measure: { on: false, first: null, list: [], preview: null, tri: true },
};

const geoPts = [];          // body nástroje Souřadnice
const coord = { on: false }; // stav nástroje Souřadnice
const undoStack = [];        // kroky pro Zpět (část 07)
const plan = { on: false, storey: 'auto', shown: null, rt: null, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000), view: null, imgView: null, fitPpm: 0, dirty: true, timer: 0, north: 'project' };

/* ---------- three setup ---------- */
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.localClippingEnabled = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000);
camera.position.set(20, 15, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.enableRotate = false; // otáčení řešíme sami kolem zvoleného středu (viz orbitBy)
controls.enableZoom = false;   // zoom řešíme sami (zoomAt), OrbitControls se u cíle zasekává

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 2, 1.4);
scene.add(sun);
const modelGroup = new THREE.Group();
scene.add(modelGroup);
const measureScene = new THREE.Scene();
const measureMat = new LineMaterial({ linewidth: 3, depthTest: false, transparent: true, worldUnits: false });
// odvěsny pravoúhlého trojúhelníku měření: svislá a vodorovná
const legVMat = new LineMaterial({ linewidth: 2.5, depthTest: false, transparent: true, opacity: 0.95, worldUnits: false });
const legHMat = new LineMaterial({ linewidth: 2.5, depthTest: false, transparent: true, opacity: 0.95, worldUnits: false });
const clipOutlineMat = new LineMaterial({ linewidth: 2, depthTest: false, transparent: true, opacity: 0.7, worldUnits: false });
renderer.autoClear = false;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
// výběr: prvek si nechá svou barvu, jen jemně zabarvenou, a dostane výrazný obrys
const SEL_TINT = 0.28;
const selTintCache = new Map(); // původní materiál → zabarvená kopie
const selLineMat = new LineMaterial({ linewidth: 2.5, worldUnits: false, transparent: true, opacity: 0.95 });
function selTinted(mat) {
  let t = selTintCache.get(mat);
  if (!t) {
    t = mat.clone();
    const accent = new THREE.Color(cssVar('--sel') || '#ff7a1a');
    t.color.lerp(accent, SEL_TINT);
    if (t.emissive) t.emissive.copy(accent).multiplyScalar(0.08);
    selTintCache.set(mat, t);
  }
  return t;
}
// místnosti: průhledné a mírně přisunuté ke kameře, aby jejich plochy shodné s podlahou
// a stěnami neblikaly (z-fighting) a podlaha místnosti byla v řezu vidět obarvená. DoubleSide kreslí three.js ve dvou průchodech
// (zadní, pak přední strany), takže i v řezu je vidět obarvená podlaha místnosti.
const spaceMat = new THREE.MeshLambertMaterial({
  side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
});

let needsRender = true;
const requestRender = () => { needsRender = true; };
controls.addEventListener('change', requestRender);

function applyTheme() {
  if (typeof markPlanDirty === 'function') try { markPlanDirty(); } catch (e) { /* not ready */ }
  scene.background = new THREE.Color(cssVar('--ground') || '#e6e9e7');
  edgeMat.color.set(cssVar('--edge') || '#17201e');
  selLineMat.color.set(cssVar('--sel') || '#ff7a1a');
  selTintCache.forEach((t) => t.dispose());
  selTintCache.clear();
  if (typeof S !== 'undefined' && S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec) for (const m of rec.meshes) if (m.userData.mat) m.material = selTinted(m.userData.mat);
  }
  spaceMat.color.set(cssVar('--space') || '#3b82c4');
  measureMat.color.set(cssVar('--sel') || '#ff7a1a');
  legVMat.color.set(cssVar('--info') || '#2f5f8a');
  legHMat.color.set(cssVar('--ok') || '#2f7d4a');
  clipOutlineMat.color.set(cssVar('--accent') || '#c94a10');
  if (typeof S !== 'undefined' && S.color) { try { refreshColoring(); renderLegend(); } catch (e) { /* not ready */ } }
  try { // terén z datových vrstev má barvu podle režimu
    dataGroup.traverse((o) => { if (o.userData && o.userData.dem && o.material) o.material.color.set(isDarkTheme() ? '#5d665f' : '#c9cfc4'); });
  } catch (e) { /* not ready */ }
  // stavový řádek iPadu (aplikace na ploše) ladí s aktuálním režimem, i když je přepnutý ručně
  const bg = cssVar('--bg');
  if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  updateThemeBtn();
  requestRender();
}
/* přepínač světlý/tmavý režim: výchozí je podle zařízení; ruční volba se pamatuje,
   a když se shoduje s nastavením zařízení, zapomene se (aplikace pak zase sleduje zařízení) */
const THEME_KEY = 'ifc-nahled-theme';
const sysDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } };
const themeIsDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : sysDark(); };
function updateThemeBtn() {
  const b = document.getElementById('btn-theme');
  if (!b) return;
  const label = themeIsDark() ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim';
  b.setAttribute('aria-label', label);
  b.title = label;
}
function toggleTheme() {
  const next = themeIsDark() ? 'light' : 'dark';
  const root = document.documentElement;
  if ((next === 'dark') === sysDark()) {
    root.removeAttribute('data-theme');
    try { localStorage.removeItem(THEME_KEY); } catch (e) { /* private mode */ }
  } else {
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  }
}
document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);
applyTheme();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* old Safari */ }
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  measureMat.resolution.set(w, h);
  legVMat.resolution.set(w, h);
  legHMat.resolution.set(w, h);
  selLineMat.resolution.set(w, h);
  clipOutlineMat.resolution.set(w, h);
  if (typeof dataGroup !== 'undefined') dataGroup.traverse((o) => { if (o.material?.resolution) o.material.resolution.set(w, h); });
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  try { updateViewOffset(); } catch (e) { /* před spuštěním */ }
  requestRender();
}
new ResizeObserver(resize).observe(viewport);

function renderFrame() {
  renderer.clear();
  if (typeof setSpaceSide === 'function') setSpaceSide(S.clipOn);
  bigSync();
  renderer.clippingPlanes = S.clipOn ? [clipPlane] : [];
  renderer.render(scene, camera);
  renderer.clippingPlanes = [];
  renderer.clearDepth();
  renderer.render(measureScene, camera);
  updateOverlay();
  placeGeoOverlay();
  try { updateDataAttr(); watchDetailView(); } catch (e) { /* data ještě nejsou připravená */ }
  updateCompass();
  if (plan.on) updatePlanMarker();
  needsRender = false;
}
/* ----- zoom: posun kamery po paprsku pod prsty / kurzorem ----- */
// Krok = část vzdálenosti k povrchu pod prsty, ale nikdy méně než minStep.
// U povrchu tedy zpomalí, ale nezasekne se a projde dál (skrz řez, do místnosti).
let lastZoomD = null;
function zoomAt(cx, cy, amount) {
  if (!amount) return;
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const dir = ray.ray.direction.clone();
  let D = null;
  if (S.modelID != null) {
    const hits = ray.intersectObjects(S.meshes.filter(pickable), false);
    const hit = hits.find((h) => !S.clipOn || clipPlane.distanceToPoint(h.point) >= -1e-4);
    if (hit) D = hit.distance;
  }
  if (D == null) D = lastZoomD ?? camera.position.distanceTo(controls.target);
  lastZoomD = D;
  const minStep = S.minStep || 0.5;
  const move = amount * Math.max(D, minStep);
  tweenId++;
  camera.position.addScaledVector(dir, move);
  camera.updateMatrixWorld();
  const vd = camera.getWorldDirection(new THREE.Vector3());
  controls.target.copy(camera.position).addScaledVector(vd, Math.max(D - move, minStep));
  controls.update();
  requestRender();
}
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
  zoomAt(e.clientX, e.clientY, THREE.MathUtils.clamp(-e.deltaY * unit, -0.4, 0.4));
}, { passive: false });

(function loop() {
  requestAnimationFrame(loop);
  const moved = controls.update();
  if (moved || needsRender) renderFrame();
})();


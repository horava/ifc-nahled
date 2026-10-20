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
  measure: { on: false, first: null, list: [] },
};

const geoPts = [];          // body nástroje Souřadnice
const coord = { on: false }; // stav nástroje Souřadnice
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
  clipOutlineMat.color.set(cssVar('--accent') || '#c94a10');
  if (typeof S !== 'undefined' && S.color) { try { refreshColoring(); renderLegend(); } catch (e) { /* not ready */ } }
  requestRender();
}
applyTheme();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* old Safari */ }
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  measureMat.resolution.set(w, h);
  selLineMat.resolution.set(w, h);
  clipOutlineMat.resolution.set(w, h);
  if (typeof dataGroup !== 'undefined') dataGroup.traverse((o) => { if (o.material?.resolution) o.material.resolution.set(w, h); });
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(viewport);

function renderFrame() {
  renderer.clear();
  if (typeof setSpaceSide === 'function') setSpaceSide(S.clipOn);
  renderer.clippingPlanes = S.clipOn ? [clipPlane] : [];
  renderer.render(scene, camera);
  renderer.clippingPlanes = [];
  renderer.clearDepth();
  renderer.render(measureScene, camera);
  updateOverlay();
  placeGeoOverlay();
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
    const hits = ray.intersectObjects(S.meshes.filter((m) => m.visible), false);
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

/* ---------- IFC loading ---------- */
const matCache = new Map();
function materialFor(c) {
  const key = [c.x, c.y, c.z, c.w].map((v) => v.toFixed(3)).join(',');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(c.x, c.y, c.z), side: THREE.DoubleSide });
    if (c.w < 0.999) { m.transparent = true; m.opacity = Math.max(c.w, 0.15); m.depthWrite = false; }
    matCache.set(key, m);
  }
  return m;
}

async function initApi() {
  if (S.api) return S.api;
  const api = new WebIFC.IfcAPI();
  await api.Init((path) => new URL(path, document.baseURI).href, true);
  S.api = api;
  return api;
}

function clearModel() {
  deselect();
  resetFeatures();
  S.modelGen = (S.modelGen || 0) + 1;
  const geos = new Set();
  modelGroup.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
  geos.forEach((g) => g.dispose());
  modelGroup.clear();
  S.elements.clear(); S.storeys = []; S.classes.clear(); S.hidden.clear();
  S.isolated = null; S.meshes = []; S.clipOn = false; S.clipPanel = false;
  selTintCache.forEach((t) => t.dispose()); selTintCache.clear();
  clearMeasures(); updateClipUi();
  if (S.api && S.modelID != null) { try { S.api.CloseModel(S.modelID); } catch (e) { /* ignore */ } }
  S.modelID = null;
}

async function loadIfc(buffer, fileName) {
  showLoading(`Načítám ${fileName}`);
  await nextFrame();
  try {
    const api = await initApi();
    setLoadingStep('Čtu geometrii…');
    await nextFrame();
    clearModel();
    const t0 = performance.now();
    const modelID = api.OpenModel(new Uint8Array(buffer), { COORDINATE_TO_ORIGIN: true });
    if (modelID < 0) throw new Error('Soubor se nepodařilo otevřít. Je to platný IFC (STEP)?');
    S.modelID = modelID;
    S.fileName = fileName;

    const geoCache = new Map();
    const edgeCache = new Map();
    const withEdges = [];
    const onMesh = (flat) => {
      const id = flat.expressID;
      let rec = S.elements.get(id);
      if (!rec) { rec = { meshes: [], cls: '', storey: null }; S.elements.set(id, rec); }
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        let geo = geoCache.get(pg.geometryExpressID);
        if (!geo) {
          const g = api.GetGeometry(modelID, pg.geometryExpressID);
          const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
          const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
          g.delete();
          if (!idx.length) continue;
          const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
          geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
          geo.computeBoundingSphere();
          geoCache.set(pg.geometryExpressID, geo);
        }
        const mesh = new THREE.Mesh(geo, materialFor(pg.color));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.userData.id = id;
        mesh.userData.geoId = pg.geometryExpressID;
        rec.meshes.push(mesh);
        modelGroup.add(mesh);
        S.meshes.push(mesh);
        withEdges.push(mesh);
      }
    };
    api.StreamAllMeshes(modelID, onMesh);
    // web-ifc vynechává IfcSpace, místnosti načteme zvlášť
    try { api.StreamAllMeshesWithTypes(modelID, [WebIFC.IFCSPACE], onMesh); } catch (e) { console.warn('IfcSpace', e); }

    // classes
    for (const [id, rec] of S.elements) {
      let cls = 'IFCUNKNOWN';
      try { cls = api.GetNameFromTypeCode(api.GetLineType(modelID, id)) || cls; } catch (e) { /* keep */ }
      rec.cls = cls;
      if (!S.classes.has(cls)) S.classes.set(cls, { visible: !HIDDEN_BY_DEFAULT.has(U(cls)), count: 0 });
      S.classes.get(cls).count++;
      if (U(cls) === 'IFCSPACE') for (const m of rec.meshes) { m.material = spaceMat; m.renderOrder = 2; }
    }

    // spatial structure
    setLoadingStep('Čtu podlaží…');
    await nextFrame();
    const storeyMap = new Map();
    try {
      const tree = await api.properties.getSpatialStructure(modelID, false);
      const walk = (node, storeyId) => {
        let sid = storeyId;
        if (U(node.type) === 'IFCBUILDINGSTOREY') {
          sid = node.expressID;
          if (!storeyMap.has(sid)) {
            const line = api.GetLine(modelID, sid);
            storeyMap.set(sid, { id: sid, name: line?.Name?.value || line?.LongName?.value || `Podlaží #${sid}`,
              elev: Number(line?.Elevation?.value ?? 0), visible: true, count: 0 });
          }
        }
        if (S.elements.has(node.expressID) && sid != null) S.elements.get(node.expressID).storey = sid;
        (node.children || []).forEach((c) => walk(c, sid));
      };
      walk(tree, null);
      S.tree = tree;
    } catch (e) { console.warn('Spatial structure', e); S.tree = null; }
    S.treeOpen = new Set(); S.treeLimit = new Map(); S.names = new Map();
    S.storeys = [...storeyMap.values()].sort((a, b) => a.elev - b.elev);
    let orphan = 0;
    for (const rec of S.elements.values()) {
      const s = rec.storey != null && storeyMap.get(rec.storey);
      if (s) s.count++; else { rec.storey = -1; orphan++; }
    }
    if (orphan) S.storeys.push({ id: -1, name: 'Mimo podlaží', elev: Infinity, visible: true, count: orphan });

    // edges (skip for very heavy models)
    if (withEdges.length < 6000) {
      for (const mesh of withEdges) {
        if (U(S.elements.get(mesh.userData.id)?.cls) === 'IFCSPACE') continue;
        let eg = edgeCache.get(mesh.userData.geoId);
        if (!eg) { eg = new THREE.EdgesGeometry(mesh.geometry, 30); edgeCache.set(mesh.userData.geoId, eg); }
        const ls = new THREE.LineSegments(eg, edgeMat);
        ls.userData.edge = true;
        mesh.add(ls);
      }
    }

    // bbox (visible only after class defaults)
    modelGroup.updateMatrixWorld(true);
    applyVisibility();
    S.bbox = boxOf(S.meshes.filter((m) => m.visible));
    if (S.bbox.isEmpty()) S.bbox.setFromObject(modelGroup);
    S.baseAngle = detectOrientation();
    S.minStep = THREE.MathUtils.clamp(S.bbox.getSize(new THREE.Vector3()).length() * 0.03, 0.5, 5);
    lastZoomD = null;
    setupClip();
    fitView('iso', false);

    const schema = (() => { try { return api.GetModelSchema(modelID); } catch (e) { return ''; } })();
    let projectName = '', projectGuid = '';
    try {
      const pids = api.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
      if (pids.size()) {
        const p = api.GetLine(modelID, pids.get(0));
        projectName = p?.LongName?.value || p?.Name?.value || '';
        projectGuid = p?.GlobalId?.value || '';
      }
    } catch (e) { /* ignore */ }
    S.meta = { schema, projectName, projectGuid, ms: Math.round(performance.now() - t0) };
    S.guidMap = null;
    S.coordMatrix = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(modelID)); } catch (e) { return new THREE.Matrix4(); } })();
    bcfOnModelLoaded();
    geoOnModelLoaded();
    featuresOnModelLoaded();
    dataOnModelLoaded();
    refsOnMainLoaded();

    renderModelPanel();
    renderProps();
    if (!$('#panel-tree').hidden) renderTree();
    plan.storey = 'auto'; plan.shown = null; plan.view = null;
    if (plan.on) { fillPlanSelect(); fitPlan(); markPlanDirty(0); }
    $('#file-name').textContent = fileName;
    $('#file-name').title = fileName;
    $('#empty-hint').hidden = true;
    hideLoading();
    toast(`Načteno: ${S.elements.size.toLocaleString('cs-CZ')} prvků za ${nf.format(S.meta.ms / 1000)} s`);
  } catch (err) {
    console.error(err);
    hideLoading();
    toast(err?.message || 'Model se nepodařilo načíst.', true);
  }
}

function boxOf(meshes) {
  const b = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    b.union(tmp);
  }
  return b;
}

/* ---------- visibility ---------- */
function isVisible(id, rec) {
  if (S.hidden.has(id)) return false;
  if (S.isolated) return S.isolated.has(id);
  const c = S.classes.get(rec.cls);
  if (c && !c.visible) return false;
  const st = S.storeys.find((s) => s.id === rec.storey);
  if (st && !st.visible) return false;
  return true;
}
/* viditelnost meshů; zprůhledněné prvky (duchové) se nekreslí jednotlivě, ale jako jeden sloučený objekt */
function syncMeshVisibility() {
  const merge = !!S.color;
  for (const [id, rec] of S.elements) {
    const v = isVisible(id, rec);
    for (const m of rec.meshes) m.visible = v && !(merge && m.userData.ghost && id !== S.selected);
  }
  if (typeof rebuildGhosts === 'function') rebuildGhosts();
}
function applyVisibility() {
  syncMeshVisibility();
  updateToolbar();
  requestRender();
  if (S.tree && !$('#panel-tree').hidden) renderTree();
  markPlanDirty();
}

/* ---------- selection ---------- */
function select(id, opts = {}) {
  deselect(false);
  S.inspectId = null;
  const rec = S.elements.get(id);
  if (!rec) return;
  S.selected = id;
  const showSel = isVisible(id, rec);
  for (const m of rec.meshes) {
    if (m.userData.ghost && S.color) m.visible = showSel;
    m.userData.mat = m.material;
    m.material = selTinted(m.material);
    // obrys z hran prvku (tlustá čára v pixelech, nezávislá na zoomu)
    const eg = new THREE.EdgesGeometry(m.geometry, 25);
    const lg = new LineSegmentsGeometry().fromEdgesGeometry(eg);
    eg.dispose();
    const outline = new LineSegments2(lg, selLineMat);
    outline.userData.selOutline = true;
    outline.renderOrder = 5;
    m.add(outline);
  }
  updateToolbar();
  requestRender();
  const inTree = !$('#panel-tree').hidden;
  if (!opts.keepPanel && !inTree) showPanel('props');
  renderProps();
  updateRotLabel();
  if (!$('#panel-tree').hidden) renderTree(true);
  if (plan.on) markPlanDirty(60);
}
function deselect(render = true) {
  if (S.cmpSel != null) ghostDeselect();
  if (S.refSel) refDeselect();
  if (S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec) for (const m of rec.meshes) {
      if (m.userData.mat) m.material = m.userData.mat;
      if (m.userData.ghost && S.color) m.visible = false;
      for (const c of [...m.children]) if (c.userData.selOutline) { m.remove(c); c.geometry.dispose(); }
    }
  }
  S.selected = null;
  S.inspectId = null;
  if (render) {
    updateToolbar(); renderProps(); requestRender(); updateRotLabel();
    if (!$('#panel-tree').hidden) renderTree();
    if (plan.on) markPlanDirty(60);
  }
}

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let down = null;
let lastTap = null;
let pinchPrev = null;
const pointers = new Map();
let orbit = null;
try { S.orbitSel = localStorage.getItem('ifc-nahled-orbit-sel') !== '0'; } catch (e) { S.orbitSel = true; }

/* ----- otáčení kolem středu: výběr / cíl kamery ----- */
const pivotEl = $('#pivot');
let pivotHideT = 0;
function currentPivot() {
  if (S.orbitSel && S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec && rec.meshes.length) return boxOf(rec.meshes).getCenter(new THREE.Vector3());
  }
  return controls.target.clone();
}
function showPivot(p, hold) {
  _v.copy(p).project(camera);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  pivotEl.style.left = `${(_v.x + 1) / 2 * w}px`;
  pivotEl.style.top = `${(1 - _v.y) / 2 * h}px`;
  pivotEl.hidden = !(_v.z > -1 && _v.z < 1);
  clearTimeout(pivotHideT);
  if (!hold) pivotHideT = setTimeout(() => { pivotEl.hidden = true; }, 650);
}
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const ORBIT_UP = new THREE.Vector3(0, 1, 0);
function orbitBy(dx, dy, P) {
  const h = renderer.domElement.clientHeight || 1;
  const C = camera.position.clone(), T = controls.target.clone();
  // vodorovně: kolem svislé osy procházející středem P
  _q.setFromAxisAngle(ORBIT_UP, -2 * Math.PI * dx / h);
  C.sub(P).applyQuaternion(_q).add(P);
  T.sub(P).applyQuaternion(_q).add(P);
  // svisle: kolem vodorovné osy kamery, s omezením, aby se pohled nepřeklopil
  const off = C.clone().sub(T);
  const phi = Math.acos(THREE.MathUtils.clamp(off.y / Math.max(off.length(), 1e-9), -1, 1));
  const newPhi = THREE.MathUtils.clamp(phi - 2 * Math.PI * dy / h, 0.02, Math.PI - 0.02);
  const dphi = newPhi - phi;
  _right.crossVectors(T.clone().sub(C).normalize(), ORBIT_UP).normalize();
  if (_right.lengthSq() > 0.5) {
    _q.setFromAxisAngle(_right, dphi);
    C.sub(P).applyQuaternion(_q).add(P);
    T.sub(P).applyQuaternion(_q).add(P);
  }
  tweenId++; // zastaví případnou animaci kamery
  camera.position.copy(C);
  controls.target.copy(T);
  camera.lookAt(T);
  controls.update();
  requestRender();
}
function setOrbitSel(on) {
  S.orbitSel = on;
  try { localStorage.setItem('ifc-nahled-orbit-sel', on ? '1' : '0'); } catch (e) { /* ignore */ }
  $('#btn-orbit').setAttribute('aria-pressed', String(on));
  toast(on ? 'Otáčení kolem vybraného prvku je zapnuté.' : 'Otáčí se kolem středu pohledu.');
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pinchPrev = null;
  const single = pointers.size === 1 && (e.pointerType !== 'mouse' || e.button === 0);
  down = single ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  orbit = single ? { x: e.clientX, y: e.clientY, P: null, moved: false } : null;
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchPrev && d > 10) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, THREE.MathUtils.clamp(1 - pinchPrev / d, -0.5, 0.5));
    pinchPrev = d;
    return;
  }
  if (!orbit || pointers.size !== 1) return;
  const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
  if (!orbit.moved && Math.hypot(dx, dy) < 6) return;
  if (!orbit.P) orbit.P = currentPivot();
  orbit.moved = true;
  orbit.x = e.clientX; orbit.y = e.clientY;
  orbitBy(dx, dy, orbit.P);
  showPivot(orbit.P, true);
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  pinchPrev = null;
  if (orbit?.moved) showPivot(orbit.P, false);
  orbit = null;
  if (!down || e.type === 'pointercancel') { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const now = performance.now();
  const dt = now - down.t;
  down = null;
  if (moved > 8 || dt > 600) return;
  if (!S.measure.on && !coord.on && lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    doubleTap(e.clientX, e.clientY);
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  pick(e.clientX, e.clientY);
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

function hitAt(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(S.meshes.filter((m) => m.visible), false);
  return hits.find((h) => !S.clipOn || clipPlane.distanceToPoint(h.point) >= -1e-4) || null;
}
/* dvojité klepnutí: bod se přesune do středu pohledu a stane se středem otáčení */
function doubleTap(cx, cy) {
  const hit = hitAt(cx, cy);
  if (!hit) return;
  const P = hit.point.clone();
  const id = hit.object.userData.id;
  if (S.selected !== id) select(id);
  const shift = P.clone().sub(controls.target);
  tween(camera.position.clone().add(shift), P, true);
  setTimeout(() => showPivot(P, false), 470);
}

/* kandidáti pod prstem pro výběr: každý prvek jednou, podle vzdálenosti.
   Místnost má přednost před plochou, která s ní splývá (podlaha, stěna) –
   jinak by o výsledku rozhodovala náhoda v zaokrouhlení. */
const isSpaceId = (id) => U(S.elements.get(id)?.cls || '') === 'IFCSPACE';
function pickCandidates(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const targets = S.meshes.filter((m) => m.visible);
  if (S.cmp && cmpGroup.visible) targets.push(...(S.cmpGhosts || []));
  for (const R of S.refs || []) if (R.visible && !R.ghost) targets.push(...R.meshes);
  const hits = ray.intersectObjects(targets, false)
    .filter((h) => !S.clipOn || clipPlane.distanceToPoint(h.point) >= -1e-4);
  const seen = new Set(), list = [];
  for (const h of hits) {
    const ud = h.object.userData;
    const id = ud.ref != null ? `r${ud.ref}:${ud.id}` : ud.id ?? (ud.ghost != null ? `g${ud.ghost}` : null);
    if (id == null || seen.has(id)) continue;
    seen.add(id); list.push({ id, d: h.distance });
  }
  if (list.length > 1 && !isSpaceId(list[0].id)) {
    const eps = Math.max(0.05, list[0].d * 0.004);
    const k = list.findIndex((c) => c.d - list[0].d <= eps && isSpaceId(c.id));
    if (k > 0) list.unshift(...list.splice(k, 1));
  }
  return list.slice(0, 8).map((c) => c.id);
}
/* opakované ťuknutí na stejné místo vybere další prvek pod prstem */
let tapCycle = null;
let cycleHint = 0;
function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  if (S.data?.info) { dataIdentifyScreen(cx, cy); return; }
  if (coord.on || S.measure.on) {
    const hit = hitAt(cx, cy);
    if (!hit) return;
    if (coord.on) addGeoPoint(hit, cx - r.left, cy - r.top); else measurePoint(hit, cx - r.left, cy - r.top);
    return;
  }
  const cur = S.cmpSel != null ? `g${S.cmpSel}` : S.refSel ? `r${S.refSel.R.id}:${S.refSel.id}` : S.selected;
  const same = tapCycle && Math.hypot(cx - tapCycle.x, cy - tapCycle.y) < 16 && cur != null && tapCycle.ids.includes(cur);
  if (same) {
    const ids = tapCycle.ids, i = ids.indexOf(cur) + 1;
    if (i >= ids.length) { tapCycle = null; deselect(); return; }
    selectAny(ids[i]);
    toast(`Pod prstem ${i + 1}/${ids.length}: ${anyName(ids[i])}`);
    return;
  }
  const ids = pickCandidates(cx, cy);
  if (!ids.length) { tapCycle = null; deselect(); return; }
  tapCycle = { x: cx, y: cy, ids };
  if (ids[0] === cur) { tapCycle = null; deselect(); return; }
  selectAny(ids[0]);
  if (ids.length > 1 && cycleHint < 2) { cycleHint++; toast('Další ťuknutí na stejné místo vybere prvek pod ním.'); }
}

/* ---------- camera ---------- */
function fitView(mode = 'keep', animate = true) {
  const box = S.bbox.isEmpty() ? new THREE.Box3(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5)) : S.bbox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2) * 1.05;
  let dir;
  if (mode && mode.isVector3) dir = mode.clone();
  else if (mode === 'top') dir = new THREE.Vector3(0, 1, 0.0001);
  else if (mode === 'front') dir = new THREE.Vector3(0, 0.15, 1);
  else if (mode === 'iso') dir = new THREE.Vector3(1, 0.8, 1.15);
  else dir = camera.position.clone().sub(controls.target);
  dir.normalize();
  const to = center.clone().add(dir.multiplyScalar(dist));
  camera.near = Math.max(dist / 2000, 0.01);
  camera.far = dist * 50;
  camera.updateProjectionMatrix();
  tween(to, center, animate);
}
let tweenId = 0;
function tween(pos, target, animate) {
  const id = ++tweenId;
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce) { camera.position.copy(pos); controls.target.copy(target); controls.update(); requestRender(); return; }
  const start = performance.now(), dur = 450;
  const step = (now) => {
    if (id !== tweenId) return;
    const k = Math.min((now - start) / dur, 1), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(p0, pos, e);
    controls.target.lerpVectors(t0, target, e);
    controls.update();
    requestRender();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function focusSelected() {
  const rec = S.elements.get(S.selected);
  if (!rec) return;
  const b = boxOf(rec.meshes);
  const c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  tween(c.clone().add(dir.multiplyScalar(r * 3.2)), c, true);
}

/* ---------- section ---------- */
const clipRange = $('#clip-range');
const CLIP_MODES = {
  h: { label: 'Vodorovný', sub: 'nad spodní hranou' },
  cross: { label: 'Příčný', sub: 'od kraje modelu' },
  long: { label: 'Podélný', sub: 'od kraje modelu' },
};
const clip = { mode: 'h', vals: {}, flip: { h: false, cross: false, long: false }, rot: { cross: 0, long: 0 } };
let clipOutline = null;
const UP = new THREE.Vector3(0, 1, 0);
const nfDeg = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
const hdir = (deg) => { const r = THREE.MathUtils.degToRad(deg); return new THREE.Vector3(Math.cos(r), 0, Math.sin(r)); };
const wrap180 = (d) => ((d + 90) % 180 + 180) % 180 - 90;

/* hlavní směr budovy: histogram vodorovných hran stěn (mod 90°), delší z obou os = podélná */
function dominantAngle(meshes, maxTris = 150000) {
  const hist = new Float32Array(180);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let tris = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    if (!idx) continue;
    const step = Math.max(1, Math.floor(idx.count / 3 / 400)) * 3;
    for (let i = 0; i + 2 < idx.count; i += step) {
      for (let e = 0; e < 3; e++) {
        a.fromBufferAttribute(pos, idx.getX(i + e)).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, idx.getX(i + (e + 1) % 3)).applyMatrix4(m.matrixWorld);
        const dx = b.x - a.x, dz = b.z - a.z, dy = Math.abs(b.y - a.y);
        const L = Math.hypot(dx, dz);
        if (L < 0.05 || dy > L * 0.2) continue;
        let deg = THREE.MathUtils.radToDeg(Math.atan2(dz, dx));
        deg = ((deg % 90) + 90) % 90;
        hist[Math.round(deg * 2) % 180] += L;
      }
      if (++tris > maxTris) break;
    }
  }
  let best = 0;
  for (let i = 0; i < 180; i++) {
    const v = hist[i] + 0.5 * (hist[(i + 179) % 180] + hist[(i + 1) % 180]);
    const bv = hist[best] + 0.5 * (hist[(best + 179) % 180] + hist[(best + 1) % 180]);
    if (v > bv) best = i;
  }
  return hist[best] > 0 ? best / 2 : null;
}
function extentAlong(meshes, dir) {
  let mn = Infinity, mx = -Infinity;
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 200));
    for (let i = 0; i < pos.count; i += step) {
      const d = v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).dot(dir);
      if (d < mn) mn = d; if (d > mx) mx = d;
    }
  }
  return mx - mn;
}
function detectOrientation() {
  const walls = [];
  for (const rec of S.elements.values()) if (/^IFC(WALL|CURTAINWALL)/.test(U(rec.cls))) walls.push(...rec.meshes);
  const src = walls.length ? walls : S.meshes.filter((m) => m.visible);
  const ang = dominantAngle(src);
  if (ang == null) return 0;
  // vyber z ang / ang+90 tu osu, podél které je model delší
  return extentAlong(src, hdir(ang)) >= extentAlong(src, hdir(ang + 90)) ? ang : ang + 90;
}

function clipNormal(mode = clip.mode) {
  if (mode === 'h') return UP.clone();
  const base = S.baseAngle || 0;
  return mode === 'cross' ? hdir(base + clip.rot.cross) : hdir(base + 90 + clip.rot.long);
}
function clipRangeFor(mode = clip.mode) {
  const n = clipNormal(mode), b = S.bbox;
  let mn = Infinity, mx = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const d = n.x * x + n.y * y + n.z * z;
    if (d < mn) mn = d; if (d > mx) mx = d;
  }
  return { min: mn, max: mx };
}
function setupClip() {
  if (S.bbox.isEmpty()) return;
  clip.rot = { cross: 0, long: 0 };
  clip.flip = { h: false, cross: false, long: false };
  clip.vals = {};
  const c = S.bbox.getCenter(new THREE.Vector3());
  for (const m of Object.keys(CLIP_MODES)) clip.vals[m] = clipNormal(m).dot(c);
  renderClipChips();
  applyClipMode();
}
function applyClipPlane() {
  const n = clipNormal();
  const v = clip.vals[clip.mode];
  const flip = clip.flip[clip.mode];
  // three.js odřízne stranu, kde je vzdálenost od roviny záporná
  clipPlane.normal.copy(n).multiplyScalar(flip ? 1 : -1);
  clipPlane.constant = flip ? -v : v;
  updateClipOutline();
  requestRender();
}
function applyClipMode() {
  const r = clipRangeFor();
  clipRange.min = r.min.toFixed(2);
  clipRange.max = r.max.toFixed(2);
  clipRange.step = 0.01;
  clip.vals[clip.mode] = Math.min(r.max, Math.max(r.min, clip.vals[clip.mode]));
  clipRange.value = clip.vals[clip.mode].toFixed(2);
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === clip.mode)));
  $('#clip-sub').textContent = CLIP_MODES[clip.mode].sub;
  $('#clip-chips-row').hidden = clip.mode !== 'h';
  $('#clip-rot-row').hidden = clip.mode === 'h';
  $('#clip-mini-mode').textContent = CLIP_MODES[clip.mode].label;
  updateRotLabel();
  updateClipLabel();
  applyClipPlane();
}
function updateRotLabel() {
  if (clip.mode === 'h') return;
  const r = clip.rot[clip.mode];
  $('#clip-rot-value').textContent = `${r > 0 ? '+' : ''}${nfDeg.format(r)}°`;
  $('#clip-rot-elem').disabled = S.selected == null;
}
/* natočení kolem bodu roviny nejbližšího středu modelu */
function rotateClip(newRot, pivot) {
  if (clip.mode === 'h') return;
  const P = pivot || clipPlane.projectPoint(S.bbox.getCenter(new THREE.Vector3()), new THREE.Vector3());
  clip.rot[clip.mode] = wrap180(newRot);
  clip.vals[clip.mode] = clipNormal().dot(P);
  applyClipMode();
}
function alignClipToSelected() {
  const rec = S.elements.get(S.selected);
  if (!rec || clip.mode === 'h') return;
  const ang = dominantAngle(rec.meshes);
  if (ang == null) { toast('U tohoto prvku se nepodařilo určit směr.', true); return; }
  // směr prvku (ang nebo ang+90) = ten, podél kterého je prvek delší; rovina řezu kolmo na něj
  const dirDeg = extentAlong(rec.meshes, hdir(ang)) >= extentAlong(rec.meshes, hdir(ang + 90)) ? ang : ang + 90;
  const base = (S.baseAngle || 0) + (clip.mode === 'long' ? 90 : 0);
  const c = boxOf(rec.meshes).getCenter(new THREE.Vector3());
  rotateClip(dirDeg - base, c);
  toast('Řez je kolmo na vybraný prvek a prochází jeho středem.');
}
function setClip(h) {
  clip.vals[clip.mode] = Number(h);
  clipRange.value = Number(h).toFixed(2);
  updateClipLabel();
  applyClipPlane();
}
function updateClipLabel() {
  const rel = clip.vals[clip.mode] - clipRangeFor().min;
  const t = `${nf2.format(rel)} m`;
  $('#clip-value').textContent = t;
  $('#clip-mini-value').textContent = t;
}
clipRange.addEventListener('input', () => setClip(clipRange.value));
function updateClipOutline() {
  if (clipOutline) { measureScene.remove(clipOutline); clipOutline.geometry.dispose(); clipOutline = null; }
  if (!S.clipOn || !S.clipPanel || S.bbox.isEmpty()) return;
  const n = clipNormal(), v = clip.vals[clip.mode];
  const t1 = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(UP, n).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const b = S.bbox;
  let a1 = Infinity, b1 = -Infinity, a2 = Infinity, b2 = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const p = new THREE.Vector3(x, y, z);
    const d1 = p.dot(t1), d2 = p.dot(t2);
    a1 = Math.min(a1, d1); b1 = Math.max(b1, d1); a2 = Math.min(a2, d2); b2 = Math.max(b2, d2);
  }
  const pad = 0.3;
  const o = n.clone().multiplyScalar(v);
  const pts = [[a1 - pad, a2 - pad], [b1 + pad, a2 - pad], [b1 + pad, b2 + pad], [a1 - pad, b2 + pad], [a1 - pad, a2 - pad]]
    .map(([i, j]) => o.clone().addScaledVector(t1, i).addScaledVector(t2, j).toArray()).flat();
  const g = new LineGeometry();
  g.setPositions(pts);
  clipOutline = new Line2(g, clipOutlineMat);
  clipOutline.renderOrder = 998;
  measureScene.add(clipOutline);
}
function storeyCutHeight(st) {
  const meshes = [];
  for (const rec of S.elements.values()) {
    if (rec.storey === st.id && !['IFCSLAB', 'IFCSPACE', 'IFCCOVERING', 'IFCROOF'].includes(U(rec.cls))) meshes.push(...rec.meshes);
  }
  if (!meshes.length) return null;
  return boxOf(meshes).min.y + 1.2;
}
function renderClipChips() {
  const wrapEl = $('#clip-chips');
  wrapEl.replaceChildren();
  S.storeys.filter((s) => s.id !== -1).forEach((st) => {
    const b = el('button', 'chip', st.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      const h = storeyCutHeight(st);
      if (h == null) return;
      clip.flip.h = false;
      setClip(h.toFixed(2));
      fitView('top');
      if (plan.on) { plan.storey = String(st.id); planSel.value = plan.storey; plan.autoClip = true; markPlanDirty(0); }
    });
    wrapEl.appendChild(b);
  });
}
function viewSection() {
  // kamera na odříznuté straně, pohled kolmo na řez
  const dir = clipPlane.normal.clone().negate();
  if (clip.mode === 'h') dir.set(0, 1, 0.0001);
  else dir.y = 0.08;
  fitView(dir);
}
function updateClipUi() {
  $('#clip-pop').hidden = !(S.clipOn && S.clipPanel);
  $('#clip-mini').hidden = !(S.clipOn && !S.clipPanel);
  updateClipOutline();
  requestRender();
}
function toggleClip(force) {
  S.clipOn = force ?? !S.clipOn;
  if (!S.clipOn) plan.autoClip = false;
  if (S.clipOn) { S.clipPanel = true; applyClipMode(); }
  updateClipUi();
  updateToolbar();
}
function nudgeClip(d) {
  const v = Math.min(Number(clipRange.max), Math.max(Number(clipRange.min), clip.vals[clip.mode] + d));
  setClip(v.toFixed(2));
}
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { clip.mode = b.dataset.mode; applyClipMode(); }));
$('#clip-flip').addEventListener('click', () => { clip.flip[clip.mode] = !clip.flip[clip.mode]; applyClipPlane(); });
$('#clip-view').addEventListener('click', viewSection);
$('#clip-collapse').addEventListener('click', () => { S.clipPanel = false; updateClipUi(); });
$('#clip-mini').addEventListener('click', () => { S.clipPanel = true; updateClipUi(); });
$('#clip-off').addEventListener('click', () => toggleClip(false));
$('#clip-up').addEventListener('click', () => nudgeClip(0.1));
$('#clip-down').addEventListener('click', () => nudgeClip(-0.1));
document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => {
  if (clip.mode === 'h') return;
  const d = b.dataset.rot;
  rotateClip(d === '0' ? 0 : clip.rot[clip.mode] + Number(d));
}));
$('#clip-rot-elem').addEventListener('click', alignClipToSelected);

/* ---------- measurement ---------- */
const overlay = $('#overlay');
const _v = new THREE.Vector3();
function toScreen(p) {
  _v.copy(p).project(camera);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  return { x: (_v.x + 1) / 2 * w, y: (1 - _v.y) / 2 * h, ok: _v.z > -1 && _v.z < 1 };
}
function snapPoint(hit, sx, sy) {
  if (!hit.face) return { p: hit.point.clone(), snap: false };
  const pos = hit.object.geometry.attributes.position;
  let best = null, bestD = 18;
  for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
    const w = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
    const sc = toScreen(w);
    const d = Math.hypot(sc.x - sx, sc.y - sy);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best ? { p: best, snap: true } : { p: hit.point.clone(), snap: false };
}
function dot(snap) { const d = el('div', 'mdot' + (snap ? ' snap' : '')); overlay.appendChild(d); return d; }
function measurePoint(hit, sx, sy) {
  const { p, snap } = snapPoint(hit, sx, sy);
  const M = S.measure;
  if (!M.first) {
    M.first = { p, dot: dot(snap) };
    setMeasureText('Klepněte na druhý bod', snap ? 'První bod přichycen k rohu.' : 'První bod je na ploše prvku.');
  } else {
    const a = M.first.p, b = p;
    const geo = new LineGeometry();
    geo.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    const line = new Line2(geo, measureMat);
    line.renderOrder = 999;
    measureScene.add(line);
    const label = el('div', 'mlabel', `${nf3.format(a.distanceTo(b))} m`);
    overlay.appendChild(label);
    const m = { a, b, line, dots: [M.first.dot, dot(snap)], label };
    M.list.push(m);
    M.first = null;
    showMeasureResult(m);
  }
  requestRender();
}
function showMeasureResult(m) {
  const d = m.a.distanceTo(m.b);
  const dy = Math.abs(m.b.y - m.a.y);
  const dh = Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z);
  setMeasureText(`${nf3.format(d)} m`, `vodorovně ${nf3.format(dh)} m · svisle ${nf3.format(dy)} m`);
}
function setMeasureText(main, sub) { $('#m-main').textContent = main; $('#m-sub').textContent = sub; }
function updateOverlay() {
  const M = S.measure;
  const place = (node, p) => {
    const s = toScreen(p);
    node.hidden = !s.ok;
    node.style.left = `${s.x}px`; node.style.top = `${s.y}px`;
  };
  if (M.first) place(M.first.dot, M.first.p);
  for (const m of M.list) {
    place(m.dots[0], m.a); place(m.dots[1], m.b);
    place(m.label, _mid.copy(m.a).add(m.b).multiplyScalar(0.5));
  }
}
const _mid = new THREE.Vector3();
function clearMeasures() {
  const M = S.measure;
  M.list.forEach((m) => { measureScene.remove(m.line); m.line.geometry.dispose(); });
  M.list = []; M.first = null;
  overlay.replaceChildren();
  setMeasureText('Klepněte na první bod', 'Body se přichytávají k rohům prvků.');
  requestRender();
}
function toggleMeasure(force) {
  const M = S.measure;
  M.on = force ?? !M.on;
  if (M.on && coord.on) toggleCoord(false);
  if (!M.on && M.first) { M.first.dot.remove(); M.first = null; }
  if (M.on) {
    if (S.selected != null) deselect();
    if (M.list.length) showMeasureResult(M.list[M.list.length - 1]);
    else setMeasureText('Klepněte na první bod', 'Body se přichytávají k rohům prvků.');
  }
  $('#measure-bar').hidden = !M.on;
  updateToolbar();
  requestRender();
}
$('#m-clear').addEventListener('click', clearMeasures);
$('#m-done').addEventListener('click', () => toggleMeasure(false));

/* ---------- toolbar ---------- */
function updateToolbar() {
  const has = S.selected != null;
  $('#btn-hide').disabled = !has;
  $('#btn-isolate').disabled = !has;
  $('#btn-focus').disabled = !has;
  const anyFilter = S.hidden.size || S.isolated || [...S.classes.entries()].some(([k, c]) => !c.visible && !HIDDEN_BY_DEFAULT.has(U(k))) || S.storeys.some((s) => !s.visible);
  $('#btn-showall').disabled = !anyFilter;
  $('#btn-clip').setAttribute('aria-pressed', String(S.clipOn));
  $('#btn-measure').setAttribute('aria-pressed', String(S.measure.on));
  $('#btn-edges').setAttribute('aria-pressed', String(S.edges));
}
$('#btn-fit').addEventListener('click', () => fitView('keep'));
$('#btn-iso').addEventListener('click', () => fitView('iso'));
$('#btn-top').addEventListener('click', () => fitView('top'));
$('#btn-clip').addEventListener('click', () => toggleClip());
$('#btn-measure').addEventListener('click', () => toggleMeasure());
$('#btn-orbit').addEventListener('click', () => setOrbitSel(!S.orbitSel));
$('#btn-orbit').setAttribute('aria-pressed', String(S.orbitSel));
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
function showAll() {
  S.hidden.clear(); S.isolated = null;
  if (S.color) { S.color.only = null; renderLegend(); }
  cmpGroup.visible = true;
  S.storeys.forEach((s) => { s.visible = true; });
  S.classes.forEach((c, k) => { c.visible = !HIDDEN_BY_DEFAULT.has(U(k)); });
  applyVisibility(); renderModelPanel();
}

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

const APP_VERSION = '1.0';
function aboutLink() {
  const b = el('button', 'link about-link', 'O aplikaci a licence');
  b.type = 'button';
  b.addEventListener('click', openAbout);
  return b;
}
function openAbout() {
  $('#about-version').textContent = `verze ${APP_VERSION}`;
  $('#lic-text').hidden = true;
  document.querySelectorAll('.lic').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  $('#about-modal').hidden = false;
}
$('#about-close').addEventListener('click', () => { $('#about-modal').hidden = true; });
$('#about-modal').addEventListener('click', (e) => { if (e.target.id === 'about-modal') e.currentTarget.hidden = true; });
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

function table(title, rows, extra) {
  const sec = el('section', 'pset');
  const h = el('h3', 'pset-title', title);
  if (extra) h.appendChild(el('span', 'pset-tag', extra));
  sec.appendChild(h);
  const dl = el('dl', 'kv');
  rows.forEach(([k, v]) => {
    dl.append(el('dt', null, k), el('dd', v ? null : 'kv-empty', v || '—'));
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

    const attrs = [];
    for (const k of ['Description', 'ObjectType', 'Tag', 'PredefinedType', 'LongName', 'OverallWidth', 'OverallHeight']) {
      const v = val(item[k]);
      if (v) attrs.push([k, v]);
    }
    attrs.push(['Express ID', `#${id}`]);
    if (typeNames.length) attrs.push(['Typ', typeNames.join(', ')]);
    if (materials.length) attrs.push(['Materiál', materials.join(', ')]);
    if (!rec) { try { attrs.push(...spatialRows(id, cls)); } catch (e) { console.warn(e); } }
    root.appendChild(table('Atributy', attrs));
    if (!rec && ['IFCBUILDINGSTOREY', 'IFCBUILDING'].includes(U(cls))) {
      try { const sp = spacesIn(id); if (sp.length) root.appendChild(spaceSection(sp, val(item.Name) || '')); } catch (e) { console.warn(e); }
    }
    if (rec) try { const pos = geoElementRows(rec); if (pos.length) root.appendChild(table(S.geo?.ok ? 'Poloha v mapě' : 'Poloha v projektu', pos)); } catch (e) { console.warn(e); }

    const sorted = [...psets].sort((a, b) => {
      const qa = a.p.Quantities ? 1 : 0, qb = b.p.Quantities ? 1 : 0;
      return qa - qb || (a.from ? 1 : 0) - (b.from ? 1 : 0) || val(a.p.Name).localeCompare(val(b.p.Name), 'cs');
    });
    const seen = new Set();
    for (const { p: ps, from } of sorted) {
      if (seen.has(ps.expressID)) continue;
      seen.add(ps.expressID);
      const rows = propRows(ps);
      if (!rows.length) continue;
      root.appendChild(table(val(ps.Name) || 'Bez názvu', rows, ps.Quantities ? 'Množství' : from));
    }
    if (!sorted.length) root.appendChild(el('p', 'muted pad', 'Nemá žádné sady vlastností.'));
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

/* ---------- půdorys (rozdělená obrazovka) ---------- */
const planBox = $('#plan');
const planViewEl = $('#plan-view');
const planCanvas = $('#plan-canvas');
const planSvg = $('#plan-svg');
const planSel = $('#plan-storey');
const splitEl = $('#split');
const dividerEl = $('#divider');
const stageEl = document.querySelector('.stage');
const planCutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
let splitRatio = 0.55;
try { const r = Number(localStorage.getItem('ifc-nahled-split')); if (r > 0.15 && r < 0.9) splitRatio = r; } catch (e) { /* ignore */ }

function storeyFloors() {
  return S.storeys.filter((s) => s.id !== -1).map((s) => {
    const cut = storeyCutHeight(s);
    return cut == null ? null : { st: s, floor: cut - 1.2, cut };
  }).filter(Boolean).sort((a, b) => a.floor - b.floor);
}
function planStorey() {
  const fl = storeyFloors();
  if (!fl.length) return null;
  if (plan.storey !== 'auto') return fl.find((f) => String(f.st.id) === plan.storey) || fl[0];
  const y = camera.position.y;
  let pick = fl[0];
  for (const f of fl) if (f.floor <= y + 0.3) pick = f;
  return pick;
}
function fillPlanSelect() {
  planSel.replaceChildren();
  const o = el('option', null, 'Podle kamery'); o.value = 'auto'; planSel.appendChild(o);
  storeyFloors().slice().reverse().forEach((f) => { const op = el('option', null, f.st.name); op.value = String(f.st.id); planSel.appendChild(op); });
  planSel.value = plan.storey;
  if (planSel.value !== plan.storey) { plan.storey = 'auto'; planSel.value = 'auto'; }
}
/* výběr podlaží v půdorysu = vodorovný řez ve 3D 1,2 m nad podlahou */
function cutStoreyIn3D(f) {
  clip.mode = 'h';
  clip.flip.h = false;
  clip.vals.h = f.cut;
  const wasOn = S.clipOn;
  S.clipOn = true;
  if (!wasOn) S.clipPanel = false; // jen štítek nad lištou, panel nepřekáží
  applyClipMode(); updateClipUi(); updateToolbar();
  plan.autoClip = true;
}
planSel.addEventListener('change', () => {
  plan.storey = planSel.value; plan.dirty = true; updatePlan();
  if (plan.storey === 'auto') {
    if (plan.autoClip && S.clipOn) toggleClip(false);
    plan.autoClip = false;
    return;
  }
  const f = planStorey();
  if (!f) return;
  cutStoreyIn3D(f);
  toast(`Řez ${f.st.name}: 1,2 m nad podlahou`);
});
function markPlanDirty(delay = 120) {
  plan.dirty = true;
  if (plan.on) { clearTimeout(plan.timer); plan.timer = setTimeout(updatePlan, delay); }
}

/* rozložení: na šířku vedle sebe, na výšku pod sebou */
function layoutSplit() {
  const r = stageEl.getBoundingClientRect();
  const row = r.width >= r.height * 0.9;
  splitEl.classList.toggle('sp-row', row);
  splitEl.classList.toggle('sp-col', !row);
  dividerEl.setAttribute('aria-orientation', row ? 'vertical' : 'horizontal');
  splitEl.style.setProperty('--r3d', `${splitRatio}fr`);
  splitEl.style.setProperty('--rplan', `${1 - splitRatio}fr`);
}
new ResizeObserver(() => { if (plan.on) { layoutSplit(); markPlanDirty(200); } }).observe(stageEl);
function setSplit(r, save) {
  splitRatio = THREE.MathUtils.clamp(r, 0.2, 0.85);
  layoutSplit();
  if (save) { try { localStorage.setItem('ifc-nahled-split', String(splitRatio)); } catch (e) { /* ignore */ } }
}
dividerEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  dividerEl.setPointerCapture(e.pointerId);
  dividerEl.classList.add('dragging');
  const move = (ev) => {
    const r = splitEl.getBoundingClientRect();
    const row = splitEl.classList.contains('sp-row');
    setSplit(row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height, false);
  };
  const up = () => {
    dividerEl.classList.remove('dragging');
    dividerEl.removeEventListener('pointermove', move);
    dividerEl.removeEventListener('pointerup', up);
    dividerEl.removeEventListener('pointercancel', up);
    setSplit(splitRatio, true);
    markPlanDirty(0);
  };
  dividerEl.addEventListener('pointermove', move);
  dividerEl.addEventListener('pointerup', up);
  dividerEl.addEventListener('pointercancel', up);
});
dividerEl.addEventListener('dblclick', () => { setSplit(0.55, true); markPlanDirty(0); });
dividerEl.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
  if (d) { e.preventDefault(); setSplit(splitRatio + d, true); markPlanDirty(150); }
});

/* pohled půdorysu: střed (cx, cz) a měřítko ppm (px na metr) */
function planSize() { return { w: planViewEl.clientWidth, h: planViewEl.clientHeight }; }
/* orientace půdorysu: u = směr „nahoru“ na obrazovce (ve scéně XZ), r = „doprava“ */
function planAxes() {
  let ux = 0, uz = -1; // sever projektu (+Y v IFC = −Z ve scéně)
  if (plan.north === 'map' && typeof geoNorthScene === 'function') {
    const n = geoNorthScene();
    if (n) { ux = n.x; uz = n.z; }
  }
  return { ux, uz, rx: -uz, rz: ux };
}
function fitPlan() {
  const { w, h } = planSize();
  if (!w || !h || S.bbox.isEmpty()) return;
  const b = S.bbox, A = planAxes();
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
    const r = x * A.rx + z * A.rz, u = x * A.ux + z * A.uz;
    r0 = Math.min(r0, r); r1 = Math.max(r1, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
  }
  const mr = (r0 + r1) / 2, mu = (u0 + u1) / 2;
  const bw = (r1 - r0) * 1.08 || 1, bh = (u1 - u0) * 1.08 || 1;
  plan.view = { cx: mr * A.rx + mu * A.ux, cz: mr * A.rz + mu * A.uz, ppm: Math.min(w / bw, h / bh) };
  plan.fitPpm = plan.view.ppm;
}
function planXY(x, z) {
  const v = plan.view, { w, h } = planSize(), A = planAxes();
  const dx = x - v.cx, dz = z - v.cz;
  return { x: (dx * A.rx + dz * A.rz) * v.ppm + w / 2, y: -(dx * A.ux + dz * A.uz) * v.ppm + h / 2 };
}
function planWorld(px, py) {
  const v = plan.view, { w, h } = planSize(), A = planAxes();
  const a = (px - w / 2) / v.ppm, b = -(py - h / 2) / v.ppm;
  return { x: v.cx + a * A.rx + b * A.ux, z: v.cz + a * A.rz + b * A.uz };
}
/* posun středu pohledu o pixely obrazovky */
function panPlanBy(dxs, dys) {
  const v = plan.view, A = planAxes();
  v.cx += (-dxs * A.rx + dys * A.ux) / v.ppm;
  v.cz += (-dxs * A.rz + dys * A.uz) / v.ppm;
}
function applyPlanTransform() {
  const v = plan.view, im = plan.imgView;
  if (!v || !im) return;
  const { w, h } = planSize(), A = planAxes();
  const s = v.ppm / im.ppm;
  const ddx = im.cx - v.cx, ddz = im.cz - v.cz;
  const tx = w / 2 - s * im.w / 2 + (ddx * A.rx + ddz * A.rz) * v.ppm;
  const ty = h / 2 - s * im.h / 2 - (ddx * A.ux + ddz * A.uz) * v.ppm;
  planCanvas.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  updatePlanScale();
  updatePlanMarker();
}
function updatePlanScale() {
  const ppm = plan.view?.ppm;
  if (!ppm) return;
  const steps = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  const L = steps.find((m) => m * ppm >= 70) || steps[steps.length - 1];
  const sc = $('#plan-scale');
  sc.style.width = `${L * ppm}px`;
  sc.textContent = L < 1 ? `${L * 100} cm` : `${L} m`;
}

function renderPlanImage(f) {
  const { w, h } = planSize();
  if (!w || !h || S.bbox.isEmpty()) return;
  if (!plan.view) fitPlan();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (!plan.rt || plan.rt.width !== W || plan.rt.height !== H) {
    plan.rt?.dispose();
    plan.rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    plan.rt.texture.colorSpace = THREE.SRGBColorSpace;
  }
  const v = plan.view, b = S.bbox;
  const oc = plan.cam;
  oc.left = -w / 2 / v.ppm; oc.right = w / 2 / v.ppm; oc.top = h / 2 / v.ppm; oc.bottom = -h / 2 / v.ppm;
  oc.position.set(v.cx, b.max.y + 50, v.cz);
  const A = planAxes();
  oc.up.set(A.ux, 0, A.uz); // zvolený sever nahoře
  oc.lookAt(v.cx, b.min.y - 10, v.cz);
  oc.near = 1; oc.far = b.max.y - b.min.y + 100;
  oc.updateProjectionMatrix(); oc.updateMatrixWorld();
  planCutPlane.constant = f.cut;
  const prevBg = scene.background;
  scene.background = new THREE.Color(cssVar('--panel') || '#f8faf9');
  renderer.setRenderTarget(plan.rt);
  if (typeof setSpaceSide === 'function') setSpaceSide(true);
  renderer.clippingPlanes = [planCutPlane];
  renderer.clear();
  renderer.render(scene, oc);
  renderer.setRenderTarget(null);
  renderer.clippingPlanes = [];
  scene.background = prevBg;
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(plan.rt, 0, 0, W, H, px);
  planCanvas.width = W; planCanvas.height = H;
  planCanvas.style.width = `${w}px`; planCanvas.style.height = `${h}px`;
  const ctx = planCanvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  ctx.putImageData(img, 0, 0);
  plan.imgView = { ...v, w, h };
  applyPlanTransform();
  requestRender();
}
function updatePlan() {
  if (!plan.on || S.modelID == null) return;
  const f = planStorey();
  if (!f) { $('#plan-label').textContent = 'Model nemá podlaží'; return; }
  $('#plan-label').textContent = plan.storey === 'auto' ? f.st.name : '';
  if (plan.dirty || plan.shown !== f.st.id) {
    plan.shown = f.st.id; plan.dirty = false;
    renderPlanImage(f);
  }
  updatePlanMarker();
}
function updatePlanMarker() {
  if (!plan.on || !plan.view) return;
  if (plan.storey === 'auto') { const f = planStorey(); if (f && f.st.id !== plan.shown) { markPlanDirty(0); } }
  const p = planXY(camera.position.x, camera.position.z);
  const d = camera.getWorldDirection(new THREE.Vector3());
  const A = planAxes();
  const yaw = Math.atan2(-(d.x * A.ux + d.z * A.uz), d.x * A.rx + d.z * A.rz);
  const hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const L = 44;
  const a1 = { x: p.x + Math.cos(yaw - hf) * L, y: p.y + Math.sin(yaw - hf) * L };
  const a2 = { x: p.x + Math.cos(yaw + hf) * L, y: p.y + Math.sin(yaw + hf) * L };
  const { w, h } = planSize();
  const inside = p.x >= -20 && p.y >= -20 && p.x <= w + 20 && p.y <= h + 20;
  planSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  let html = '';
  if (S.data) html += dataPlanLabels();
  if (plan.shown != null) html += roomLabelsSvg(plan.shown);
  if (typeof geoPlanMarks === 'function') html += geoPlanMarks();
  if (inside) html += `<path d="M${p.x},${p.y} L${a1.x},${a1.y} A${L},${L} 0 0 1 ${a2.x},${a2.y} Z" class="pm-cone"/><circle cx="${p.x}" cy="${p.y}" r="7" class="pm-dot"/>`;
  planSvg.innerHTML = html;
  updatePlanNorth();
}
function togglePlan(force) {
  plan.on = force ?? !plan.on;
  splitEl.classList.toggle('on', plan.on);
  planBox.hidden = !plan.on;
  dividerEl.hidden = !plan.on;
  $('#btn-plan').setAttribute('aria-pressed', String(plan.on));
  if (plan.on) {
    layoutSplit();
    fillPlanSelect();
    plan.view = null; plan.dirty = true;
    requestAnimationFrame(() => { fitPlan(); updatePlan(); });
  }
}
/* severka v půdorysu: ukazuje sever mapy (je-li georeference), jinak sever projektu */
function updatePlanNorth() {
  const el2 = $('#plan-north-arrow');
  if (!el2 || !plan.view) return;
  const A = planAxes();
  const n = (typeof geoNorthScene === 'function' && geoNorthScene()) || { x: 0, z: -1 };
  const ang = Math.atan2(n.x * A.rx + n.z * A.rz, n.x * A.ux + n.z * A.uz) * 180 / Math.PI;
  el2.style.transform = `rotate(${ang}deg)`;
  $('#plan-north-label').textContent = S.geo?.ok ? 'S mapy' : 'S projektu';
}
$('#plan-orient').addEventListener('change', (e) => {
  plan.north = e.target.value;
  fitPlan(); markPlanDirty(0); applyPlanTransform();
});
planViewEl.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !plan.view) return;
  const p = localXY(e);
  const wp = planWorld(p.x, p.y);
  const f = planStorey();
  const out = $('#plan-coord');
  if (typeof geoFormatScene === 'function') {
    out.textContent = geoFormatScene(new THREE.Vector3(wp.x, f ? f.floor : 0, wp.z), true);
    out.hidden = false;
  }
});
planViewEl.addEventListener('pointerleave', () => { $('#plan-coord').hidden = true; });
$('#btn-plan').addEventListener('click', () => togglePlan());
$('#plan-close').addEventListener('click', () => togglePlan(false));
$('#plan-fit').addEventListener('click', () => { fitPlan(); markPlanDirty(0); applyPlanTransform(); });

/* ovládání půdorysu: tah = posun, dva prsty / kolečko = zoom, klepnutí = přesun kamery */
const pp = new Map();
let pDrag = null, pPinch = null;
function zoomPlanAt(px, py, k) {
  const v = plan.view;
  if (!v) return;
  const wpt = planWorld(px, py);
  const minP = (plan.fitPpm || v.ppm) / 3, maxP = 600;
  v.ppm = THREE.MathUtils.clamp(v.ppm * k, minP, maxP);
  const { w, h } = planSize(), A = planAxes();
  const a = (px - w / 2) / v.ppm, b = -(py - h / 2) / v.ppm;
  v.cx = wpt.x - a * A.rx - b * A.ux;
  v.cz = wpt.z - a * A.rz - b * A.uz;
  applyPlanTransform();
  markPlanDirty(180);
}
function localXY(e) { const r = planViewEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
planViewEl.addEventListener('pointerdown', (e) => {
  planViewEl.setPointerCapture(e.pointerId);
  pp.set(e.pointerId, localXY(e));
  if (pp.size === 1) { const p = localXY(e); pDrag = { x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false }; pPinch = null; }
  else if (pp.size === 2) { pDrag = null; pPinch = null; }
});
planViewEl.addEventListener('pointermove', (e) => {
  if (!pp.has(e.pointerId) || !plan.view) return;
  pp.set(e.pointerId, localXY(e));
  if (pp.size === 1 && pDrag) {
    const p = localXY(e);
    if (!pDrag.moved && Math.hypot(p.x - pDrag.sx, p.y - pDrag.sy) < 6) return;
    pDrag.moved = true;
    panPlanBy(p.x - pDrag.x, p.y - pDrag.y);
    pDrag.x = p.x; pDrag.y = p.y;
    applyPlanTransform();
    markPlanDirty(180);
  } else if (pp.size === 2) {
    const [a, b] = [...pp.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pPinch && d > 10) {
      panPlanBy(mid.x - pPinch.mid.x, mid.y - pPinch.mid.y);
      zoomPlanAt(mid.x, mid.y, d / pPinch.d);
    }
    pPinch = { mid, d };
  }
});
const planUp = (e) => {
  const wasTap = pp.size === 1 && pDrag && !pDrag.moved && e.type === 'pointerup';
  pp.delete(e.pointerId);
  pPinch = null;
  if (pp.size === 0) { const tap = wasTap; pDrag = null; if (tap) planTeleport(localXY(e)); }
  else pDrag = null;
};
planViewEl.addEventListener('pointerup', planUp);
planViewEl.addEventListener('pointercancel', planUp);
planViewEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = localXY(e);
  zoomPlanAt(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
}, { passive: false });
/* klepnutí: kamera na místo ve výšce očí (1,6 m nad podlahou), směr pohledu zůstane */
function planTeleport(p) {
  if (!plan.view) return;
  if (S.data?.info) { dataIdentifyPlan(p); return; }
  const wpt = planWorld(p.x, p.y);
  const f = planStorey();
  const eye = f ? f.floor + 1.6 : camera.position.y;
  const d = camera.getWorldDirection(new THREE.Vector3());
  d.y = 0;
  if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
  d.normalize();
  if (plan.storey === 'auto' && f) { plan.storey = String(f.st.id); planSel.value = plan.storey; }
  const pos = new THREE.Vector3(wpt.x, eye, wpt.z);
  tween(pos, pos.clone().addScaledVector(d, (S.minStep || 0.5) * 4), true);
}

/* ---------- georeference: IfcMapConversion ---------- */
const GEO_NUM = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v.value === 'number') return v.value;
    if (v._representationValue != null) return Number(v._representationValue);
    if (v._internalValue != null) return Number(v._internalValue);
    if (v.value != null && isFinite(Number(v.value))) return Number(v.value);
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const GEO_STR = (v) => (v == null ? '' : typeof v === 'object' ? String(v.value ?? v._representationValue ?? '') : String(v));
const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9 };
function unitFactor(u, depth = 0) { // metrů na jednotku
  if (!u || typeof u !== 'object' || depth > 4) return null;
  const name = GEO_STR(u.Name).toUpperCase();
  if (name === 'METRE') return SI_PREFIX[GEO_STR(u.Prefix).toUpperCase()] ?? 1;
  if (u.ConversionFactor) {
    const vc = GEO_NUM(u.ConversionFactor.ValueComponent);
    const base = unitFactor(u.ConversionFactor.UnitComponent, depth + 1) ?? 1;
    if (vc) return vc * base;
  }
  if (name === 'FOOT') return 0.3048;
  if (name === 'INCH') return 0.0254;
  return null;
}
function unitLabel(f) {
  if (f == null) return '—';
  const known = [[1, 'm'], [0.001, 'mm'], [0.01, 'cm'], [0.1, 'dm'], [0.3048, 'ft'], [0.0254, 'in'], [1000, 'km']];
  const k = known.find(([v]) => Math.abs(v - f) < 1e-9);
  return k ? k[1] : `${f} m`;
}

/* známé souřadnicové systémy pro převod do WGS84 (proj4) */
const KROVAK = '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs';
const EPSG_DEFS = {
  5514: ['S-JTSK / Krovak East North', KROVAK],
  5513: ['S-JTSK / Krovak (Y, X kladné)', KROVAK],
  2065: ['S-JTSK (Ferro) / Krovak (Y, X kladné)', KROVAK],
  28992: ['Amersfoort / RD New', '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs'],
  3857: ['WGS 84 / Pseudo-Mercator', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs'],
};
function epsgDef(code) {
  if (EPSG_DEFS[code]) return EPSG_DEFS[code];
  let m = String(code).match(/^(326|327|258)(\d\d)$/);
  if (m) {
    const zone = Number(m[2]), south = m[1] === '327', grs = m[1] === '258';
    return [`${grs ? 'ETRS89' : 'WGS 84'} / UTM ${zone}${south ? 'S' : 'N'}`, `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=${grs ? 'GRS80' : 'WGS84'} +units=m +no_defs`];
  }
  return null;
}
function detectEpsg(name, desc) {
  const t = `${name} ${desc}`;
  let m = t.match(/EPSG\D{0,3}(\d{4,6})/i) || String(name).trim().match(/^(\d{4,6})$/);
  if (m) return Number(m[1]);
  if (/JTSK|K[rř]ov[aá]k/i.test(t)) return /east\s*north|5514/i.test(t) ? 5514 : 5514;
  if (/amersfoort|rd\s*new/i.test(t)) return 28992;
  return null;
}

const GEO_FMT_KEY = 'ifc-nahled-geo-format';
let geoFormat = 'EN';
try { geoFormat = localStorage.getItem(GEO_FMT_KEY) || 'EN'; } catch (e) { /* ignore */ }

function jtskInRange(E, N) {
  const Y = Math.abs(E), X = Math.abs(N);
  return Y > 420000 && Y < 910000 && X > 930000 && X < 1240000;
}
function readGeoref(mid = S.modelID) {
  const api = S.api;
  const g = { ok: false, source: null, mc: null, crs: null, pu: 1, mu: null, trueNorth: null, wcsOffset: null, site: null, fix: false, checks: [] };
  // jednotky projektu
  try {
    const ua = api.GetLineIDsWithType(mid, WebIFC.IFCUNITASSIGNMENT);
    if (ua.size()) {
      const a = api.GetLine(mid, ua.get(0), true);
      const lu = (a.Units || []).find((u) => GEO_STR(u?.UnitType).toUpperCase() === 'LENGTHUNIT');
      g.pu = unitFactor(lu) ?? 1;
    }
  } catch (e) { /* default metre */ }
  // IFC4 / IFC4.3: IfcMapConversion (+ Scaled)
  const types = [WebIFC.IFCMAPCONVERSION, WebIFC.IFCMAPCONVERSIONSCALED].filter(Boolean);
  for (const T of types) {
    let ids;
    try { ids = api.GetLineIDsWithType(mid, T); } catch (e) { continue; }
    if (!ids || !ids.size()) continue;
    const mc = api.GetLine(mid, ids.get(0), true);
    const xa = GEO_NUM(mc.XAxisAbscissa), xo = GEO_NUM(mc.XAxisOrdinate);
    const sc = GEO_NUM(mc.Scale) ?? 1;
    g.mc = {
      E: GEO_NUM(mc.Eastings) ?? 0, N: GEO_NUM(mc.Northings) ?? 0, H: GEO_NUM(mc.OrthogonalHeight) ?? 0,
      xa: xa ?? 1, xo: xo ?? 0, scale: sc,
      scaleY: GEO_NUM(mc.ScaleY), scaleZ: GEO_NUM(mc.ScaleZ),
      fx: GEO_NUM(mc.FactorX), fy: GEO_NUM(mc.FactorY), fz: GEO_NUM(mc.FactorZ),
      entity: T === WebIFC.IFCMAPCONVERSIONSCALED ? 'IfcMapConversionScaled' : 'IfcMapConversion',
    };
    const c = mc.TargetCRS;
    if (c) {
      g.crs = {
        name: GEO_STR(c.Name), desc: GEO_STR(c.Description), geodetic: GEO_STR(c.GeodeticDatum), vertical: GEO_STR(c.VerticalDatum),
        projection: GEO_STR(c.MapProjection), zone: GEO_STR(c.MapZone), mapUnit: c.MapUnit ? unitFactor(c.MapUnit) : null,
      };
    }
    const ctx = mc.SourceCRS;
    if (ctx?.TrueNorth?.DirectionRatios) g.trueNorth = ctx.TrueNorth.DirectionRatios.map(GEO_NUM);
    const loc = ctx?.WorldCoordinateSystem?.Location?.Coordinates;
    if (loc) { const o = loc.map(GEO_NUM); if (o.some((v) => Math.abs(v) > 1e-6)) g.wcsOffset = o; }
    g.source = `${g.mc.entity} (${S.meta?.schema || 'IFC4'})`;
    break;
  }
  // IFC2x3: ePSet_MapConversion / ePSet_ProjectedCRS
  if (!g.mc) {
    try {
      const ids = api.GetLineIDsWithType(mid, WebIFC.IFCPROPERTYSET);
      let mcP = null, crsP = null;
      for (let i = 0; i < ids.size() && !(mcP && crsP); i++) {
        const l = api.GetLine(mid, ids.get(i), false);
        const n = GEO_STR(l.Name).toLowerCase();
        if (n === 'epset_mapconversion') mcP = api.GetLine(mid, ids.get(i), true);
        else if (n === 'epset_projectedcrs') crsP = api.GetLine(mid, ids.get(i), true);
      }
      const props = (ps) => Object.fromEntries((ps?.HasProperties || []).map((p) => [GEO_STR(p.Name), p.NominalValue]));
      if (mcP) {
        const P = props(mcP);
        g.mc = {
          E: GEO_NUM(P.Eastings) ?? 0, N: GEO_NUM(P.Northings) ?? 0, H: GEO_NUM(P.OrthogonalHeight) ?? 0,
          xa: GEO_NUM(P.XAxisAbscissa) ?? 1, xo: GEO_NUM(P.XAxisOrdinate) ?? 0, scale: GEO_NUM(P.Scale) ?? 1,
          entity: 'ePSet_MapConversion',
        };
        g.source = `ePSet_MapConversion (${S.meta?.schema || 'IFC2X3'})`;
      }
      if (crsP) {
        const P = props(crsP);
        g.crs = { name: GEO_STR(P.Name), desc: GEO_STR(P.Description), geodetic: GEO_STR(P.GeodeticDatum), vertical: GEO_STR(P.VerticalDatum),
          projection: GEO_STR(P.MapProjection), zone: GEO_STR(P.MapZone), mapUnit: null };
      }
    } catch (e) { console.warn('ePSet_MapConversion', e); }
  }
  // TrueNorth i bez MapConversion
  if (!g.trueNorth) {
    try {
      const ids = api.GetLineIDsWithType(mid, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT);
      for (let i = 0; i < ids.size(); i++) {
        const c = api.GetLine(mid, ids.get(i), true);
        if (c?.TrueNorth?.DirectionRatios) { g.trueNorth = c.TrueNorth.DirectionRatios.map(GEO_NUM); break; }
      }
    } catch (e) { /* ignore */ }
  }
  // IfcSite RefLatitude / RefLongitude
  try {
    const ids = api.GetLineIDsWithType(mid, WebIFC.IFCSITE);
    if (ids.size()) {
      const s0 = api.GetLine(mid, ids.get(0), false);
      const dms = (a) => { const v = Array.isArray(a) ? a : a?.value; return Array.isArray(v) && v.length >= 3 ? v.map(GEO_NUM) : null; };
      const toDeg = (a) => a && (a[0] + a[1] / 60 + a[2] / 3600 + (a[3] || 0) / 3.6e9);
      const la = dms(s0.RefLatitude), lo = dms(s0.RefLongitude);
      if (la && lo) g.site = { lat: toDeg(la), lon: toDeg(lo), elev: GEO_NUM(s0.RefElevation) };
    }
  } catch (e) { /* ignore */ }

  g.mu = g.crs?.mapUnit ?? g.pu;
  g.muInferred = null;
  // MapUnit nevyplněné: podle normy platí jednotky projektu, ale exportéry běžně
  // zapisují Eastings v metrech a rozdíl jednotek vyrovnají přes Scale (mm projekt → Scale 0,001).
  // Jednotku mapy proto odvodíme ze Scale: Scale = jednotka projektu / jednotka mapy.
  if (g.mc && g.crs?.mapUnit == null) {
    const sx0 = g.mc.fx ?? g.mc.scale;
    if (sx0 > 0) {
      const cand = g.pu / sx0;
      const snap = [1, 0.001, 0.01, 0.1, 0.3048, 0.0254, 1000].find((u) => Math.abs(cand / u - 1) < 0.01);
      if (snap != null && Math.abs(snap / g.pu - 1) > 1e-9) { g.mu = snap; g.muInferred = 'scale'; }
    }
  }
  g.epsg = g.crs ? detectEpsg(g.crs.name, g.crs.desc) : null;
  g.def = g.epsg ? epsgDef(g.epsg) : null;
  g.jtsk = [5514, 5513, 2065].includes(g.epsg);
  // S-JTSK: když vychází počátek mimo ČR a v metrech by seděl, jsou Eastings/Northings v metrech
  if (g.mc && g.jtsk && g.crs?.mapUnit == null && !g.muInferred && !jtskInRange(g.mc.E * g.mu, g.mc.N * g.mu) && jtskInRange(g.mc.E, g.mc.N)) {
    g.mu = 1; g.muInferred = 'range';
  }
  g.jtskPositive = g.jtsk && g.mc && (g.mc.E > 0 || g.mc.N > 0);
  if (g.def) { try { proj4.defs(`EPSG:${g.epsg}`, g.def[1]); } catch (e) { g.def = null; } }
  g.ok = !!g.mc;
  // jednotky: Scale má kompenzovat rozdíl jednotek projektu a mapy
  const sx = g.mc ? (g.mc.fx ?? g.mc.scale) : 1;
  g.unitMismatch = g.mc && Math.abs(g.pu / g.mu - 1) > 1e-9 && Math.abs(sx - g.pu / g.mu) > Math.abs(sx) * 0.01;
  return g;
}

/* lokální souřadnice IFC (m) → mapové (m, v ose CRS) */
function geoMapFromLocal(l, g = S.geo) {
  if (!g?.ok) return null;
  const m = g.mc;
  const th = Math.atan2(m.xo, m.xa);
  const c = Math.cos(th), s = Math.sin(th);
  if (g.fix) {
    // oprava: Eastings/Northings/H v metrech, lokální souřadnice převedené na metry, bez Scale
    return { E: m.E + l.x * c - l.y * s, N: m.N + l.x * s + l.y * c, H: m.H + l.z };
  }
  const pu = g.pu, mu = g.mu;
  const x = l.x / pu, y = l.y / pu, z = l.z / pu; // v jednotkách projektu
  const sx = (m.fx ?? 1) * m.scale, sy = (m.fy ?? 1) * (m.scaleY ?? m.scale), sz = (m.fz ?? 1) * (m.scaleZ ?? m.scale);
  return {
    E: (m.E + sx * (x * c - y * s)) * mu,
    N: (m.N + sy * (x * s + y * c)) * mu,
    H: (m.H + sz * z) * mu,
  };
}
function geoLocalFromScene(p) { return toIfcPoint(p); }
function geoMapFromScene(p) { return geoMapFromLocal(geoLocalFromScene(p)); }
function geoToWgs(E, N) {
  const g = S.geo;
  if (!g?.def) return null;
  try {
    const [lon, lat] = proj4(`EPSG:${g.epsg}`, 'EPSG:4326', g.jtskPositive || g.epsg === 5513 || g.epsg === 2065 ? [-E, -N] : [E, N]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) { return null; }
}
function geoFromWgs(lon, lat) {
  const g = S.geo;
  const [e, n] = proj4('EPSG:4326', `EPSG:${g.epsg}`, [lon, lat]);
  return g.jtskPositive || g.epsg === 5513 || g.epsg === 2065 ? { E: -e, N: -n } : { E: e, N: n };
}
/* sever mapy (osa N) jako směr ve scéně */
function geoNorthScene() {
  const g = S.geo;
  if (!g?.ok) return null;
  const th = Math.atan2(g.mc.xo, g.mc.xa);
  const sign = g.jtskPositive ? -1 : 1; // v Y/X (kladné) míří osa X na jih
  const d = toSceneDir(new THREE.Vector3(Math.sin(th) * sign, Math.cos(th) * sign, 0));
  d.y = 0;
  if (d.lengthSq() < 1e-9) return null;
  d.normalize();
  return { x: d.x, z: d.z };
}
/* konvergence poledníků a očekávaný TrueNorth v počátku */
function geoTrueNorthExpected() {
  const g = S.geo;
  if (!g?.ok || !g.def) return null;
  const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
  const w = geoToWgs(o.E, o.N);
  if (!w) return null;
  const q = geoFromWgs(w.lon, w.lat + 0.0005);
  let vE = q.E - o.E, vN = q.N - o.N;
  const L = Math.hypot(vE, vN); vE /= L; vN /= L;
  const th = Math.atan2(g.mc.xo, g.mc.xa);
  // R(−θ)·v → směr skutečného severu v lokálních osách
  const lx = vE * Math.cos(th) + vN * Math.sin(th), ly = -vE * Math.sin(th) + vN * Math.cos(th);
  const conv = Math.atan2(vE, vN) * 180 / Math.PI; // úhel mezi severem mapy a skutečným severem
  return { lx, ly, conv };
}
const angDeg = (x, y) => Math.atan2(y, x) * 180 / Math.PI;
const nf3s = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: true });
const nf6 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const nfAng = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const raw3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
function geoLabels() {
  const g = S.geo;
  const vert = g?.crs?.vertical || (g?.jtsk ? 'Bpv' : '');
  const H = vert ? `H (${vert})` : 'H';
  if (g?.jtsk && geoFormat === 'YX') return ['Y', 'X', H];
  return ['E', 'N', H];
}
/* hodnoty v aktuálním formátu: E/N, nebo Y/X kladné pro S-JTSK */
function geoValues(m) {
  const g = S.geo;
  if (g?.jtsk && geoFormat === 'YX') return g.jtskPositive ? [m.E, m.N, m.H] : [-m.E, -m.N, m.H];
  if (g?.jtskPositive) return [-m.E, -m.N, m.H];
  return [m.E, m.N, m.H];
}
function geoFormatScene(p, short) {
  const g = S.geo;
  if (g?.ok) {
    const [a, b, c] = geoValues(geoMapFromScene(p));
    const [la, lb] = geoLabels();
    return short ? `${la} ${nf3s.format(a)}   ${lb} ${nf3s.format(b)}` : `${la} ${nf3s.format(a)} · ${lb} ${nf3s.format(b)} · H ${nf3s.format(c)}`;
  }
  const l = geoLocalFromScene(p);
  return short ? `x ${nf3s.format(l.x)}   y ${nf3s.format(l.y)}` : `x ${nf3s.format(l.x)} · y ${nf3s.format(l.y)} · z ${nf3s.format(l.z)}`;
}

function runGeoChecks() {
  const g = S.geo, out = [];
  const add = (level, title, text) => out.push({ level, title, text });
  if (!g.ok) {
    add('warn', 'Model není georeferencovaný', 'Soubor neobsahuje IfcMapConversion ani ePSet_MapConversion. Souřadnice se zobrazují jen v lokálním systému projektu.');
    if (g.site) add('info', 'IfcSite má zeměpisnou polohu', `RefLatitude/RefLongitude: ${nf6.format(g.site.lat)}°, ${nf6.format(g.site.lon)}°. Pro přesnou georeferenci to nestačí, chybí natočení a mapové souřadnice.`);
    return out;
  }
  if (!g.crs?.name) add('warn', 'Chybí cílový souřadnicový systém', 'IfcProjectedCRS nemá vyplněný Name (např. EPSG:5514).');
  else if (!g.epsg) add('warn', 'Neznámý souřadnicový systém', `„${g.crs.name}“ neumím převést do WGS84. Mapové souřadnice se zobrazují, odkaz na mapu ne.`);
  else add('ok', `Souřadnicový systém EPSG:${g.epsg}`, g.def ? g.def[0] : '');
  // jednotky
  if (g.unitMismatch) {
    add('warn', 'Nesoulad jednotek', `Projekt je v ${unitLabel(g.pu)}, mapa v ${unitLabel(g.mu)}, ale Scale = ${nf.format(g.mc.scale)}. Správně by Scale mělo být ${nf.format(g.pu / g.mu)}. Souřadnice prvků proto můžou vycházet ${nf.format(Math.max(g.pu / g.mu, g.mu / g.pu))}× špatně. Zkuste přepínač „Opravit jednotky“.`);
  } else {
    add('ok', 'Jednotky', `Projekt ${unitLabel(g.pu)}, mapa ${unitLabel(g.mu)}, Scale ${nf.format(g.mc.scale)}.`);
  }
  if (g.muInferred === 'scale') add('info', 'MapUnit není vyplněné', `IfcProjectedCRS nemá MapUnit. Podle normy by Eastings/Northings byly v jednotkách projektu (${unitLabel(g.pu)}), ale Scale ${nf.format(g.mc.scale)} ukazuje na mapu v ${unitLabel(g.mu)}. Aplikace proto počítá s ${unitLabel(g.mu)}. Doporučení: v exportu vyplnit MapUnit.`);
  if (g.muInferred === 'range') add('warn', 'MapUnit není vyplněné', `IfcProjectedCRS nemá MapUnit a Eastings/Northings v jednotkách projektu (${unitLabel(g.pu)}) by ležely mimo ČR. Aplikace je vykládá v metrech. Doporučení: v exportu vyplnit MapUnit.`);
  if (!g.unitMismatch && Math.abs(g.mc.scale - g.pu / g.mu) > 1e-9 && Math.abs(g.mc.scale - 1) < 0.01) {
    add('info', 'Měřítko ≠ 1', `Scale ${nf.format(g.mc.scale)} pravděpodobně zahrnuje měřítkový faktor zobrazení.`);
  }
  // S-JTSK
  if (g.jtsk) {
    if (g.jtskPositive && g.epsg === 5514) add('warn', 'Kladné souřadnice v EPSG:5514', 'EPSG:5514 (East-North) má na území ČR záporné souřadnice. Kladné hodnoty odpovídají Y/X (EPSG:5513). Aplikace je vykládá jako Y/X.');
    const [Y, X] = (g.jtskPositive ? [g.mc.E, g.mc.N] : [-g.mc.E, -g.mc.N]).map((v) => v * (g.fix ? 1 : g.mu));
    if (Y < 420000 || Y > 910000 || X < 930000 || X > 1240000) add('warn', 'Počátek mimo území ČR', `Y ${nf3s.format(Y)}, X ${nf3s.format(X)} neleží v rozsahu S-JTSK pro ČR. Zkontrolujte jednotky a znaménka.`);
    else add('ok', 'Poloha v rozsahu S-JTSK', `Y ${nf3s.format(Y)}, X ${nf3s.format(X)}.`);
  }
  // WGS84 vs IfcSite
  const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
  const w = geoToWgs(o.E, o.N);
  if (w && g.site) {
    const R = 6371000, dLat = (g.site.lat - w.lat) * Math.PI / 180, dLon = (g.site.lon - w.lon) * Math.PI / 180 * Math.cos(w.lat * Math.PI / 180);
    const d = R * Math.hypot(dLat, dLon);
    if (d > 50) add('warn', 'IfcSite neodpovídá MapConversion', `RefLatitude/RefLongitude v IfcSite leží ${nf.format(Math.round(d))} m od počátku spočteného z IfcMapConversion.`);
    else add('ok', 'IfcSite odpovídá MapConversion', `Rozdíl polohy ${nf.format(Math.round(d * 10) / 10)} m.`);
  } else if (!g.site) add('info', 'IfcSite bez zeměpisné polohy', 'RefLatitude/RefLongitude nejsou vyplněné. Pro georeferenci to nevadí, rozhoduje IfcMapConversion.');
  // TrueNorth
  const ex = geoTrueNorthExpected();
  if (g.trueNorth && ex) {
    const a1 = angDeg(g.trueNorth[0], g.trueNorth[1]), a2 = angDeg(ex.lx, ex.ly);
    let d = Math.abs(((a1 - a2 + 540) % 360) - 180);
    if (d > 1) add('warn', 'TrueNorth nesouhlasí s MapConversion', `TrueNorth v kontextu míří na ${nfAng.format(a1)}°, z natočení MapConversion a konvergence poledníků (${nfAng.format(ex.conv)}°) vychází ${nfAng.format(a2)}°. Rozdíl ${nfAng.format(d)}°.`);
    else add('ok', 'TrueNorth souhlasí', `Rozdíl ${nfAng.format(d)}° (konvergence poledníků ${nfAng.format(ex.conv)}°).`);
  } else if (!g.trueNorth) add('info', 'TrueNorth není vyplněný', 'Kontext nemá TrueNorth. Pro souřadnice to nevadí.');
  if (g.wcsOffset) add('info', 'WCS kontextu není v počátku', `WorldCoordinateSystem je posunutý o (${g.wcsOffset.map((v) => nf.format(v)).join('; ')}).`);
  return out;
}

/* ---------- panel Geo ---------- */
function geoTable(title, rows) {
  const sec = el('section', 'pset');
  sec.appendChild(el('h3', 'pset-title', title));
  const dl = el('dl', 'kv');
  rows.filter(Boolean).forEach(([k, v, mono]) => { dl.append(el('dt', null, k), el('dd', v ? (mono ? 'mono' : null) : 'kv-empty', v || '—')); });
  sec.appendChild(dl);
  return sec;
}
function seg(options, value, onChange, label) {
  const w = el('div', 'seg geo-seg');
  w.setAttribute('role', 'group');
  if (label) w.setAttribute('aria-label', label);
  options.forEach(([v, t]) => {
    const b = el('button', null, t); b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', () => onChange(v));
    w.appendChild(b);
  });
  return w;
}
function mapLinks(w) {
  const wrap = el('div', 'geo-links');
  const a1 = el('a', 'sbtn', 'Mapy.cz'); a1.href = `https://mapy.cz/zakladni?x=${w.lon.toFixed(7)}&y=${w.lat.toFixed(7)}&z=19&source=coor&id=${w.lon.toFixed(7)}%2C${w.lat.toFixed(7)}`; a1.target = '_blank'; a1.rel = 'noopener';
  const a2 = el('a', 'sbtn', 'Google Maps'); a2.href = `https://www.google.com/maps?q=${w.lat.toFixed(7)},${w.lon.toFixed(7)}`; a2.target = '_blank'; a2.rel = 'noopener';
  wrap.append(a1, a2);
  return wrap;
}
function renderGeo() {
  try { renderGeoInner(); } catch (e) {
    console.error(e);
    const root = $('#panel-geo');
    if (root) root.replaceChildren(el('p', 'muted pad', `Záložku Geo se nepodařilo zobrazit: ${e.message}`));
  }
}
function renderGeoInner() {
  const root = $('#panel-geo');
  if (!root) return;
  root.replaceChildren();
  if (S.modelID == null || !S.geo) { root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor.')); return; }
  const g = S.geo;
  const head = el('div', 'summary');
  const st = el('div', 'geo-status ' + (g.ok ? 'is-ok' : 'is-none'));
  st.append(el('span', 'geo-dot'), el('span', null, g.ok ? 'Georeferencováno' : 'Bez georeference'));
  head.appendChild(st);
  head.appendChild(el('p', 'muted small geo-src', g.ok ? `Zdroj: ${g.source}` : 'Souřadnice se zobrazují v lokálním systému projektu.'));
  if (g.jtsk) {
    head.appendChild(seg([['EN', 'E/N (EPSG:5514)'], ['YX', 'Y/X kladné']], geoFormat, (v) => {
      geoFormat = v; try { localStorage.setItem(GEO_FMT_KEY, v); } catch (e) { /* ignore */ }
      renderGeo(); renderProps(); updateCoordBar();
    }, 'Formát souřadnic'));
  }
  if (g.unitMismatch) {
    head.appendChild(el('p', 'small geo-fixnote', 'Jednotky v souboru nesedí. Vyberte výklad:'));
    head.appendChild(seg([['file', 'Podle souboru'], ['fix', 'Opravit jednotky']], g.fix ? 'fix' : 'file', (v) => {
      g.fix = v === 'fix'; g.checks = runGeoChecks(); renderGeo(); renderProps(); updateCoordBar(); markPlanDirty(0);
    }, 'Výklad jednotek'));
  }
  root.appendChild(head);

  if (g.ok) {
    const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
    const [a, b, c] = geoValues(o);
    const [la, lb, lc] = geoLabels();
    const w = geoToWgs(o.E, o.N);
    const sec = geoTable('Počátek projektu (0, 0, 0)', [
      [la, nf3s.format(a), true], [lb, nf3s.format(b), true], [lc, nf3s.format(c), true],
      w && ['WGS84', `${nf6.format(w.lat)}° N, ${nf6.format(w.lon)}° E`, true],
    ]);
    if (w) sec.appendChild(mapLinks(w));
    root.appendChild(sec);
    const m = g.mc, th = Math.atan2(m.xo, m.xa) * 180 / Math.PI;
    root.appendChild(geoTable(m.entity, [
      ['Eastings', nf3s.format(m.E), true], ['Northings', nf3s.format(m.N), true], ['OrthogonalHeight', nf3s.format(m.H), true],
      ['XAxisAbscissa', String(m.xa), true], ['XAxisOrdinate', String(m.xo), true],
      ['Natočení osy x', `${nfAng.format(th)}° (od osy E proti směru hodin)`],
      ['Scale', nf.format(m.scale), true],
      m.scaleY != null && ['ScaleY', nf.format(m.scaleY), true], m.scaleZ != null && ['ScaleZ', nf.format(m.scaleZ), true],
      m.fx != null && ['FactorX / Y / Z', `${nf.format(m.fx)} / ${nf.format(m.fy ?? 1)} / ${nf.format(m.fz ?? 1)}`, true],
    ]));
    if (g.crs) {
      root.appendChild(geoTable('IfcProjectedCRS', [
        ['Name', g.crs.name], ['Description', g.crs.desc], ['GeodeticDatum', g.crs.geodetic], ['VerticalDatum', g.crs.vertical],
        g.crs.projection && ['MapProjection', g.crs.projection], g.crs.zone && ['MapZone', g.crs.zone],
        ['MapUnit', g.crs.mapUnit != null ? unitLabel(g.crs.mapUnit) : g.muInferred ? `— (nevyplněno, odvozeno: ${unitLabel(g.mu)})` : '— (platí jednotky projektu)'],
      ]));
    }
    const ex = geoTrueNorthExpected();
    root.appendChild(geoTable('Jednotky a sever', [
      ['Jednotky projektu', unitLabel(g.pu)], ['Jednotky mapy', unitLabel(g.mu)],
      ['TrueNorth (kontext)', g.trueNorth ? `${nfAng.format(angDeg(g.trueNorth[0], g.trueNorth[1]))}° (${g.trueNorth.map((v) => nf.format(v)).join('; ')})` : ''],
      ex && ['Konvergence poledníků', `${nfAng.format(ex.conv)}°`],
      ex && ['TrueNorth podle MapConversion', `${nfAng.format(angDeg(ex.lx, ex.ly))}°`],
    ]));
  }
  // kontroly
  const cs = el('section', 'pset');
  cs.appendChild(el('h3', 'pset-title', 'Kontroly'));
  const ul = el('ul', 'checks');
  g.checks.forEach((c) => {
    const li = el('li', `check is-${c.level}`);
    li.append(el('span', 'check-pill', c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'Pozor' : 'Info'));
    const t = el('div', 'check-body');
    t.append(el('strong', null, c.title));
    if (c.text) t.append(el('span', null, c.text));
    li.appendChild(t);
    ul.appendChild(li);
  });
  cs.appendChild(ul);
  root.appendChild(cs);
  // body
  root.appendChild(renderGeoPoints());
}

/* ---------- body (nástroj Souřadnice) ---------- */
function geoPointRow(pt) {
  if (S.geo?.ok) {
    const [a, b, c] = geoValues(geoMapFromScene(pt.p));
    return [a, b, c];
  }
  const l = geoLocalFromScene(pt.p);
  return [l.x, l.y, l.z];
}
function geoHeader() {
  if (S.geo?.ok) { const [a, b, c] = geoLabels(); return [a, b, c.replace(/\s.*$/, '')]; }
  return ['x', 'y', 'z'];
}
function renderGeoPoints() {
  const sec = el('section', 'pset');
  const h = el('h3', 'pset-title', `Body (${geoPts.length})`);
  sec.appendChild(h);
  if (!geoPts.length) {
    sec.appendChild(el('p', 'muted pad small', 'Zapněte nástroj Souřadnice v liště a klepejte do modelu. Body se přichytávají k rohům prvků.'));
    return sec;
  }
  const [ha, hb, hc] = geoHeader();
  const tbl = el('div', 'pts-wrap');
  const t = el('table', 'pts');
  const thead = el('tr');
  ['', ha, hb, hc, ''].forEach((x) => thead.appendChild(el('th', null, x)));
  t.appendChild(thead);
  geoPts.forEach((pt, i) => {
    const tr = el('tr');
    const [a, b, c] = geoPointRow(pt);
    tr.append(el('td', 'pt-id', pt.name), el('td', null, nf3s.format(a)), el('td', null, nf3s.format(b)), el('td', null, nf3s.format(c)));
    const td = el('td');
    const del = el('button', 'ib small-ib', null); del.type = 'button';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.setAttribute('aria-label', `Smazat bod ${pt.name}`);
    del.addEventListener('click', () => { removeGeoPoint(i); });
    td.appendChild(del);
    tr.appendChild(td);
    if (pt.el) tr.title = pt.el;
    t.appendChild(tr);
  });
  tbl.appendChild(t);
  sec.appendChild(tbl);
  const bar = el('div', 'bcf-bar pts-bar');
  const cp = el('button', 'sbtn', 'Kopírovat'); cp.type = 'button';
  cp.addEventListener('click', async () => {
    const txt = geoPts.map((pt) => [pt.name, ...geoPointRow(pt).map(raw3)].join('\t')).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Souřadnice zkopírovány (oddělené tabulátorem)'); } catch (e) { toast('Kopírování se nepovedlo.', true); }
  });
  const ex = el('button', 'sbtn', 'Export CSV'); ex.type = 'button';
  ex.addEventListener('click', exportGeoCsv);
  const clr = el('button', 'sbtn', 'Smazat body'); clr.type = 'button';
  clr.addEventListener('click', clearGeoPoints);
  bar.append(cp, ex, clr);
  sec.appendChild(bar);
  return sec;
}
async function exportGeoCsv() {
  const [ha, hb, hc] = geoHeader();
  const crs = S.geo?.ok ? (S.geo.epsg ? `EPSG:${S.geo.epsg}${S.geo.jtsk && geoFormat === 'YX' ? ' (Y/X kladne)' : ''}` : S.geo.crs?.name || '') : 'lokalni';
  const lines = [`bod,${ha},${hb},${hc},prvek,globalid,crs`];
  geoPts.forEach((pt) => {
    const q = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
    lines.push([pt.name, ...geoPointRow(pt).map(raw3), q(pt.el), pt.gid || '', crs].join(','));
  });
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  await saveFile(`${base}-body.csv`, new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
}
function geoPointElName(id) {
  const rec = S.elements.get(id);
  if (!rec) return '';
  try { return S.api.GetLine(S.modelID, id)?.Name?.value || classLabel(rec.cls); } catch (e) { return rec.cls; }
}
function addGeoPoint(hit, sx, sy) {
  const { p, snap } = snapPoint(hit, sx, sy);
  const id = hit.object.userData.id;
  const n = (geoPts.at(-1)?.n || 0) + 1;
  const pt = { n, name: `B${n}`, p, snap, el: geoPointElName(id), gid: guidOf(id) };
  pt.dot = el('div', 'mdot gdot' + (snap ? ' snap' : ''));
  pt.label = el('div', 'glabel', pt.name);
  overlay.append(pt.dot, pt.label);
  geoPts.push(pt);
  updateCoordBar(pt);
  if (!$('#panel-geo').hidden) renderGeo();
  if (plan.on) updatePlanMarker();
  requestRender();
}
function removeGeoPoint(i) {
  const pt = geoPts[i];
  pt.dot.remove(); pt.label.remove();
  geoPts.splice(i, 1);
  renderGeo(); updateCoordBar(); requestRender();
  if (plan.on) updatePlanMarker();
}
function clearGeoPoints() {
  geoPts.splice(0).forEach((pt) => { pt.dot.remove(); pt.label.remove(); });
  renderGeo(); updateCoordBar(); requestRender();
  if (plan.on) updatePlanMarker();
}
function placeGeoOverlay() {
  for (const pt of geoPts) {
    const s1 = toScreen(pt.p);
    pt.dot.hidden = !s1.ok; pt.label.hidden = !s1.ok;
    pt.dot.style.left = `${s1.x}px`; pt.dot.style.top = `${s1.y}px`;
    pt.label.style.left = `${s1.x + 10}px`; pt.label.style.top = `${s1.y - 10}px`;
  }
}
function geoPlanMarks() {
  if (!plan.view) return '';
  return geoPts.map((pt) => {
    const q = planXY(pt.p.x, pt.p.z);
    return `<circle cx="${q.x}" cy="${q.y}" r="4.5" class="pg-dot"/><text x="${q.x + 7}" y="${q.y - 6}" class="pg-txt">${pt.name}</text>`;
  }).join('');
}
function updateCoordBar(pt) {
  const bar = $('#coord-bar');
  if (!coord.on) { bar.hidden = true; return; }
  bar.hidden = false;
  const last = pt || geoPts.at(-1);
  if (!last) {
    $('#c-main').textContent = 'Klepněte do modelu';
    $('#c-sub').textContent = S.geo?.ok ? `Souřadnice v ${S.geo.epsg ? 'EPSG:' + S.geo.epsg : 'mapovém systému'}, body se přichytávají k rohům.` : 'Model není georeferencovaný, zobrazí se lokální souřadnice.';
    return;
  }
  const [a, b, c] = geoPointRow(last);
  const [la, lb, lc] = geoHeader();
  $('#c-main').textContent = `${last.name}  ${la} ${nf3s.format(a)}  ${lb} ${nf3s.format(b)}`;
  $('#c-sub').textContent = `${lc} ${nf3s.format(c)}${last.el ? ' · ' + last.el : ''}${last.snap ? ' · roh' : ''}`;
}
function toggleCoord(force) {
  coord.on = force ?? !coord.on;
  if (coord.on && S.measure.on) toggleMeasure(false);
  if (coord.on && S.selected != null) deselect();
  $('#btn-coord').setAttribute('aria-pressed', String(coord.on));
  updateCoordBar();
}
$('#btn-coord').addEventListener('click', () => toggleCoord());
$('#c-done').addEventListener('click', () => toggleCoord(false));
$('#c-copy').addEventListener('click', async () => {
  const last = geoPts.at(-1);
  if (!last) return;
  const txt = geoPointRow(last).map(raw3).join('\t');
  try { await navigator.clipboard.writeText(txt); toast(`${last.name} zkopírován`); } catch (e) { toast('Kopírování se nepovedlo.', true); }
});

/* ---------- kompas ve 3D ---------- */
function updateCompass() {
  const cEl = $('#compass');
  if (!cEl) return;
  if (S.modelID == null) { cEl.hidden = true; return; }
  const n = geoNorthScene() || { x: 0, z: -1 };
  const T = controls.target;
  const a = toScreen(T), b = toScreen(new THREE.Vector3(T.x + n.x * 5, T.y, T.z + n.z * 5));
  const ang = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
  cEl.hidden = false;
  $('#compass-needle').style.transform = `rotate(${ang}deg)`;
  cEl.title = S.geo?.ok ? 'Sever mapy' : 'Sever projektu (model není georeferencovaný)';
}

/* poloha vybraného prvku pro panel Vlastnosti */
function geoElementRows(rec) {
  const b = boxOf(rec.meshes);
  if (b.isEmpty()) return [];
  const c = b.getCenter(new THREE.Vector3());
  const bottom = new THREE.Vector3(c.x, b.min.y, c.z), top = new THREE.Vector3(c.x, b.max.y, c.z);
  if (S.geo?.ok) {
    const [a1, b1, h0] = geoValues(geoMapFromScene(bottom));
    const h1 = geoMapFromScene(top).H;
    const [la, lb, lc] = geoLabels();
    const w = geoToWgs(geoMapFromScene(bottom).E, geoMapFromScene(bottom).N);
    return [[`Střed ${la}`, nf3s.format(a1)], [`Střed ${lb}`, nf3s.format(b1)], [`${lc} spodní hrana`, nf3s.format(h0)], [`${lc} horní hrana`, nf3s.format(h1)],
      w ? ['WGS84', `${nf6.format(w.lat)}°, ${nf6.format(w.lon)}°`] : null].filter(Boolean);
  }
  const l0 = geoLocalFromScene(bottom), l1 = geoLocalFromScene(top);
  return [['Střed x', nf3s.format(l0.x)], ['Střed y', nf3s.format(l0.y)], ['z spodní hrana', nf3s.format(l0.z)], ['z horní hrana', nf3s.format(l1.z)]];
}
function geoOnModelLoaded() {
  try { S.geo = readGeoref(); S.geo.checks = runGeoChecks(); } catch (e) { console.warn('Georeference', e); S.geo = { ok: false, checks: [] }; }
  clearGeoPoints();
  $('#plan-orient').hidden = !S.geo.ok;
  if (!S.geo.ok) { plan.north = 'project'; $('#plan-orient').value = 'project'; }
  const warn = S.geo.checks.some((c) => c.level === 'warn') && S.geo.ok;
  $('#geo-flag').hidden = !warn;
  renderGeo();
}

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
    const tw = el('button', 'twist' + (kids.length ? '' : ' leaf'));
    tw.type = 'button';
    tw.setAttribute('aria-label', open ? 'Sbalit' : 'Rozbalit');
    tw.setAttribute('aria-expanded', String(open));
    tw.innerHTML = kids.length ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' : '';
    if (open) tw.classList.add('open');
    tw.addEventListener('click', () => { if (!kids.length) return; if (open) S.treeOpen.delete(key); else S.treeOpen.add(key); renderTree(); });
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
  if (reveal) {
    const sel = root.querySelector('.tnode.is-sel');
    if (sel) sel.scrollIntoView({ block: 'center' }); else root.scrollTop = scroll;
  } else root.scrollTop = scroll;
}

/* ---------- BCF 2.1 ---------- */
const BCF_TYPES = [['Issue', 'Problém'], ['Request', 'Požadavek'], ['Comment', 'Komentář'], ['Clash', 'Kolize'], ['Info', 'Informace']];
const BCF_STATUS = [['Open', 'Otevřeno'], ['In Progress', 'Řeší se'], ['Resolved', 'Vyřešeno'], ['Closed', 'Uzavřeno']];
const BCF_PRIORITY = [['Low', 'Nízká'], ['Normal', 'Normální'], ['High', 'Vysoká'], ['Critical', 'Kritická']];
const lbl = (list, v) => (list.find(([k]) => k === v) || [v, v || '—'])[1];
const statusKey = (v) => ({ Open: 'open', 'In Progress': 'progress', Resolved: 'resolved', Closed: 'closed' }[v] || 'open');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
}));
const dfmt = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => { try { return dfmt.format(new Date(iso)); } catch (e) { return iso || ''; } };
const xmlEsc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const bcf = { topics: [], view: 'list', current: null, draft: null, store: null };

/* storage: IndexedDB in the viewer's browser, memory as fallback */
const memStore = new Map();
const store = {
  db: null,
  async open() {
    if (this.db !== null) return this.db;
    this.db = await new Promise((res) => {
      try {
        const rq = indexedDB.open('ifc-nahled', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('topics', { keyPath: 'guid' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(false);
      } catch (e) { res(false); }
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return fn(null);
    return new Promise((res, rej) => {
      const t = db.transaction('topics', mode);
      const os = t.objectStore('topics');
      const out = fn(os);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  async all(modelKey) {
    try {
      const list = await this.tx('readonly', (os) => (os ? os.getAll() : null));
      const arr = list || [...memStore.values()];
      return arr.filter((t) => t.modelKey === modelKey);
    } catch (e) { return [...memStore.values()].filter((t) => t.modelKey === modelKey); }
  },
  async put(t) {
    memStore.set(t.guid, t);
    try { await this.tx('readwrite', (os) => os && os.put(t)); } catch (e) { console.warn('BCF uložení', e); }
  },
  async del(guid) {
    memStore.delete(guid);
    try { await this.tx('readwrite', (os) => os && os.delete(guid)); } catch (e) { /* ignore */ }
  },
};

const modelKey = () => S.meta?.projectGuid || S.fileName || 'model';
const getAuthor = () => { try { return localStorage.getItem('ifc-nahled-author') || ''; } catch (e) { return ''; } };
const setAuthor = (a) => { try { localStorage.setItem('ifc-nahled-author', a); } catch (e) { /* ignore */ } };

/* coordinates: scene (Y up, shifted to origin) <-> IFC (Z up, original) */
const N_YUP = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
function sceneFromIfcMatrix() { return new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), N_YUP); }
const toIfcPoint = (v) => v.clone().applyMatrix4(sceneFromIfcMatrix().invert());
const toScenePoint = (v) => v.clone().applyMatrix4(sceneFromIfcMatrix());
const toIfcDir = (v) => v.clone().transformDirection(sceneFromIfcMatrix().invert());
const toSceneDir = (v) => v.clone().transformDirection(sceneFromIfcMatrix());

function guidMap() {
  if (S.guidMap) return S.guidMap;
  const m = new Map();
  for (const id of S.elements.keys()) {
    try { const g = S.api.GetLine(S.modelID, id)?.GlobalId?.value; if (g) m.set(g, id); } catch (e) { /* skip */ }
  }
  S.guidMap = m;
  return m;
}
function guidOf(id) {
  try { return S.api.GetLine(S.modelID, id)?.GlobalId?.value || ''; } catch (e) { return ''; }
}

async function captureSnapshot() {
  renderFrame();
  const src = renderer.domElement;
  const k = Math.min(1, 1280 / Math.max(src.width, 1));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

function captureViewpoint() {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const vp = {
    guid: uuid(),
    camera: { pos: toIfcPoint(camera.position).toArray(), dir: toIfcDir(dir).toArray(), up: toIfcDir(up).toArray(), fov: camera.fov },
    components: S.selected != null ? [guidOf(S.selected)].filter(Boolean) : [],
    clip: null,
  };
  if (S.clipOn) {
    const loc = clipPlane.projectPoint(S.bbox.getCenter(new THREE.Vector3()), new THREE.Vector3());
    vp.clip = { loc: toIfcPoint(loc).toArray(), dir: toIfcDir(clipPlane.normal.clone().negate()).toArray() };
  }
  return vp;
}

function applyViewpoint(t) {
  const vp = t.viewpoint;
  if (!vp) return;
  if (vp.camera) {
    const pos = toScenePoint(new THREE.Vector3().fromArray(vp.camera.pos));
    const dir = toSceneDir(new THREE.Vector3().fromArray(vp.camera.dir)).normalize();
    const c = S.bbox.getCenter(new THREE.Vector3());
    const d = Math.max(1, c.clone().sub(pos).dot(dir));
    if (vp.camera.fov > 10 && vp.camera.fov < 120) { camera.fov = vp.camera.fov; camera.updateProjectionMatrix(); }
    tween(pos, pos.clone().add(dir.multiplyScalar(d)), true);
  }
  if (vp.clip) {
    const loc = toScenePoint(new THREE.Vector3().fromArray(vp.clip.loc));
    const n = toSceneDir(new THREE.Vector3().fromArray(vp.clip.dir)).negate().normalize(); // normal = kept side
    let mode = 'h';
    if (Math.abs(n.y) < 0.9) {
      const deg = THREE.MathUtils.radToDeg(Math.atan2(n.z, n.x));
      const base = S.baseAngle || 0;
      const dc = wrap180(deg - base), dl = wrap180(deg - base - 90);
      mode = Math.abs(dc) <= Math.abs(dl) ? 'cross' : 'long';
      clip.rot[mode] = mode === 'cross' ? dc : dl;
    }
    clip.mode = mode;
    const cn = clipNormal(mode);
    clip.flip[mode] = n.dot(cn) > 0;
    clip.vals[mode] = cn.dot(loc);
    S.clipOn = true; S.clipPanel = false;
    applyClipMode(); updateClipUi(); updateToolbar();
  } else if (S.clipOn) {
    toggleClip(false);
  }
  const ids = (vp.components || []).map((g) => guidMap().get(g)).filter((x) => x != null);
  if (ids.length) select(ids[0], { keepPanel: true }); else deselect();
}

/* ----- UI: list / detail / form ----- */
async function bcfOnModelLoaded() {
  bcf.topics = await store.all(modelKey());
  bcf.view = 'list'; bcf.current = null;
  renderBcf();
}
function updateBcfCount() {
  const n = bcf.topics.filter((t) => t.status !== 'Closed').length;
  const c = $('#bcf-count');
  c.textContent = n ? String(n) : '';
  c.hidden = !n;
}
const thumbUrls = new Map();
function thumbUrl(t) {
  if (!t.snapshot) return null;
  if (!thumbUrls.has(t.guid)) thumbUrls.set(t.guid, URL.createObjectURL(t.snapshot));
  return thumbUrls.get(t.guid);
}
function pill(status) { return el('span', `pill st-${statusKey(status)}`, lbl(BCF_STATUS, status)); }

function renderBcf() {
  updateBcfCount();
  const root = $('#panel-bcf');
  root.replaceChildren();
  if (bcf.view === 'detail' && bcf.current) return renderBcfDetail(root);
  const bar = el('div', 'bcf-bar');
  const add = el('button', 'sbtn primary', 'Nový záznam'); add.type = 'button';
  add.addEventListener('click', () => bcfStartNew());
  const imp = el('label', 'sbtn', 'Import'); imp.htmlFor = 'bcf-input';
  const exp = el('button', 'sbtn', 'Export .bcfzip'); exp.type = 'button';
  exp.disabled = !bcf.topics.length;
  exp.addEventListener('click', bcfExport);
  bar.append(add, imp, exp);
  root.appendChild(bar);
  if (!bcf.topics.length) {
    const e = el('div', 'props-empty');
    e.append(el('p', 'props-empty-title', 'Zatím žádné záznamy'),
      el('p', 'muted', 'Vyberte prvek v modelu a klepněte na „Přidat BCF záznam“. Uloží se pohled kamery, řez, vybraný prvek a snímek obrazovky.'));
    root.appendChild(e);
    return;
  }
  const ul = el('ul', 'topics');
  [...bcf.topics].sort((a, b) => (b.created || '').localeCompare(a.created || '')).forEach((t) => {
    const li = el('li');
    const b = el('button', 'topic'); b.type = 'button';
    const url = thumbUrl(t);
    const th = el('div', 'topic-thumb');
    if (url) { const img = el('img'); img.src = url; img.alt = ''; th.appendChild(img); }
    const body = el('div', 'topic-body');
    body.append(el('span', 'topic-title', t.title));
    const meta = el('span', 'topic-meta');
    meta.append(pill(t.status), el('span', null, `${lbl(BCF_TYPES, t.type)} · ${lbl(BCF_PRIORITY, t.priority)}`));
    body.append(meta);
    if (t.elementName) body.append(el('span', 'topic-el', t.elementName));
    body.append(el('span', 'topic-date', `${fmtDate(t.created)}${t.author ? ' · ' + t.author : ''}`));
    b.append(th, body);
    b.addEventListener('click', () => { bcf.current = t; bcf.view = 'detail'; renderBcf(); applyViewpoint(t); });
    li.appendChild(b);
    ul.appendChild(li);
  });
  root.appendChild(ul);
}

function field(labelText, control) {
  const w = el('label', 'fld');
  w.append(el('span', 'fld-l', labelText), control);
  return w;
}
function selectCtl(list, value, id) {
  const s = el('select'); if (id) s.id = id;
  list.forEach(([k, v]) => { const o = el('option', null, v); o.value = k; if (k === value) o.selected = true; s.appendChild(o); });
  return s;
}

function renderBcfDetail(root) {
  const t = bcf.current;
  const head = el('div', 'bcf-bar');
  const back = el('button', 'sbtn', '← Seznam'); back.type = 'button';
  back.addEventListener('click', () => { bcf.view = 'list'; bcf.current = null; renderBcf(); });
  const show = el('button', 'sbtn', 'Zobrazit v modelu'); show.type = 'button';
  show.addEventListener('click', () => applyViewpoint(t));
  head.append(back, show);
  root.appendChild(head);

  const box = el('div', 'bcf-detail');
  const url = thumbUrl(t);
  if (url) { const img = el('img', 'bcf-shot'); img.src = url; img.alt = 'Snímek pohledu'; box.appendChild(img); }
  box.appendChild(el('h2', 'el-name', t.title));
  const meta = el('div', 'topic-meta'); meta.append(pill(t.status), el('span', null, `${fmtDate(t.created)}${t.author ? ' · ' + t.author : ''}`));
  box.appendChild(meta);
  if (t.elementName) box.appendChild(el('div', 'el-storey', `Prvek: ${t.elementName}`));

  const save = async () => {
    t.modified = new Date().toISOString(); t.modifiedAuthor = getAuthor() || t.author;
    await store.put(t); updateBcfCount();
  };
  const grid = el('div', 'fld-grid');
  const st = selectCtl(BCF_STATUS, t.status, 'bcf-d-status');
  st.addEventListener('change', async () => { t.status = st.value; await save(); meta.firstChild.replaceWith(pill(t.status)); });
  const pr = selectCtl(BCF_PRIORITY, t.priority, 'bcf-d-priority');
  pr.addEventListener('change', async () => { t.priority = pr.value; await save(); });
  const ty = selectCtl(BCF_TYPES, t.type, 'bcf-d-type');
  ty.addEventListener('change', async () => { t.type = ty.value; await save(); });
  const as = el('input'); as.id = 'bcf-d-assigned'; as.value = t.assignedTo || ''; as.placeholder = 'e-mail nebo jméno';
  as.addEventListener('change', async () => { t.assignedTo = as.value.trim(); await save(); });
  grid.append(field('Stav', st), field('Priorita', pr), field('Typ', ty), field('Přiřazeno', as));
  box.appendChild(grid);
  const de = el('textarea'); de.id = 'bcf-d-desc'; de.rows = 3; de.value = t.description || '';
  de.addEventListener('change', async () => { t.description = de.value; await save(); });
  box.appendChild(field('Popis', de));

  box.appendChild(el('h3', 'group-title flush', `Komentáře (${(t.comments || []).length})`));
  const cl = el('ul', 'comments');
  (t.comments || []).forEach((c) => {
    const li = el('li', 'comment');
    li.append(el('div', 'comment-meta', `${c.author || '—'} · ${fmtDate(c.date)}`), el('div', 'comment-text', c.text));
    cl.appendChild(li);
  });
  box.appendChild(cl);
  const ct = el('textarea'); ct.id = 'bcf-d-comment'; ct.rows = 2; ct.placeholder = 'Napište komentář…';
  const cb = el('button', 'sbtn primary', 'Přidat komentář'); cb.type = 'button';
  cb.addEventListener('click', async () => {
    const text = ct.value.trim();
    if (!text) return;
    if (!getAuthor()) { toast('Nejdřív vyplňte autora v novém záznamu.', true); }
    (t.comments ||= []).push({ guid: uuid(), date: new Date().toISOString(), author: getAuthor() || t.author, text });
    await save(); renderBcf();
  });
  const crow = el('div', 'comment-new'); crow.append(ct, cb);
  box.appendChild(crow);

  const del = el('div', 'danger');
  const db = el('button', 'link danger-link', 'Smazat záznam'); db.type = 'button';
  db.addEventListener('click', () => {
    del.replaceChildren(el('span', 'muted', 'Opravdu smazat tento záznam?'));
    const yes = el('button', 'sbtn danger-btn', 'Smazat'); yes.type = 'button';
    const no = el('button', 'sbtn', 'Ponechat'); no.type = 'button';
    yes.addEventListener('click', async () => {
      await store.del(t.guid);
      bcf.topics = bcf.topics.filter((x) => x.guid !== t.guid);
      bcf.view = 'list'; bcf.current = null; renderBcf(); toast('Záznam smazán');
    });
    no.addEventListener('click', () => renderBcf());
    del.append(yes, no);
  });
  del.appendChild(db);
  box.appendChild(del);
  root.appendChild(box);
}

/* new topic form (modal) */
async function bcfStartNew() {
  if (S.modelID == null) return;
  const vp = captureViewpoint();
  const snap = await captureSnapshot();
  const rec = S.selected != null ? S.elements.get(S.selected) : null;
  let elementName = '';
  if (rec) {
    try { elementName = `${S.api.GetLine(S.modelID, S.selected)?.Name?.value || classLabel(rec.cls)} (${rec.cls})`; } catch (e) { elementName = rec.cls; }
  }
  bcf.draft = { vp, snap, elementName };
  const m = $('#bcf-modal');
  const prev = $('#bcf-f-shot');
  if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
  if (snap) { prev.dataset.url = URL.createObjectURL(snap); prev.src = prev.dataset.url; prev.hidden = false; } else prev.hidden = true;
  $('#bcf-f-element').textContent = elementName ? `Prvek: ${elementName}` : 'Bez vybraného prvku: uloží se jen pohled.';
  $('#bcf-f-title').value = '';
  $('#bcf-f-desc').value = '';
  $('#bcf-f-assigned').value = '';
  $('#bcf-f-type').value = 'Issue';
  $('#bcf-f-priority').value = 'Normal';
  $('#bcf-f-status').value = 'Open';
  $('#bcf-f-author').value = getAuthor();
  $('#bcf-f-error').hidden = true;
  m.hidden = false;
  setTimeout(() => $('#bcf-f-title').focus(), 50);
}
function fillSelect(id, list) {
  const s = $(id); s.replaceChildren();
  list.forEach(([k, v]) => { const o = el('option', null, v); o.value = k; s.appendChild(o); });
}
fillSelect('#bcf-f-type', BCF_TYPES); fillSelect('#bcf-f-priority', BCF_PRIORITY); fillSelect('#bcf-f-status', BCF_STATUS);
$('#bcf-cancel').addEventListener('click', () => { $('#bcf-modal').hidden = true; bcf.draft = null; });
$('#bcf-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#bcf-f-title').value.trim();
  const author = $('#bcf-f-author').value.trim();
  if (!title || !author) {
    const er = $('#bcf-f-error');
    er.textContent = !title ? 'Vyplňte název záznamu.' : 'Vyplňte autora (jméno nebo e-mail). Aplikace si ho zapamatuje.';
    er.hidden = false; return;
  }
  setAuthor(author);
  const now = new Date().toISOString();
  const t = {
    guid: uuid(), modelKey: modelKey(), fileName: S.fileName, title,
    type: $('#bcf-f-type').value, status: $('#bcf-f-status').value, priority: $('#bcf-f-priority').value,
    assignedTo: $('#bcf-f-assigned').value.trim(), description: $('#bcf-f-desc').value.trim(),
    author, created: now, modified: null, modifiedAuthor: null, comments: [],
    viewpoint: bcf.draft.vp, snapshot: bcf.draft.snap, elementName: bcf.draft.elementName,
  };
  await store.put(t);
  bcf.topics.push(t);
  $('#bcf-modal').hidden = true;
  bcf.draft = null;
  bcf.view = 'detail'; bcf.current = t;
  showPanel('bcf');
  renderBcf();
  toast('BCF záznam uložen');
});

/* ----- export / import ----- */
const v3 = (a) => `<X>${a[0]}</X><Y>${a[1]}</Y><Z>${a[2]}</Z>`;
function markupXml(t) {
  const vpGuid = t.viewpoint?.guid;
  const comments = (t.comments || []).map((c) => `
  <Comment Guid="${c.guid}">
    <Date>${xmlEsc(c.date)}</Date>
    <Author>${xmlEsc(c.author)}</Author>
    <Comment>${xmlEsc(c.text)}</Comment>
  </Comment>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <File IfcProject="${xmlEsc(S.meta?.projectGuid || '')}" isExternal="true">
      <Filename>${xmlEsc(t.fileName || S.fileName)}</Filename>
      <Date>${xmlEsc(t.created)}</Date>
    </File>
  </Header>
  <Topic Guid="${t.guid}" TopicType="${xmlEsc(t.type)}" TopicStatus="${xmlEsc(t.status)}">
    <Title>${xmlEsc(t.title)}</Title>
    <Priority>${xmlEsc(t.priority)}</Priority>
    <CreationDate>${xmlEsc(t.created)}</CreationDate>
    <CreationAuthor>${xmlEsc(t.author)}</CreationAuthor>${t.modified ? `
    <ModifiedDate>${xmlEsc(t.modified)}</ModifiedDate>
    <ModifiedAuthor>${xmlEsc(t.modifiedAuthor || t.author)}</ModifiedAuthor>` : ''}${t.assignedTo ? `
    <AssignedTo>${xmlEsc(t.assignedTo)}</AssignedTo>` : ''}${t.description ? `
    <Description>${xmlEsc(t.description)}</Description>` : ''}
  </Topic>${comments}${vpGuid ? `
  <Viewpoints Guid="${vpGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>${t.snapshot ? `
    <Snapshot>snapshot.png</Snapshot>` : ''}
  </Viewpoints>` : ''}
</Markup>
`;
}
function viewpointXml(vp) {
  const sel = (vp.components || []).map((g) => `<Component IfcGuid="${xmlEsc(g)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${vp.guid}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Components>${sel ? `
    <Selection>${sel}</Selection>` : ''}
    <Visibility DefaultVisibility="true"/>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint>${v3(vp.camera.pos)}</CameraViewPoint>
    <CameraDirection>${v3(vp.camera.dir)}</CameraDirection>
    <CameraUpVector>${v3(vp.camera.up)}</CameraUpVector>
    <FieldOfView>${Math.round(vp.camera.fov * 100) / 100}</FieldOfView>
  </PerspectiveCamera>${vp.clip ? `
  <ClippingPlanes>
    <ClippingPlane>
      <Location>${v3(vp.clip.loc)}</Location>
      <Direction>${v3(vp.clip.dir)}</Direction>
    </ClippingPlane>
  </ClippingPlanes>` : ''}
</VisualizationInfo>
`;
}
async function bcfExport() {
  if (!bcf.topics.length) return;
  const files = {
    'bcf.version': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DetailedVersion>2.1</DetailedVersion>
</Version>
`),
    'project.bcfp': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Project ProjectId="${uuid()}">
    <Name>${xmlEsc(S.meta?.projectName || S.fileName)}</Name>
  </Project>
  <ExtensionSchema></ExtensionSchema>
</ProjectExtension>
`),
  };
  for (const t of bcf.topics) {
    files[`${t.guid}/markup.bcf`] = strToU8(markupXml(t));
    if (t.viewpoint) files[`${t.guid}/viewpoint.bcfv`] = strToU8(viewpointXml(t.viewpoint));
    if (t.snapshot) files[`${t.guid}/snapshot.png`] = new Uint8Array(await t.snapshot.arrayBuffer());
  }
  const data = zipSync(files, { level: 6 });
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  await saveFile(`${base}-BCF.bcfzip`, new Blob([data], { type: 'application/octet-stream' }));
}

async function saveFile(name, blob, mime) {
  // 1) claude.ai artifact: platform save dialog (.bcfzip is not on its list, so .zip)
  if (window.claude?.use) {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        const isBcf = /\.bcfzip$/i.test(name);
        await dl.save({ filename: isBcf ? name.replace(/\.bcfzip$/i, '.bcf.zip') : name, data: blob });
        toast(isBcf ? 'Uloženo jako .zip. Pro import do BIM nástroje přejmenujte příponu na .bcfzip.' : `Uloženo: ${name}`);
        return;
      }
    } catch (e) {
      if (e?.code === 'declined') return;
      console.warn('downloads', e);
    }
  }
  // 2) iPad / iPhone: share sheet (Uložit do Souborů, Mail, Teams…)
  const file = new File([blob], name, { type: mime || blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  // 3) desktop browsers: classic download
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Staženo: ${name}`);
}

function xv(node, sel) {
  const n = node?.querySelector(sel);
  if (!n) return null;
  return ['X', 'Y', 'Z'].map((k) => Number(n.querySelector(k)?.textContent || 0));
}
async function bcfImport(file) {
  if (!file || S.modelID == null) return;
  try {
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const parser = new DOMParser();
    const folders = Object.keys(zip).filter((k) => /\/markup\.bcf$/i.test(k)).map((k) => k.replace(/\/markup\.bcf$/i, ''));
    let n = 0;
    for (const f of folders) {
      const mx = parser.parseFromString(strFromU8(zip[`${f}/markup.bcf`]), 'application/xml');
      const tp = mx.querySelector('Topic');
      if (!tp) continue;
      const txt = (s) => tp.querySelector(`:scope > ${s}`)?.textContent || '';
      const vpsNode = mx.querySelector('Viewpoints');
      const vpFile = vpsNode?.querySelector('Viewpoint')?.textContent || 'viewpoint.bcfv';
      const snapFile = vpsNode?.querySelector('Snapshot')?.textContent || 'snapshot.png';
      let viewpoint = null;
      const vraw = zip[`${f}/${vpFile}`];
      if (vraw) {
        const vx = parser.parseFromString(strFromU8(vraw), 'application/xml');
        const pc = vx.querySelector('PerspectiveCamera');
        const cp = vx.querySelector('ClippingPlane');
        viewpoint = {
          guid: vx.documentElement.getAttribute('Guid') || uuid(),
          camera: pc ? { pos: xv(pc, 'CameraViewPoint'), dir: xv(pc, 'CameraDirection'), up: xv(pc, 'CameraUpVector'), fov: Number(pc.querySelector('FieldOfView')?.textContent || 60) } : null,
          components: [...vx.querySelectorAll('Selection > Component')].map((c) => c.getAttribute('IfcGuid')).filter(Boolean),
          clip: cp ? { loc: xv(cp, 'Location'), dir: xv(cp, 'Direction') } : null,
        };
      }
      const sraw = zip[`${f}/${snapFile}`];
      const comments = [...mx.querySelectorAll('Markup > Comment')].map((c) => ({
        guid: c.getAttribute('Guid') || uuid(),
        date: c.querySelector('Date')?.textContent || '',
        author: c.querySelector('Author')?.textContent || '',
        text: c.querySelector('Comment')?.textContent || '',
      }));
      const gids = viewpoint?.components || [];
      let elementName = '';
      const eid = gids.length ? guidMap().get(gids[0]) : null;
      if (eid != null) {
        const rec = S.elements.get(eid);
        try { elementName = `${S.api.GetLine(S.modelID, eid)?.Name?.value || classLabel(rec.cls)} (${rec.cls})`; } catch (e) { /* ignore */ }
      }
      const t = {
        guid: tp.getAttribute('Guid') || uuid(), modelKey: modelKey(), fileName: S.fileName,
        title: txt('Title') || 'Bez názvu', type: tp.getAttribute('TopicType') || 'Issue', status: tp.getAttribute('TopicStatus') || 'Open',
        priority: txt('Priority') || 'Normal', assignedTo: txt('AssignedTo'), description: txt('Description'),
        author: txt('CreationAuthor'), created: txt('CreationDate') || new Date().toISOString(),
        modified: txt('ModifiedDate') || null, modifiedAuthor: txt('ModifiedAuthor') || null,
        comments, viewpoint: viewpoint?.camera ? viewpoint : null,
        snapshot: sraw ? new Blob([sraw], { type: 'image/png' }) : null, elementName,
      };
      await store.put(t);
      bcf.topics = bcf.topics.filter((x) => x.guid !== t.guid).concat(t);
      thumbUrls.delete(t.guid);
      n++;
    }
    showPanel('bcf');
    bcf.view = 'list'; renderBcf();
    toast(n ? `Importováno ${n} záznamů` : 'V souboru nebyly žádné BCF záznamy.', !n);
  } catch (e) {
    console.error(e);
    toast('Soubor se nepodařilo načíst jako BCF (.bcfzip).', true);
  }
}
$('#bcf-input').addEventListener('change', (e) => { bcfImport(e.target.files[0]); e.target.value = ''; });

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
    if (!rec.meshes[0]?.userData.ghost || !isVisible(id, rec)) continue;
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

/* =====================================================================
   POPISKY MÍSTNOSTÍ V PŮDORYSU
   ===================================================================== */
const LABEL_KEY = 'ifc-nahled-room-labels';
let roomLabelMode = 'full';
try { roomLabelMode = localStorage.getItem(LABEL_KEY) || 'full'; } catch (e) { /* ignore */ }
const AREA_KEYS = [/^Qto_SpaceBaseQuantities\.NetFloorArea$/i, /^Qto_SpaceBaseQuantities\.GrossFloorArea$/i, /\.NetFloorArea$/i, /\.GrossFloorArea$/i, /^Pset_SpaceCommon\.NetPlannedArea$/i, /\.(Plocha|PlochaMistnosti|Plocha_m2|Area)$/i];
/* půdorysná stopa místnosti z geometrie: plocha a těžiště spodních ploch */
function spaceFootprint(id) {
  if (!S.spaceGeo) S.spaceGeo = new Map();
  if (S.spaceGeo.has(id)) return S.spaceGeo.get(id);
  const rec = S.elements.get(id);
  let A = 0, cx = 0, cz = 0, ymin = Infinity;
  const pts = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const m of rec?.meshes || []) {
    const pos = m.geometry.attributes.position, ix = m.geometry.index;
    if (!pos || !ix) continue;
    const arr = ix.array;
    for (let i = 0; i < arr.length; i += 3) {
      a.fromBufferAttribute(pos, arr[i]).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, arr[i + 1]).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, arr[i + 2]).applyMatrix4(m.matrixWorld);
      ab.subVectors(b, a); ac.subVectors(c, a);
      const n = ab.cross(ac);
      const len = n.length();
      if (len < 1e-12 || n.y / len > -0.7) continue; // jen plochy natočené dolů = podlaha místnosti
      const area = Math.abs(n.y) / 2;
      A += area;
      cx += area * (a.x + b.x + c.x) / 3;
      cz += area * (a.z + b.z + c.z) / 3;
      ymin = Math.min(ymin, a.y, b.y, c.y);
      pts.push(a.x, a.z, b.x, b.z, c.x, c.z);
    }
  }
  let out = null;
  if (A > 1e-6) out = { area: A, x: cx / A, z: cz / A, y: ymin, pts };
  else if (rec) { const bx = boxOf(rec.meshes); if (!bx.isEmpty()) { const ctr = bx.getCenter(new THREE.Vector3()); out = { area: 0, x: ctr.x, z: ctr.z, y: bx.min.y, pts: [bx.min.x, bx.min.z, bx.max.x, bx.max.z] }; } }
  S.spaceGeo.set(id, out);
  return out;
}
function spaceArea(id, fp) {
  const r = S.idx?.ready ? S.idx.el.get(id) : null;
  if (r) {
    const all = [...r.sets, ...r.tsets];
    for (const re of AREA_KEYS) {
      for (const s of all) for (const [k, v] of s.props) if (re.test(k) && typeof v === 'number' && v > 0) return { v, src: k };
    }
  }
  return fp?.area ? { v: fp.area, src: 'geometrie' } : null;
}
function roomLabelsFor(stId) {
  if (S.roomLbl?.st === stId && S.roomLbl.idxReady === !!S.idx?.ready) return S.roomLbl.list;
  const list = [];
  for (const id of spacesIn(stId)) {
    if (!S.elements.has(id)) continue;
    const fp = spaceFootprint(id);
    if (!fp) continue;
    let name = '', ln = '';
    try { const L = S.api.GetLine(S.modelID, id); name = val(L?.Name); ln = val(L?.LongName); } catch (e) { /* ignore */ }
    const ar = spaceArea(id, fp);
    list.push({ id, x: fp.x, z: fp.z, pts: fp.pts, num: name, name: ln && ln !== name ? ln : '', area: ar?.v || 0 });
  }
  S.roomLbl = { st: stId, list, idxReady: !!S.idx?.ready };
  return list;
}
/* rozmístění popisků v pixelech půdorysu; popisek se ukáže, jen když se do místnosti vejde */
function layoutRoomLabels(stId) {
  if (roomLabelMode === 'off' || !plan.view || stId == null) return [];
  const A = planAxes(), ppm = plan.view.ppm;
  const axKey = `${A.ux.toFixed(5)},${A.uz.toFixed(5)}`;
  const PS = planSize();
  const out = [];
  for (const L of roomLabelsFor(stId)) {
    if (L.axKey !== axKey) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < L.pts.length; i += 2) {
        const r = L.pts[i] * A.rx + L.pts[i + 1] * A.rz, u = L.pts[i] * A.ux + L.pts[i + 1] * A.uz;
        if (r < a0) a0 = r; if (r > a1) a1 = r; if (u < b0) b0 = u; if (u > b1) b1 = u;
      }
      L.axKey = axKey; L.ext = [a0, a1, b0, b1];
    }
    const [r0, r1, u0, u1] = L.ext;
    const wpx = (r1 - r0) * ppm, hpx = (u1 - u0) * ppm;
    const p = planXY(L.x, L.z);
    if (p.x < -80 || p.y < -40 || p.x > PS.w + 80 || p.y > PS.h + 40) continue;
    const lines = [];
    const num = L.num || '';
    if (num) lines.push({ t: num, c: 'rl-num' });
    if ((roomLabelMode === 'name' || roomLabelMode === 'full') && L.name) lines.push({ t: L.name, c: 'rl-name' });
    if (roomLabelMode === 'full' && L.area) lines.push({ t: `${nf2.format(L.area)} m²`, c: 'rl-area' });
    if (!lines.length) continue;
    const fits = (ls) => ls.length * 14 + 2 <= hpx && Math.max(...ls.map((x) => x.t.length * (x.c === 'rl-num' ? 7.2 : 6.4))) + 6 <= wpx;
    let use = lines;
    if (!fits(use)) use = lines.filter((x) => x.c !== 'rl-name');
    if (!fits(use)) use = lines.slice(0, 1);
    if (!fits(use)) {
      // aspoň zkrácené číslo, když je místnost dost velká na pár znaků
      if (num && wpx > 24 && hpx > 14) use = [{ t: num.length * 7.2 + 6 > wpx ? num.slice(0, Math.max(2, Math.floor((wpx - 6) / 7.2) - 1)) + '…' : num, c: 'rl-num' }];
      else continue;
    }
    out.push({ x: p.x, y: p.y, lines: use });
  }
  return out;
}
function roomLabelsSvg(stId) {
  let h = '';
  for (const L of layoutRoomLabels(stId)) {
    const y0 = L.y - (L.lines.length - 1) * 7 + 4;
    h += `<text class="rl" x="${L.x.toFixed(1)}" y="${y0.toFixed(1)}" text-anchor="middle">`;
    L.lines.forEach((ln, i) => { h += `<tspan class="${ln.c}" x="${L.x.toFixed(1)}" y="${(y0 + i * 14).toFixed(1)}">${esc(ln.t)}</tspan>`; });
    h += '</text>';
  }
  return h;
}
const planLabelsSel = $('#plan-labels');
planLabelsSel.value = roomLabelMode;
planLabelsSel.addEventListener('change', () => {
  roomLabelMode = planLabelsSel.value;
  try { localStorage.setItem(LABEL_KEY, roomLabelMode); } catch (e) { /* ignore */ }
  updatePlanMarker();
});
function updatePlanLabelUi() {
  const has = [...S.classes.keys()].some((k) => U(k) === 'IFCSPACE');
  planLabelsSel.hidden = !has;
}
/* export půdorysu do PNG: obrázek, popisky, měřítko, sever a hlavička */
async function exportPlanPng() {
  const f = planStorey();
  if (!f || !plan.view) return;
  renderPlanImage(f);
  const { w, h } = planSize();
  const k = 2, head = 52;
  // půdorys znovu ve dvojnásobném rozlišení
  const W2 = Math.round(w * k), H2 = Math.round(h * k);
  const rt = new THREE.WebGLRenderTarget(W2, H2, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevBg = scene.background;
  scene.background = new THREE.Color(cssVar('--panel') || '#f8faf9');
  planCutPlane.constant = f.cut;
  renderer.setRenderTarget(rt);
  if (typeof setSpaceSide === 'function') setSpaceSide(true);
  renderer.clippingPlanes = [planCutPlane];
  renderer.clear();
  renderer.render(scene, plan.cam);
  renderer.setRenderTarget(null);
  renderer.clippingPlanes = [];
  scene.background = prevBg;
  const px = new Uint8Array(W2 * H2 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W2, H2, px);
  rt.dispose();
  const pc = document.createElement('canvas');
  pc.width = W2; pc.height = H2;
  const pimg = pc.getContext('2d').createImageData(W2, H2);
  for (let y = 0; y < H2; y++) pimg.data.set(px.subarray((H2 - 1 - y) * W2 * 4, (H2 - y) * W2 * 4), y * W2 * 4);
  pc.getContext('2d').putImageData(pimg, 0, 0);
  requestRender();
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round((h + head) * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  g.fillStyle = cssVar('--panel') || '#ffffff';
  g.fillRect(0, 0, w, h + head);
  g.drawImage(pc, 0, head, w, h);
  const ink = cssVar('--ink') || '#18211f', muted = cssVar('--muted') || '#5b6864', bg = cssVar('--panel') || '#ffffff';
  const sans = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';
  g.fillStyle = ink; g.font = `600 16px ${sans}`;
  g.fillText(`${f.st.name} – půdorys`, 14, 22);
  g.fillStyle = muted; g.font = `12px ${sans}`;
  const today = new Date().toLocaleDateString('cs-CZ');
  g.fillText(`${S.meta?.projectName || S.fileName} · ${S.fileName} · ${today}`, 14, 40);
  g.strokeStyle = cssVar('--line') || '#ccd4d0'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, head - 0.5); g.lineTo(w, head - 0.5); g.stroke();
  // popisky
  g.textAlign = 'center'; g.lineJoin = 'round';
  for (const L of layoutRoomLabels(f.st.id)) {
    const y0 = head + L.y - (L.lines.length - 1) * 7 + 4;
    L.lines.forEach((ln, i) => {
      g.font = ln.c === 'rl-num' ? `600 12.5px ${sans}` : `${ln.c === 'rl-area' ? 400 : 500} 11.5px ${sans}`;
      g.lineWidth = 3; g.strokeStyle = bg; g.strokeText(ln.t, L.x, y0 + i * 14);
      g.fillStyle = ln.c === 'rl-area' ? muted : ink; g.fillText(ln.t, L.x, y0 + i * 14);
    });
  }
  // měřítko
  const ppm = plan.view.ppm;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  const Lm = steps.find((m) => m * ppm >= 80) || steps[steps.length - 1];
  const sx = 14, sy = head + h - 16;
  g.strokeStyle = ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(sx, sy - 6); g.lineTo(sx, sy); g.lineTo(sx + Lm * ppm, sy); g.lineTo(sx + Lm * ppm, sy - 6); g.stroke();
  g.textAlign = 'left'; g.fillStyle = ink; g.font = `500 11px ${sans}`;
  g.fillText(`${Lm} m`, sx + Lm * ppm + 6, sy);
  // sever
  const A = planAxes();
  const n = (typeof geoNorthScene === 'function' && geoNorthScene()) || { x: 0, z: -1 };
  const ang = Math.atan2(n.x * A.rx + n.z * A.rz, n.x * A.ux + n.z * A.uz);
  g.save(); g.translate(w - 26, 26); g.rotate(ang);
  g.fillStyle = cssVar('--accent') || '#c94a10';
  g.beginPath(); g.moveTo(0, -12); g.lineTo(7, 9); g.lineTo(0, 5); g.lineTo(-7, 9); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = muted; g.font = `600 10px ${sans}`; g.textAlign = 'right';
  g.fillText(S.geo?.ok ? 'sever mapy' : 'sever projektu', w - 42, 30);
  if (S.color) {
    // legenda barvení
    g.textAlign = 'left';
    let y = head + 14;
    g.font = `600 11.5px ${sans}`; g.fillStyle = ink;
    g.fillText(S.color.title, w - 190, y); y += 6;
    const maxN = Math.max(3, Math.floor((h - 40) / 16));
    for (const it of S.color.items.slice(0, maxN)) {
      y += 16;
      g.fillStyle = it.ghost ? bg : it.color;
      g.fillRect(w - 190, y - 9, 10, 10);
      g.strokeStyle = muted; g.lineWidth = 0.5; g.strokeRect(w - 190, y - 9, 10, 10);
      g.fillStyle = ink; g.font = `11px ${sans}`;
      g.fillText(String(it.label).slice(0, 28), w - 174, y);
    }
  }
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  await saveFile(`${base}-${String(f.st.name).replace(/[\\/:*?"<>|]+/g, '_')}-pudorys.png`, blob, 'image/png');
}
$('#plan-save').addEventListener('click', () => exportPlanPng().catch((e) => toast(`Obrázek se nepodařilo uložit: ${e?.message || e}`, true)));

/* =====================================================================
   POROVNÁNÍ DVOU VERZÍ MODELU
   Ze starší verze se uloží jen otisk prvků (vlastnosti, obálka, plocha
   povrchu) a geometrie odebraných prvků. Páruje se podle GlobalId.
   ===================================================================== */
const cmpGroup = new THREE.Group();
scene.add(cmpGroup);
const cmpGhostMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(STATUS.removed), side: THREE.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false });
const cmpGhostSelMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(STATUS.removed), side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
const geoStatCache = new WeakMap();
function geoStats(geo) {
  let s = geoStatCache.get(geo);
  if (s) return s;
  const pos = geo.attributes.position, ix = geo.index?.array;
  let area = 0;
  if (pos && ix) {
    const arr = pos.data ? pos.data.array : pos.array, stride = pos.data ? pos.data.stride : 3, off = pos.offset || 0;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * stride + off, b = ix[i + 1] * stride + off, c = ix[i + 2] * stride + off;
      const ux = arr[b] - arr[a], uy = arr[b + 1] - arr[a + 1], uz = arr[b + 2] - arr[a + 2];
      const vx = arr[c] - arr[a], vy = arr[c + 1] - arr[a + 1], vz = arr[c + 2] - arr[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    }
  }
  if (!geo.boundingBox) geo.computeBoundingBox();
  s = { area, box: geo.boundingBox.clone() };
  geoStatCache.set(geo, s);
  return s;
}
function statsFromArrays(v, idx) {
  let area = 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < v.length; i += 6) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const box = v.length ? new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) : new THREE.Box3();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 6, b = idx[i + 1] * 6, c = idx[i + 2] * 6;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return { area, box };
}
const fmtSize = (b) => { const s = b.getSize(new THREE.Vector3()); return `${nf2.format(s.x)} × ${nf2.format(s.z)} × ${nf2.format(s.y)}`; };
function geomDiff(a, b) {
  const tol = 0.005;
  const dMin = a.box.min.distanceTo(b.box.min), dMax = a.box.max.distanceTo(b.box.max);
  if (dMin > tol || dMax > tol) {
    const sa = a.box.getSize(new THREE.Vector3()), sb = b.box.getSize(new THREE.Vector3());
    if (Math.abs(sa.x - sb.x) <= tol && Math.abs(sa.y - sb.y) <= tol && Math.abs(sa.z - sb.z) <= tol) {
      const ca = a.box.getCenter(new THREE.Vector3()), cb = b.box.getCenter(new THREE.Vector3());
      const d = ca.distanceTo(cb);
      const dz = cb.y - ca.y;
      return { kind: 'posun', text: `Posun o ${nf3.format(d)} m${Math.abs(dz) > tol ? ` (výškově ${dz > 0 ? '+' : ''}${nf3.format(dz)} m)` : ''}` };
    }
    return { kind: 'rozmer', text: `Rozměry ${fmtSize(a.box)} → ${fmtSize(b.box)} m` };
  }
  const m = Math.max(a.area, b.area);
  if (Math.abs(a.area - b.area) > Math.max(0.01, m * 0.005)) return { kind: 'tvar', text: `Změna tvaru (povrch ${nf2.format(a.area)} → ${nf2.format(b.area)} m²)` };
  return null;
}

async function compareWith(file) {
  if (!file || S.modelID == null) return;
  const head = await file.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) { toast('Tohle nevypadá jako IFC soubor (STEP).', true); return; }
  exitCompare(true);
  showLoading(`Porovnávám s ${file.name}`);
  const api = S.api;
  let oldMid = null;
  try {
    setLoadingStep('Čtu vlastnosti aktuální verze…');
    await nextFrame();
    await ensureIndex();
    // otisk aktuální verze
    const gmap = guidMap();
    const newStat = new Map();
    for (const [id, rec] of S.elements) {
      const box = boxOf(rec.meshes);
      let area = 0;
      for (const m of rec.meshes) area += geoStats(m.geometry).area;
      newStat.set(id, { box, area });
    }
    setLoadingStep('Otevírám starší verzi…');
    await nextFrame();
    const buf = await file.arrayBuffer();
    oldMid = api.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: true });
    if (oldMid < 0) throw new Error('Starší verzi se nepodařilo otevřít.');
    S.cmpOldMid = oldMid;
    // geometrie starší verze
    setLoadingStep('Čtu geometrii starší verze…');
    await nextFrame();
    const guidOld = new Map();
    const gOf = (id) => {
      if (guidOld.has(id)) return guidOld.get(id);
      let g = ''; try { g = api.GetLine(oldMid, id, false)?.GlobalId?.value || ''; } catch (e) { /* ignore */ }
      guidOld.set(id, g);
      return g;
    };
    const oldStat = new Map();
    const statCache = new Map(), geoCacheOld = new Map();
    const ghostParts = new Map(); // oldId -> [{gid, matrix}]
    const onMesh = (flat) => {
      const id = flat.expressID;
      const g = gOf(id);
      const removedCand = !g || !gmap.has(g);
      let st = oldStat.get(id);
      if (!st) { st = { box: new THREE.Box3(), area: 0 }; oldStat.set(id, st); }
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        const gid = pg.geometryExpressID;
        let s = statCache.get(gid);
        if (!s || (removedCand && !geoCacheOld.has(gid))) {
          const geom = api.GetGeometry(oldMid, gid);
          const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          geom.delete();
          if (!s) { s = ix.length ? statsFromArrays(v, ix) : { area: 0, box: new THREE.Box3() }; statCache.set(gid, s); }
          if (removedCand && ix.length) {
            const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
            const bg = new THREE.BufferGeometry();
            bg.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
            bg.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
            bg.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
            bg.computeBoundingSphere();
            geoCacheOld.set(gid, bg);
          }
        }
        const W = new THREE.Matrix4().fromArray(pg.flatTransformation); // zatím v souřadnicích starší verze
        if (!s.box.isEmpty()) st.box.union(s.box.clone().applyMatrix4(W));
        st.area += s.area;
        if (removedCand) { if (!ghostParts.has(id)) ghostParts.set(id, []); ghostParts.get(id).push({ gid, W }); }
      }
    };
    api.StreamAllMeshes(oldMid, onMesh);
    try { api.StreamAllMeshesWithTypes(oldMid, [WebIFC.IFCSPACE], onMesh); } catch (e) { /* ignore */ }
    // posun do počátku (COORDINATE_TO_ORIGIN) web-ifc určí až při čtení geometrie, proto matici čteme teprve teď
    const oldCoord = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(oldMid)); } catch (e) { return new THREE.Matrix4(); } })();
    const M = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), oldCoord.clone().invert());
    for (const st of oldStat.values()) if (!st.box.isEmpty()) st.box.applyMatrix4(M);
    for (const parts of ghostParts.values()) for (const part of parts) part.W.premultiply(M);
    // třídy a podlaží starší verze
    setLoadingStep('Čtu strukturu starší verze…');
    await nextFrame();
    const oldCls = new Map();
    for (const id of oldStat.keys()) { try { oldCls.set(id, api.GetNameFromTypeCode(api.GetLineType(oldMid, id))); } catch (e) { oldCls.set(id, ''); } }
    const oldStorey = new Map();
    try {
      const tree = await api.properties.getSpatialStructure(oldMid, false);
      const walk = (node, sname) => {
        let s = sname;
        if (U(node.type) === 'IFCBUILDINGSTOREY') { try { const L = api.GetLine(oldMid, node.expressID); s = L?.Name?.value || L?.LongName?.value || s; } catch (e) { /* ignore */ } }
        if (oldStat.has(node.expressID) && s) oldStorey.set(node.expressID, s);
        (node.children || []).forEach((c) => walk(c, s));
      };
      walk(tree, null);
    } catch (e) { /* ignore */ }
    setLoadingStep('Čtu vlastnosti starší verze…');
    const gen = S.modelGen;
    const oldIdx = await buildIndex(oldMid, new Set(oldStat.keys()), (label, f) => setLoadingStep(`Vlastnosti starší verze: ${label} ${Math.round(f * 100)} %`), () => S.modelGen === gen && S.cmpOldMid === oldMid);
    for (const id of oldStat.keys()) {
      const r = oldIdx.el.get(id) || (oldIdx.el.set(id, { a: Object.create(null), sets: [], tsets: [] }), oldIdx.el.get(id));
      r.a.Třída = prettyCls(oldCls.get(id) || '');
      if (oldStorey.has(id)) r.a.Podlaží = oldStorey.get(id);
    }
    // párování
    setLoadingStep('Porovnávám prvky…');
    await nextFrame();
    const pairs = new Map(); // newId -> oldId
    const oldUsed = new Set();
    for (const oid of oldStat.keys()) {
      const g = gOf(oid);
      const nid = g ? gmap.get(g) : undefined;
      if (nid != null && !pairs.has(nid)) { pairs.set(nid, oid); oldUsed.add(oid); }
    }
    let fallback = 0;
    const unNew = [...S.elements.keys()].filter((id) => !pairs.has(id));
    const unOld = [...oldStat.keys()].filter((id) => !oldUsed.has(id));
    if (unNew.length && unOld.length && pairs.size < 0.5 * Math.min(S.elements.size, oldStat.size)) {
      // GlobalId se mezi verzemi zřejmě změnilo: náhradní párování podle třídy, Tagu nebo názvu a polohy
      const keyOf = (r, st) => {
        if (!r) return '';
        if (r.a.Tag) return `${r.a.Třída}|T|${r.a.Tag}`;
        const c = st.box.getCenter(new THREE.Vector3());
        return `${r.a.Třída}|N|${r.a.Name || ''}|${Math.round(c.x * 5)}|${Math.round(c.y * 5)}|${Math.round(c.z * 5)}`;
      };
      const mapN = new Map(), mapO = new Map();
      const push = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
      unNew.forEach((id) => push(mapN, keyOf(S.idx.el.get(id), newStat.get(id)), id));
      unOld.forEach((id) => push(mapO, keyOf(oldIdx.el.get(id), oldStat.get(id)), id));
      for (const [k, ns] of mapN) {
        const os = mapO.get(k);
        if (ns.length === 1 && os?.length === 1) { pairs.set(ns[0], os[0]); oldUsed.add(os[0]); fallback++; }
      }
    }
    // rozdíly
    const items = new Map();
    let nAdded = 0, nChanged = 0, nSame = 0;
    for (const id of S.elements.keys()) {
      const oid = pairs.get(id);
      if (oid == null) { items.set(id, { status: 'added' }); nAdded++; continue; }
      const a = flatProps(oldIdx.el.get(oid)), b = flatProps(S.idx.el.get(id));
      const diffs = [];
      for (const k of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(k) ?? '', y = b.get(k) ?? '';
        if (x !== y) diffs.push({ k, a: x, b: y });
      }
      diffs.sort((p, q) => (ATTR_KEYS.includes(q.k) - ATTR_KEYS.includes(p.k)) || p.k.localeCompare(q.k, 'cs'));
      const geom = geomDiff(oldStat.get(oid), newStat.get(id));
      if (diffs.length || geom) { items.set(id, { status: 'changed', diffs, geom, oid }); nChanged++; } else { items.set(id, { status: 'same' }); nSame++; }
    }
    // odebrané prvky + jejich „duchové“
    const removed = [];
    for (const oid of oldStat.keys()) {
      if (oldUsed.has(oid)) continue;
      const r = oldIdx.el.get(oid);
      const meshes = [];
      for (const part of ghostParts.get(oid) || []) {
        const bg = geoCacheOld.get(part.gid);
        if (!bg) continue;
        const mesh = new THREE.Mesh(bg, cmpGhostMat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.W);
        mesh.matrixWorldNeedsUpdate = true;
        mesh.renderOrder = 3;
        mesh.userData.ghost = removed.length;
        meshes.push(mesh);
        cmpGroup.add(mesh);
      }
      removed.push({ guid: gOf(oid), cls: r?.a.Třída || prettyCls(oldCls.get(oid) || ''), name: r?.a.Name || '', storey: r?.a.Podlaží || '', props: flatProps(r), box: oldStat.get(oid).box, meshes });
    }
    cmpGroup.updateMatrixWorld(true);
    // nepoužité geometrie uvolnit
    const used = new Set(); cmpGroup.traverse((o) => { if (o.geometry) used.add(o.geometry); });
    geoCacheOld.forEach((g) => { if (!used.has(g)) g.dispose(); });

    S.cmp = { oldName: file.name, items, removed, fallback, counts: { added: nAdded, changed: nChanged, same: nSame, removed: removed.length }, filter: 'changed', kind: 'all', limit: 200 };
    S.cmpGhosts = cmpGroup.children.slice();
    try { api.CloseModel(oldMid); } catch (e) { /* ignore */ }
    oldMid = null; S.cmpOldMid = null;
    hideLoading();
    applyCompareColors();
    $('#tab-cmp').hidden = false;
    showPanel('cmp');
    const c = S.cmp.counts;
    toast(`Porovnáno: +${c.added}  ~${c.changed}  −${c.removed}`);
  } catch (e) {
    console.error(e);
    if (oldMid != null) { try { api.CloseModel(oldMid); } catch (_) { /* ignore */ } }
    S.cmpOldMid = null;
    cmpGroup.clear();
    hideLoading();
    toast(e?.message === 'aborted' ? 'Porovnání přerušeno.' : `Porovnání se nepodařilo: ${e?.message || e}`, true);
  }
}
function applyCompareColors() {
  const cmp = S.cmp;
  if (!cmp) return;
  const ids = { added: new Set(), changed: new Set(), same: new Set() };
  for (const [id, it] of cmp.items) {
    if (it.status === 'changed' && cmp.kind !== 'all') {
      const geo = !!it.geom, props = it.diffs.length > 0;
      if ((cmp.kind === 'geom' && !geo) || (cmp.kind === 'props' && !props)) { ids.same.add(id); continue; }
    }
    ids[it.status].add(id);
  }
  S.isolated = null;
  cmpGroup.visible = true;
  setColoring({
    mode: 'cmp', title: 'Porovnání verzí', only: null,
    items: [
      { label: 'Přidané', color: STATUS.added, ids: ids.added },
      { label: 'Změněné', color: STATUS.changed, ids: ids.changed },
      { label: 'Odebrané', color: STATUS.removed, ids: new Set(), removed: true, count: cmp.removed.length },
      { label: 'Beze změny', ghost: true, ids: ids.same },
    ],
  });
  applyVisibility();
}
function exitCompare(silent) {
  if (S.cmpSel != null) ghostDeselect();
  cmpGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  cmpGroup.clear();
  const was = !!S.cmp;
  S.cmp = null; S.cmpGhosts = [];
  $('#tab-cmp').hidden = true;
  if (was && S.color?.mode === 'cmp') { S.isolated = null; setColoring(null); applyVisibility(); }
  if (was && !silent) { showPanel('model'); renderProps(); }
  requestRender();
}
/* výběr odebraného prvku (duch ze starší verze) */
function selectGhost(i) {
  deselect(false);
  const g = S.cmp?.removed[i];
  if (!g) return;
  S.cmpSel = i;
  g.meshes.forEach((m) => { m.material = cmpGhostSelMat; });
  const c = g.box.getCenter(new THREE.Vector3());
  const r = Math.max(g.box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const dir = camera.position.clone().sub(controls.target).normalize();
  tween(c.clone().add(dir.multiplyScalar(r * 3.2)), c, true);
  updateToolbar();
  if ($('#panel-cmp').hidden && $('#panel-tree').hidden) showPanel('props');
  renderProps();
  requestRender();
}
function ghostDeselect() {
  const g = S.cmp?.removed[S.cmpSel];
  if (g) g.meshes.forEach((m) => { m.material = cmpGhostMat; });
  S.cmpSel = null;
}
function selectAny(id) {
  if (typeof id === 'string' && id[0] === 'g') selectGhost(Number(id.slice(1)));
  else if (typeof id === 'string' && id[0] === 'r') { const [a, b] = id.slice(1).split(':').map(Number); selectRef(a, b); }
  else select(id);
}
function anyName(id) {
  if (typeof id === 'string' && id[0] === 'r') {
    const [a, b] = id.slice(1).split(':').map(Number);
    const R = S.refs.find((x) => x.id === a);
    let n = ''; try { n = val(S.api.GetLine(R.mid, b)?.Name); } catch (e) { /* ignore */ }
    return `${n || 'prvek'} (${R?.name || 'podkladový model'})`;
  }
  if (typeof id === 'string' && id[0] === 'g') { const g = S.cmp?.removed[Number(id.slice(1))]; return g ? `${g.name || g.cls} (odebraný)` : ''; }
  return nodeName(id) || classLabel(S.elements.get(id)?.cls || '');
}
function ghostPropsView(root) {
  const g = S.cmp.removed[S.cmpSel];
  root.replaceChildren();
  const head = el('header', 'el-head');
  head.append(el('div', 'el-class', g.cls), el('h2', 'el-name', g.name || g.cls));
  if (g.storey) head.appendChild(el('div', 'el-storey', g.storey));
  head.appendChild(el('div', 'cmp-badge removed', 'Odebráno – prvek je jen ve starší verzi'));
  if (g.guid) {
    const b = el('button', 'guid');
    b.type = 'button';
    b.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', g.guid), el('span', 'guid-a', 'Kopírovat'));
    b.addEventListener('click', () => copy(g.guid, b));
    head.appendChild(b);
  }
  root.appendChild(head);
  const bySet = new Map();
  for (const [k, v] of g.props) {
    const dot = k.indexOf('.');
    const set = ATTR_KEYS.includes(k) || dot < 0 ? 'Atributy' : k.slice(0, dot);
    const name = set === 'Atributy' ? (ATTR_LABEL[k] || k) : k.slice(dot + 1);
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set).push([name, v]);
  }
  for (const [s, rows] of bySet) root.appendChild(table(s, rows, 'Starší verze'));
}
function cmpDiffSection(id) {
  const it = S.cmp?.items.get(id);
  if (!it) return null;
  const sec = el('section', 'pset cmp-sec');
  const h = el('h3', 'pset-title', 'Změna oproti starší verzi');
  sec.appendChild(h);
  if (it.status === 'added') { sec.appendChild(el('div', 'cmp-badge added', 'Přidáno – prvek ve starší verzi není')); return sec; }
  if (it.status === 'same') { sec.appendChild(el('div', 'cmp-badge same', 'Beze změny')); return sec; }
  sec.appendChild(el('div', 'cmp-badge changed', 'Změněno'));
  const dl = el('dl', 'kv cmp-kv');
  if (it.geom) dl.append(el('dt', null, 'Geometrie'), el('dd', null, it.geom.text));
  for (const d of it.diffs.slice(0, 80)) {
    const dd = el('dd');
    dd.append(el('span', 'cmp-old', d.a || '—'), el('span', 'cmp-arrow', ' → '), el('span', 'cmp-new', d.b || '—'));
    dl.append(el('dt', null, ATTR_LABEL[d.k] || d.k), dd);
  }
  if (it.diffs.length > 80) dl.append(el('dt', null, '…'), el('dd', null, `a dalších ${it.diffs.length - 80} změn`));
  sec.appendChild(dl);
  return sec;
}
function cmpSummary(it) {
  if (it.status !== 'changed') return '';
  const parts = [];
  if (it.geom) parts.push(it.geom.kind === 'posun' ? it.geom.text.replace(/ \(.*\)$/, '') : it.geom.kind === 'rozmer' ? 'rozměry' : 'tvar');
  if (it.diffs.length) {
    const names = it.diffs.slice(0, 3).map((d) => (ATTR_KEYS.includes(d.k) ? (ATTR_LABEL[d.k] || d.k).replace(/ \(.*\)$/, '') : d.k.slice(d.k.indexOf('.') + 1)));
    parts.push(names.join(', ') + (it.diffs.length > 3 ? ` +${it.diffs.length - 3}` : ''));
  }
  return parts.join(' · ');
}
function renderCmpPanel() {
  const root = $('#panel-cmp');
  root.replaceChildren();
  const cmp = S.cmp;
  if (!cmp) { root.appendChild(el('p', 'muted pad', 'Porovnání není spuštěné.')); return; }
  const head = el('div', 'summary');
  head.appendChild(el('div', 'summary-title', 'Porovnání verzí'));
  const facts = el('dl', 'facts');
  facts.append(el('dt', null, 'Starší'), el('dd', 'cmp-file', cmp.oldName), el('dt', null, 'Aktuální'), el('dd', 'cmp-file', S.fileName));
  head.appendChild(facts);
  const acts = el('div', 'res-acts');
  const b1 = el('button', 'sbtn', 'Export CSV'); b1.type = 'button'; b1.addEventListener('click', exportCompareCsv);
  const b2 = el('button', 'sbtn', 'Ukončit porovnání'); b2.type = 'button'; b2.addEventListener('click', () => exitCompare());
  acts.append(b1, b2);
  head.appendChild(acts);
  root.appendChild(head);
  if (cmp.fallback) {
    root.appendChild(el('div', 'notice', `GlobalId se mezi verzemi z velké části liší. ${cmp.fallback.toLocaleString('cs-CZ')} prvků bylo spárováno náhradně podle třídy, Tagu nebo názvu a polohy, výsledek berte orientačně.`));
  }
  // přepínače kategorií = filtr seznamu
  const cats = [['changed', 'Změněné', STATUS.changed], ['added', 'Přidané', STATUS.added], ['removed', 'Odebrané', STATUS.removed], ['same', 'Beze změny', null]];
  const seg = el('div', 'cmp-cats');
  cats.forEach(([k, label, color]) => {
    const b = el('button', 'cmp-cat');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(cmp.filter === k));
    const sw = el('span', 'lg-sw' + (color ? '' : ' ghost'));
    if (color) sw.style.background = color;
    b.append(sw, el('span', 'cmp-cat-n', cmp.counts[k].toLocaleString('cs-CZ')), el('span', 'cmp-cat-l', label));
    b.addEventListener('click', () => { cmp.filter = k; cmp.limit = 200; renderCmpPanel(); });
    seg.appendChild(b);
  });
  root.appendChild(seg);
  if (cmp.filter === 'changed') {
    const kinds = el('div', 'seg cmp-kind');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Druh změny');
    [['all', 'Vše'], ['geom', 'Geometrie'], ['props', 'Vlastnosti']].forEach(([k, l]) => {
      const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', String(cmp.kind === k));
      b.addEventListener('click', () => { cmp.kind = k; applyCompareColors(); renderCmpPanel(); });
      kinds.appendChild(b);
    });
    root.appendChild(kinds);
  }
  // seznam
  const list = el('div', 'res');
  let rows = [];
  if (cmp.filter === 'removed') {
    rows = cmp.removed.map((g, i) => ({ id: `g${i}`, cls: g.cls, name: g.name, storey: g.storey, sub: '' }));
  } else {
    for (const [id, it] of cmp.items) {
      if (it.status !== cmp.filter) continue;
      if (it.status === 'changed' && cmp.kind === 'geom' && !it.geom) continue;
      if (it.status === 'changed' && cmp.kind === 'props' && !it.diffs.length) continue;
      const r = S.idx.el.get(id);
      rows.push({ id, cls: r?.a.Třída || '', name: r?.a.Name || '', storey: r?.a.Podlaží || '', sub: cmpSummary(it) });
    }
  }
  if (!rows.length) list.appendChild(el('p', 'muted pad', 'V této skupině nic není.'));
  const groups = new Map();
  rows.forEach((r) => { const g = classLabel(r.cls); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  let shown = 0;
  for (const [g, rs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (shown >= cmp.limit) break;
    const sec = el('section', 'res-group');
    sec.appendChild(el('h3', 'group-title', `${g} · ${rs.length.toLocaleString('cs-CZ')}`));
    for (const r of rs) {
      if (shown++ >= cmp.limit) break;
      const b = el('button', 'res-item');
      b.type = 'button';
      b.appendChild(el('span', 'res-name', r.name || r.cls));
      const sub = [r.storey, r.sub].filter(Boolean).join(' · ');
      if (sub) b.appendChild(el('span', 'res-sub', sub));
      b.addEventListener('click', () => {
        list.querySelectorAll('.res-item.on').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        if (typeof r.id === 'string') { cmpGroup.visible = true; selectGhost(Number(r.id.slice(1))); } else revealAndSelect(r.id);
      });
      sec.appendChild(b);
    }
    list.appendChild(sec);
  }
  if (rows.length > cmp.limit) {
    const more = el('button', 'link more', `Zobrazit další (${(rows.length - cmp.limit).toLocaleString('cs-CZ')})`);
    more.type = 'button';
    more.addEventListener('click', () => { cmp.limit += 400; renderCmpPanel(); });
    list.appendChild(more);
  }
  root.appendChild(list);
}
async function exportCompareCsv() {
  const cmp = S.cmp;
  if (!cmp) return;
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Stav', 'GlobalId', 'Třída', 'Název', 'Podlaží', 'Změna', 'Před', 'Po'].map(q).join(';')];
  const st = { added: 'Přidáno', changed: 'Změněno' };
  for (const [id, it] of cmp.items) {
    if (it.status === 'same') continue;
    const r = S.idx.el.get(id);
    const base = [st[it.status], r?.a.GlobalId, r?.a.Třída, r?.a.Name, r?.a.Podlaží];
    if (it.status === 'added') { lines.push([...base, '', '', ''].map(q).join(';')); continue; }
    if (it.geom) lines.push([...base, 'Geometrie', '', it.geom.text].map(q).join(';'));
    for (const d of it.diffs) lines.push([...base, d.k, d.a, d.b].map(q).join(';'));
  }
  for (const g of cmp.removed) lines.push(['Odebráno', g.guid, g.cls, g.name, g.storey, '', '', ''].map(q).join(';'));
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  await saveFile(`${base}-zmeny.csv`, new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }), 'text/csv');
}
/* =====================================================================
   EXPORT MÍSTNOSTÍ DO EXCELU (.xlsx)
   Soubor se skládá přímo v prohlížeči (SpreadsheetML zabalený přes fflate).
   ===================================================================== */
function xlsxBlob(sheets) {
  const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // styly: 0 výchozí, 1 hlavička, 2 číslo 0,00, 3 číslo 0,000, 4 celé číslo, 5 tučný řádek součtu (0,00), 6 tučný text
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECE9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8A9490"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const files = {};
  const sheetXml = (sh) => {
    const ncol = sh.cols.length;
    let rows = `<row r="1">${sh.cols.map((c, i) => `<c r="${col(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${x(c.h)}</t></is></c>`).join('')}</row>`;
    sh.rows.forEach((r, ri) => {
      const rn = ri + 2;
      let cells = '';
      r.forEach((v, ci) => {
        if (v == null || v === '') return;
        const ref = `${col(ci)}${rn}`;
        const bold = sh.boldRows?.has(ri);
        if (typeof v === 'number' && Number.isFinite(v)) {
          const st = bold ? 5 : sh.cols[ci].fmt === 'int' ? 4 : sh.cols[ci].fmt === '3' ? 3 : sh.cols[ci].fmt === '2' ? 2 : 0;
          cells += `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}" t="inlineStr"${bold ? ' s="6"' : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
        }
      });
      rows += `<row r="${rn}">${cells}</row>`;
    });
    const last = `${col(ncol - 1)}${sh.rows.length + 1}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${sh.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData>
${sh.filter !== false && sh.rows.length ? `<autoFilter ref="A1:${last}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
  };
  const safeName = (n, i) => (String(n).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `List${i + 1}`);
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sh)); });
  files['xl/styles.xml'] = strToU8(styles);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sh, i) => `<sheet name="${x(safeName(sh.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${sheets.map((sh, i) => (sh.filter !== false && sh.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(safeName(sh.name, i)).replace(/'/g, "''")}'!$A$1:$${col(sh.cols.length - 1)}$${sh.rows.length + 1}</definedName>` : '')).join('')}</definedNames>
</workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sh, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(sheets[0]?.name || '')}</dc:title><dc:creator>IFC prohlížečka</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((sh, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
/* všechny místnosti modelu s podlažím (podle stromu i podle přiřazení geometrie) */
function allSpaces() {
  const out = new Map(); // id -> storeyId
  const walk = (n, st) => {
    let s = st;
    if (U(n.type || '') === 'IFCBUILDINGSTOREY') s = n.expressID;
    if (U(n.type || '') === 'IFCSPACE') out.set(n.expressID, s);
    for (const c of n.children || []) walk(c, s);
  };
  if (S.tree) walk(S.tree, null);
  for (const [id, rec] of S.elements) if (U(rec.cls) === 'IFCSPACE' && !out.has(id)) out.set(id, rec.storey);
  return out;
}
/* objem uzavřené geometrie (součet orientovaných čtyřstěnů) */
function meshVolume(rec) {
  let V = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of rec?.meshes || []) {
    const pos = m.geometry.attributes.position, ix = m.geometry.index?.array;
    if (!pos || !ix) continue;
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(pos, ix[i]).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ix[i + 1]).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ix[i + 2]).applyMatrix4(m.matrixWorld);
      V += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return Math.abs(V);
}
async function exportRoomsXlsx(onlyIds, label) {
  if (S.modelID == null) return;
  const all = allSpaces();
  const ids = onlyIds ? onlyIds.filter((id) => all.has(id) || S.elements.has(id)) : [...all.keys()];
  if (!ids.length) { toast('Model nemá žádné místnosti (IfcSpace).', true); return; }
  toast('Připravuji tabulku místností…');
  try { await ensureIndex(); } catch (e) { /* bez indexu jen základní údaje */ }
  const stInfo = new Map(S.storeys.map((s, i) => [s.id, { name: s.name, order: i }]));
  const stName = (sid) => stInfo.get(sid)?.name || (() => { try { return val(S.api.GetLine(S.modelID, sid)?.Name); } catch (e) { return ''; } })() || '';
  const geo = S.geo?.ok;
  const [lE, lN, lH] = geoLabels();
  const rows = [];
  const propKeys = new Map(); // key -> {num}
  for (const id of ids) {
    const rec = S.elements.get(id);
    const r = S.idx?.ready ? S.idx.el.get(id) : null;
    let name = r?.a.Name || '', ln = r?.a.LongName || '', gid = r?.a.GlobalId || '';
    if (!r) { try { const L = S.api.GetLine(S.modelID, id); name = val(L?.Name); ln = val(L?.LongName); gid = val(L?.GlobalId); } catch (e) { /* ignore */ } }
    const sid = all.get(id) ?? rec?.storey;
    const fp = rec ? spaceFootprint(id) : null;
    const ar = spaceArea(id, fp);
    let h = null, vol = null, E = null, N = null, H = null;
    if (rec) {
      const bx = boxOf(rec.meshes);
      if (!bx.isEmpty()) h = bx.max.y - bx.min.y;
      vol = meshVolume(rec) || null;
      if (fp) {
        const p = new THREE.Vector3(fp.x, fp.y, fp.z);
        if (geo) { const m = geoMapFromScene(p); [E, N, H] = geoValues(m); } else { const l = toIfcPoint(p); E = l.x; N = l.y; H = l.z; }
      }
    }
    const props = new Map();
    if (r) {
      for (const s of [...r.tsets, ...r.sets]) for (const [k, v] of s.props) props.set(k, v);
      for (const [k, v] of props) { let pk = propKeys.get(k); if (!pk) { pk = { num: true }; propKeys.set(k, pk); } if (typeof v !== 'number') pk.num = false; }
    }
    rows.push({
      order: stInfo.get(sid)?.order ?? 9999, storey: sid != null && sid !== -1 ? stName(sid) : '',
      name, ln, area: ar?.v ?? null, src: ar ? (ar.src === 'geometrie' ? 'geometrie' : ar.src) : '', garea: fp?.area || null,
      h, vol, E, N, H, gid, type: r?.a.Typ || '', props,
    });
  }
  const coll = new Intl.Collator('cs', { numeric: true });
  rows.sort((a, b) => a.order - b.order || coll.compare(a.name || a.ln, b.name || b.ln));
  const pkeys = [...propKeys.keys()].sort(coll.compare);
  const cols = [
    { h: 'Podlaží', w: 12 }, { h: 'Číslo (Name)', w: 14 }, { h: 'Název (LongName)', w: 28 },
    { h: 'Plocha [m²]', w: 12, fmt: '2' }, { h: 'Zdroj plochy', w: 30 }, { h: 'Plocha z geometrie [m²]', w: 14, fmt: '2' },
    { h: 'Výška z geometrie [m]', w: 12, fmt: '2' }, { h: 'Objem z geometrie [m³]', w: 13, fmt: '2' },
    { h: geo ? `Těžiště ${lE}` : 'Těžiště x', w: 15, fmt: '3' }, { h: geo ? `Těžiště ${lN}` : 'Těžiště y', w: 15, fmt: '3' }, { h: geo ? `Podlaha ${lH}` : 'Podlaha z', w: 13, fmt: '3' },
    { h: 'Typ', w: 16 }, { h: 'GlobalId', w: 25 },
    ...pkeys.map((k) => ({ h: k, w: Math.min(Math.max(12, k.length * 0.9), 34), fmt: propKeys.get(k).num ? '2' : null })),
  ];
  const rd = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  const data = rows.map((r) => [r.storey, r.name, r.ln, rd(r.area, 4), r.src, rd(r.garea, 3), rd(r.h, 3), rd(r.vol, 3), rd(r.E, 3), rd(r.N, 3), rd(r.H, 3), r.type, r.gid, ...pkeys.map((k) => { const v = r.props.get(k); return v == null ? '' : typeof v === 'number' ? v : String(v); })]);
  // souhrn po podlažích
  const sum = new Map();
  for (const r of rows) {
    const k = r.storey || 'Mimo podlaží';
    if (!sum.has(k)) sum.set(k, { order: r.order, n: 0, a: 0 });
    const s0 = sum.get(k); s0.n++; s0.a += r.area || 0;
  }
  const sumRows = [...sum.entries()].sort((a, b) => a[1].order - b[1].order).map(([k, v]) => [k, v.n, rd(v.a, 3)]);
  const tot = sumRows.reduce((t, r) => [t[0] + r[1], t[1] + r[2]], [0, 0]);
  sumRows.push(['Celkem', tot[0], rd(tot[1], 3)]);
  // souhrn podle účelu / LongName
  const useKey = pkeys.find((k) => /\.(Ucel|Účel|Usage|OccupancyType)$/i.test(k));
  const byUse = new Map();
  for (const r of rows) {
    const u = (useKey ? r.props.get(useKey) : r.ln) || '(neuvedeno)';
    if (!byUse.has(u)) byUse.set(u, { n: 0, a: 0 });
    const s0 = byUse.get(u); s0.n++; s0.a += r.area || 0;
  }
  const useRows = [...byUse.entries()].sort((a, b) => b[1].a - a[1].a).map(([k, v]) => [String(k), v.n, rd(v.a, 3)]);
  useRows.push(['Celkem', tot[0], rd(tot[1], 3)]);
  const sheets = [
    { name: 'Místnosti', cols, rows: data },
    { name: 'Souhrn podle podlaží', cols: [{ h: 'Podlaží', w: 22 }, { h: 'Počet místností', w: 16, fmt: 'int' }, { h: 'Plocha celkem [m²]', w: 18, fmt: '2' }], rows: sumRows, filter: false, boldRows: new Set([sumRows.length - 1]) },
    { name: useKey ? 'Souhrn podle účelu' : 'Souhrn podle názvu', cols: [{ h: useKey ? useKey.slice(useKey.indexOf('.') + 1) : 'Název (LongName)', w: 28 }, { h: 'Počet místností', w: 16, fmt: 'int' }, { h: 'Plocha celkem [m²]', w: 18, fmt: '2' }], rows: useRows, filter: false, boldRows: new Set([useRows.length - 1]) },
  ];
  const blob = xlsxBlob(sheets);
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  const suffix = label ? `-${String(label).replace(/[\\/:*?"<>|]+/g, '_')}` : '';
  await saveFile(`${base}${suffix}-mistnosti.xlsx`, blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

$('#cmp-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; compareWith(f); });

/* =====================================================================
   DATA: MAPOVÉ PODKLADY (WMS, ArcGIS) A VEKTOROVÁ DATA (ArcGIS)
   Výřez kolem modelu se vyžádá v souřadnicích georeference (S-JTSK
   EPSG:5514 nebo EPSG modelu) a položí se pod model do výšky podkladu.
   Do půdorysu se dostane sám, protože půdorys je pohled na stejnou scénu.
   ===================================================================== */
const CUZK = 'https://ags.cuzk.gov.cz';
const DATA_CATALOG = [
  { group: 'Mapy', items: [
    { key: 'orto', name: 'Ortofoto ČR', note: 'ČÚZK', src: { type: 'agsmap', url: `${CUZK}/arcgis1/rest/services/ORTOFOTO/MapServer`, format: 'jpg' } },
    { key: 'km', name: 'Katastrální mapa', note: 'ČÚZK, WMS', src: { type: 'wms', url: 'https://services.cuzk.gov.cz/wms/local-km-wms.asp', layers: 'KN' } },
    { key: 'ztm', name: 'Základní topografická mapa', note: 'ČÚZK', src: { type: 'agsmap', url: `${CUZK}/arcgis1/rest/services/ZTM/MapServer`, format: 'png' } },
    { key: 'zabaged', name: 'ZABAGED polohopis', note: 'ČÚZK, s atributy', src: { type: 'agsmap', url: `${CUZK}/arcgis/rest/services/ZABAGED_POLOHOPIS/MapServer`, format: 'png32', transparent: true, identify: true } },
    { key: 'vrst', name: 'Vrstevnice', note: 'ČÚZK ZABAGED', src: { type: 'agsmap', url: `${CUZK}/arcgis/rest/services/ZABAGED_VRSTEVNICE/MapServer`, format: 'png32', transparent: true } },
  ] },
  { group: 'Digitální technická mapa (DMVS)', items: [
    { key: 'dtm_ti', name: 'DTM – technická infrastruktura', note: 'ČÚZK DMVS, veřejná část, WMS 1.3.0', src: { type: 'wms', url: 'https://dmvs.cuzk.gov.cz/api/wms/dtm_ti_ver', layers: '*', version: '1.3.0' } },
    { key: 'dtm_di', name: 'DTM – dopravní infrastruktura', note: 'ČÚZK DMVS, WMS 1.3.0', src: { type: 'wms', url: 'https://dmvs.cuzk.gov.cz/api/wms/dtm_di_ver', layers: '*', version: '1.3.0' } },
  ] },
  { group: 'Terén', items: [
    { key: 'dmr5g', name: 'Terén DMR 5G', note: 'ČÚZK, mřížka 2 m, mapy a vektory se na něj položí', src: { type: 'agsterrain', url: `${CUZK}/arcgis2/rest/services/dmr5g/ImageServer`, cell: 2 } },
    { key: 'dmp1g', name: 'Povrch DMP 1G', note: 'ČÚZK, včetně budov a vegetace', src: { type: 'agsterrain', url: `${CUZK}/arcgis2/rest/services/dmp1g/ImageServer`, cell: 1 } },
  ] },
  { group: '3D budovy', items: [
    { key: 'brno3d', name: 'Brno – budovy LoD2 (barevné)', note: 'Magistrát města Brna, SceneServer', src: { type: 'i3s', url: 'https://gis.brno.cz/ags1/rest/services/OMI/OMI_3D_budovy_lod2_obarveny_sjtsk/SceneServer' } },
  ] },
  { group: 'Katastr a adresy (RÚIAN, vektory s atributy)', items: [
    { key: 'parcely', name: 'Parcely', note: 'čísla parcel, výměra', src: { type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/5`, label: 'cisloparcely', color: '#1baf7a' } },
    { key: 'budovy', name: 'Stavební objekty', note: 'čísla domovní, podlaží', src: { type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/3`, label: 'cisladomovni', color: '#e34948' } },
    { key: 'adresy', name: 'Adresní místa', note: 'body adres', src: { type: 'agsfeat', url: `${CUZK}/arcgis/rest/services/RUIAN/MapServer/1`, color: '#6250d6' } },
  ] },
];
const DATA_KEY = 'ifc-nahled-data-layers';
const dataGroup = new THREE.Group();
dataGroup.name = 'data';
scene.add(dataGroup);
const D = {
  layers: [], margin: 100, groundH: null, info: false, infoAt: null, infoRes: null, seq: 0, inspect: null,
};
try {
  const saved = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
  if (saved) { D.margin = saved.margin || 100; (saved.layers || []).forEach((l) => D.layers.push({ ...l, id: ++D.seq, state: 'idle' })); }
} catch (e) { /* ignore */ }
function saveDataLayers() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify({ margin: D.margin, layers: D.layers.map((l) => ({ name: l.name, note: l.note, src: l.src, visible: l.visible, opacity: l.opacity })) })); } catch (e) { /* ignore */ }
}
S.data = D;

/* převod mezi lokálními souřadnicemi IFC a souřadnicemi požadavku (EPSG:5514 E/N pro S-JTSK, jinak EPSG modelu) */
function dataFrame() {
  const g = S.geo;
  if (!g?.ok) return null;
  const sr = g.jtsk ? 5514 : g.epsg;
  if (!sr) return null;
  const flip = g.jtsk && (g.jtskPositive || g.epsg === 5513 || g.epsg === 2065) ? -1 : 1;
  const m = (x, y, z) => { const r = geoMapFromLocal({ x, y, z }); return [flip * r.E, flip * r.N, r.H]; };
  const o = m(0, 0, 0), ax = m(1, 0, 0), ay = m(0, 1, 0), az = m(0, 0, 1);
  const bx = [ax[0] - o[0], ax[1] - o[1]], by = [ay[0] - o[0], ay[1] - o[1]];
  const det = bx[0] * by[1] - bx[1] * by[0];
  const hz = az[2] - o[2] || 1;
  return {
    sr,
    toReq: (x, y) => [o[0] + bx[0] * x + by[0] * y, o[1] + bx[1] * x + by[1] * y],
    toLocal: (E, N) => { const dE = E - o[0], dN = N - o[1]; return [(dE * by[1] - dN * by[0]) / det, (bx[0] * dN - bx[1] * dE) / det]; },
    localZ: (H) => (H - o[2]) / hz,
    H: (z) => o[2] + hz * z,
  };
}
/* výška podkladu v H (Bpv): výchozí ±0,000 modelu, mírně pod ní kvůli překryvu s podlahou */
function dataGroundH(F) {
  if (D.groundH != null) return D.groundH;
  return F.H(0);
}
function dataScene(F, E, N, H, dz = 0) {
  const [x, y] = F.toLocal(E, N);
  return toScenePoint(new THREE.Vector3(x, y, F.localZ(H) + dz));
}
/* výřez: obálka modelu v souřadnicích požadavku + okolí */
function dataExtent(F) {
  const b = S.bbox;
  if (b.isEmpty()) return null;
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
    const l = toIfcPoint(new THREE.Vector3(x, b.min.y, z));
    const [E, N] = F.toReq(l.x, l.y);
    e0 = Math.min(e0, E); n0 = Math.min(n0, N); e1 = Math.max(e1, E); n1 = Math.max(n1, N);
  }
  const m = D.margin;
  e0 -= m; n0 -= m; e1 += m; n1 += m;
  const w = e1 - e0, h = n1 - n0;
  const px = 2048 / Math.max(w, h);
  return { e0, n0, e1, n1, W: Math.max(64, Math.round(w * px)), H: Math.max(64, Math.round(h * px)) };
}
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
function imageUrl(src, F, X) {
  const bbox = [X.e0, X.n0, X.e1, X.n1].map((v) => v.toFixed(3)).join(',');
  if (src.type === 'wms') {
    const sep = src.url.includes('?') ? '&' : '?';
    const v13 = String(src.version || '1.1.1').startsWith('1.3');
    // projektované systémy (5514, UTM, 3857) mají ve WMS 1.3.0 pořadí os E, N jako 1.1.1
    return `${src.url}${sep}${qs({ SERVICE: 'WMS', VERSION: v13 ? '1.3.0' : '1.1.1', REQUEST: 'GetMap', LAYERS: src.layers || '', STYLES: '', [v13 ? 'CRS' : 'SRS']: `EPSG:${F.sr}`, BBOX: bbox, WIDTH: X.W, HEIGHT: X.H, FORMAT: src.format || 'image/png', TRANSPARENT: 'TRUE' })}`;
  }
  if (src.type === 'agsimg') {
    return `${src.url}/exportImage?${qs({ bbox, bboxSR: F.sr, imageSR: F.sr, size: `${X.W},${X.H}`, format: 'jpgpng', f: 'image' })}`;
  }
  const p = { bbox, bboxSR: F.sr, imageSR: F.sr, size: `${X.W},${X.H}`, format: src.format || 'png32', transparent: src.transparent ? 'true' : 'false', dpi: 96, f: 'image' };
  if (src.layers) p.layers = `show:${src.layers}`;
  return `${src.url}/export?${qs(p)}`;
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Služba nevrátila obrázek. Buď hlásí chybu, nebo nepovoluje načtení do jiné aplikace (CORS).'));
    img.src = url;
  });
}
async function fetchJson(url) {
  let r;
  try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('Službu se nepodařilo zavolat. Je online a povoluje přístup z jiné aplikace (CORS)?'); }
  if (!r.ok) throw new Error(`Služba vrátila chybu ${r.status}.`);
  const j = await r.json();
  if (j?.error) throw new Error(j.error.message || 'Chyba služby.');
  return j;
}
function disposeLayerObj(L) {
  if (!L.obj) return;
  L.obj.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  dataGroup.remove(L.obj);
  L.obj = null;
}
/* načtení jedné vrstvy */
async function loadDataLayer(L) {
  const F = dataFrame();
  if (!F) { L.state = 'error'; L.error = 'Model není georeferencovaný.'; return; }
  const X = dataExtent(F);
  if (!X) return;
  L.token = (L.token || 0) + 1;
  const token = L.token;
  L.state = 'loading'; L.error = ''; L.warn = ''; renderDataPanel();
  try {
    if (L.src.type === 'agsfeat') {
      if (!L.info) {
        const info = await fetchJson(`${L.src.url}?f=json`);
        L.info = { name: info.name, geometryType: info.geometryType, fields: (info.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type })), displayField: info.displayField };
      }
      const q = await fetchJson(`${L.src.url}/query?${qs({ where: '1=1', geometry: `${X.e0},${X.n0},${X.e1},${X.n1}`, geometryType: 'esriGeometryEnvelope', inSR: F.sr, spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: F.sr, resultRecordCount: 4000, f: 'json' })}`);
      if (token !== L.token) return;
      L.features = q.features || [];
      L.exceeded = !!q.exceededTransferLimit;
    } else if (L.src.type === 'agsterrain') {
      L.dem = await loadTerrain(L.src, F, X);
      if (token !== L.token) return;
    } else if (L.src.type === 'i3s') {
      L.i3s = await loadI3S(L, F, X, () => token === L.token);
      if (token !== L.token) return;
    } else {
      if (L.src.type === 'wms' && (!L.src.layers || L.src.layers === '*')) {
        const cap = await wmsCaps(L.src.url);
        Object.assign(L.src, { layers: cap.all || cap.layers.map((l) => l.name).join(','), version: cap.version, format: cap.format, infoFormat: cap.infoFormat, queryable: cap.queryAll });
        saveDataLayers();
      }
      const img = await loadImage(imageUrl(L.src, F, X));
      if (token !== L.token) return;
      L.img = img; L.ext = X;
    }
    L.state = 'ok';
    if (L.src.type === 'agsterrain') rebuildDataLayers(); else buildDataLayer(L);
  } catch (e) {
    if (token !== L.token) return;
    L.state = 'error'; L.error = e.message || String(e);
  }
  renderDataPanel();
  requestRender(); markPlanDirty(0);
}

/* ---------- terén z ArcGIS ImageServeru (LERC, výšky float32) ---------- */
async function loadTerrain(src, F, X) {
  const cell = src.cell || 2;
  let W = Math.round((X.e1 - X.e0) / cell) + 1, H = Math.round((X.n1 - X.n0) / cell) + 1;
  const k = Math.max(1, Math.max(W, H) / 400);
  W = Math.max(8, Math.round(W / k)); H = Math.max(8, Math.round(H / k));
  const url = `${src.url}/exportImage?${qs({ bbox: `${X.e0},${X.n0},${X.e1},${X.n1}`, bboxSR: F.sr, imageSR: F.sr, size: `${W},${H}`, format: 'lerc', pixelType: 'F32', noDataInterpretation: 'esriNoDataMatchAny', interpolation: 'RSP_BilinearInterpolation', f: 'image' })}`;
  let r;
  try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('Terén se nepodařilo načíst. Služba nepovoluje přístup z jiné aplikace (CORS), nebo je nedostupná.'); }
  if (!r.ok) throw new Error(`Služba terénu vrátila chybu ${r.status}.`);
  const buf = await r.arrayBuffer();
  try { await Lerc.load({ locateFile: (name) => new URL(name, document.baseURI).href }); } catch (e) { throw new Error('Dekodér výšek (lerc-wasm.wasm) se nepodařilo načíst.'); }
  let img;
  try { img = Lerc.decode(buf); } catch (e) {
    let msg = 'Odpověď služby není výškový rastr (LERC).';
    try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j?.error?.message) msg = j.error.message; } catch (_) { /* binární */ }
    throw new Error(msg);
  }
  const z = img.pixels[0];
  const mask = img.mask;
  let lo = Infinity, hi = -Infinity;
  const vals = new Float32Array(img.width * img.height);
  for (let i = 0; i < vals.length; i++) {
    const v = z[i];
    const ok = (!mask || mask[i]) && Number.isFinite(v) && v > -1000 && v < 10000;
    vals[i] = ok ? v : NaN;
    if (ok) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!Number.isFinite(lo)) throw new Error('Pro okolí modelu služba nevrátila žádné výšky.');
  // díry (NoData) doplnit průměrem
  const mean = (lo + hi) / 2;
  for (let i = 0; i < vals.length; i++) if (Number.isNaN(vals[i])) vals[i] = mean;
  return { X, W: img.width, H: img.height, z: vals, lo, hi };
}
/* aktivní terén = nejvýše položená viditelná načtená vrstva terénu */
function activeDem() {
  for (let i = D.layers.length - 1; i >= 0; i--) { const L = D.layers[i]; if (L.visible && L.state === 'ok' && L.dem) return L.dem; }
  return null;
}
/* výška terénu (bilineárně) v souřadnicích požadavku; mimo rastr null */
function demHeight(dem, E, N) {
  const { X, W, H, z } = dem;
  const fx = (E - X.e0) / (X.e1 - X.e0) * W - 0.5, fy = (X.n1 - N) / (X.n1 - X.n0) * H - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > W - 0.5 || fy > H - 0.5) return null;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(fy)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  const a = z[y0 * W + x0], b = z[y0 * W + x1], c = z[y1 * W + x0], d = z[y1 * W + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
/* síť terénu ve scéně; uvExt = výřez obrázku, který se na terén natáhne */
function demGeometry(dem, F, lift, uvExt) {
  const { X, W, H, z } = dem;
  const pos = new Float32Array(W * H * 3), uv = uvExt ? new Float32Array(W * H * 2) : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const E = X.e0 + (i + 0.5) / W * (X.e1 - X.e0), N = X.n1 - (j + 0.5) / H * (X.n1 - X.n0);
    const s = dataScene(F, E, N, z[j * W + i], lift);
    const k = j * W + i;
    pos[k * 3] = s.x; pos[k * 3 + 1] = s.y; pos[k * 3 + 2] = s.z;
    if (uv) { uv[k * 2] = (E - uvExt.e0) / (uvExt.e1 - uvExt.e0); uv[k * 2 + 1] = (N - uvExt.n0) / (uvExt.n1 - uvExt.n0); }
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let t = 0;
  for (let j = 0; j + 1 < H; j++) for (let i = 0; i + 1 < W; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* ---------- 3D budovy ze SceneServeru (I3S, vrstva 3DObject / IntegratedMesh) ---------- */
const I3S_TYPES = { Float32: [Float32Array, 4], Float64: [Float64Array, 8], UInt8: [Uint8Array, 1], Int8: [Int8Array, 1], UInt16: [Uint16Array, 2], Int16: [Int16Array, 2], UInt32: [Uint32Array, 4], Int32: [Int32Array, 4], UInt64: [null, 8] };
async function fetchBin(url) {
  let r;
  try { r = await fetch(url, { mode: 'cors' }); } catch (e) { throw new Error('Data scény nejdou načíst. Služba nepovoluje přístup z jiné aplikace (CORS), nebo je nedostupná.'); }
  if (!r.ok) throw new Error(`Služba vrátila chybu ${r.status}.`);
  return r.arrayBuffer();
}
async function loadI3S(L, F, X, alive) {
  const base = L.src.url.replace(/\/+$/, '');
  const layerUrl = /\/layers\/\d+$/i.test(base) ? base : `${base}/layers/0`;
  const info = await fetchJson(`${layerUrl}?f=json`);
  if (!/3DObject|IntegratedMesh/i.test(info.layerType || '')) throw new Error(`Typ scény „${info.layerType || '?'}“ zatím neumím. Umím 3D objekty (3DObject) a integrovanou síť.`);
  const crs = String(info.store?.vertexCRS || info.spatialReference?.latestWkid || info.spatialReference?.wkid || '');
  const epsg = Number((crs.match(/(\d{4,6})\s*$/) || [])[1]) || null;
  const okCrs = epsg === F.sr || (F.sr === 5514 && [102067, 5514].includes(Number(info.spatialReference?.wkid)));
  if (!okCrs) throw new Error(`Scéna je v souřadnicovém systému ${epsg ? `EPSG:${epsg}` : crs || 'neznámém'}, model v EPSG:${F.sr}. Umím jen scény ve stejném systému.`);
  if (!info.nodePages) throw new Error('Scéna je ve starší verzi I3S bez nodePages, tu zatím neumím.');
  const gdef = info.geometryDefinitions?.[0];
  const bufIdx = gdef ? gdef.geometryBuffers.findIndex((b) => !b.compressedAttributes) : -1;
  if (bufIdx < 0) throw new Error('Scéna má jen komprimovanou geometrii (Draco), tu zatím neumím.');
  const layout = gdef.geometryBuffers[bufIdx];
  const per = Math.max(1, info.nodePages.nodesPerPage || 64);
  const pages = new Map();
  const node = async (i) => {
    const p = Math.floor(i / per);
    if (!pages.has(p)) pages.set(p, fetchJson(`${layerUrl}/nodepages/${p}?f=json`));
    const pg = await pages.get(p);
    return pg.nodes.find((n) => n.index === i) || pg.nodes[i - p * per];
  };
  const inExt = (n) => {
    const c = n.obb?.center, h = n.obb?.halfSize;
    if (!c || !h) return true;
    const r = Math.hypot(h[0], h[1], h[2]);
    const dx = Math.max(X.e0 - c[0], 0, c[0] - X.e1), dy = Math.max(X.n0 - c[1], 0, c[1] - X.n1);
    return dx * dx + dy * dy <= r * r;
  };
  // průchod stromem: do listů (nejvyšší podrobnost) jen tam, kde zasahují do výřezu
  const leaves = [];
  const stack = [info.nodePages.rootIndex || 0];
  let visits = 0;
  while (stack.length) {
    if (!alive()) throw new Error('aborted');
    const n = await node(stack.pop());
    if (!n || ++visits > 5000 || !inExt(n)) continue;
    if (n.children?.length) n.children.forEach((c) => stack.push(c));
    else if (n.mesh?.geometry) leaves.push(n);
    if (leaves.length > 160) break;
  }
  if (!leaves.length) throw new Error('V okolí modelu scéna nic neobsahuje.');
  const out = { layerUrl, info, nodes: [], warn: leaves.length > 160 ? 'Scéna je v okolí modelu hodně podrobná, načetla se jen část. Zmenšete okolí.' : '' };
  for (const n of leaves) {
    if (!alive()) throw new Error('aborted');
    const buf = await fetchBin(`${layerUrl}/nodes/${n.mesh.geometry.resource}/geometries/${bufIdx}`);
    const g = parseI3SGeometry(buf, layout);
    if (g) out.nodes.push({ n, g });
  }
  return out;
}
function parseI3SGeometry(buf, layout) {
  const dv = new DataView(buf);
  const vc = dv.getUint32(0, true), fc = buf.byteLength >= 8 ? dv.getUint32(4, true) : 0;
  let off = layout.offset ?? 8;
  const res = { vc, fc };
  for (const [name, spec] of Object.entries(layout)) {
    if (!spec || typeof spec !== 'object' || !spec.type) continue;
    const [T, size] = I3S_TYPES[spec.type] || [];
    if (!size) return null;
    const count = (spec.binding === 'per-feature' ? fc : vc) * (spec.component || 1);
    const bytes = count * size;
    if (off + bytes > buf.byteLength) return res.position ? res : null;
    if (name === 'featureId' && spec.type === 'UInt64') {
      const ids = new Float64Array(count);
      for (let i = 0; i < count; i++) ids[i] = dv.getUint32(off + i * 8, true) + dv.getUint32(off + i * 8 + 4, true) * 4294967296;
      res.featureId = ids;
    } else if (T) {
      res[name] = new T(buf.slice(off, off + bytes));
    }
    off += bytes;
  }
  return res.position ? res : null;
}
/* matice ze souřadnic požadavku (E, N, H) do scény */
function reqToSceneMatrix(F) {
  const f = (E, N, H) => dataScene(F, E, N, H, 0);
  const o = f(0, 0, 0);
  const ex = f(1, 0, 0).sub(o), ny = f(0, 1, 0).sub(o), hz = f(0, 0, 1).sub(o);
  return new THREE.Matrix4().makeBasis(ex, ny, hz).setPosition(o);
}
function buildI3S(L, F) {
  const grp = new THREE.Group();
  const M = reqToSceneMatrix(F);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: (L.opacity ?? 1) < 1, opacity: L.opacity ?? 1 });
  const plain = new THREE.MeshLambertMaterial({ color: 0xd9d4cc, side: THREE.DoubleSide, transparent: (L.opacity ?? 1) < 1, opacity: L.opacity ?? 1 });
  for (const { n, g } of L.i3s.nodes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
    if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3)); else geo.computeVertexNormals();
    let m0 = plain;
    if (g.color) { geo.setAttribute('color', new THREE.BufferAttribute(g.color, 4, true)); m0 = mat; mat.vertexAlphas = false; }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m0);
    mesh.matrixAutoUpdate = false;
    const c = n.obb.center;
    mesh.matrix.copy(M).multiply(new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]));
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData.i3s = { n, g };
    grp.add(mesh);
  }
  return grp;
}
/* atributy prvku scény (binární bufery podle attributeStorageInfo) */
async function i3sAttributes(L, n, k) {
  const info = L.i3s.info;
  const rows = [];
  for (const a of info.attributeStorageInfo || []) {
    try {
      const buf = await fetchBin(`${L.i3s.layerUrl}/nodes/${n.mesh.attribute?.resource ?? n.mesh.geometry.resource}/attributes/${a.key}/0`);
      const dv = new DataView(buf);
      const count = dv.getUint32(0, true);
      if (k >= count) continue;
      const vt = a.attributeValues?.valueType;
      let v = null;
      if (vt === 'String') {
        const total = dv.getUint32(4, true);
        let p = 8;
        const lens = [];
        for (let i = 0; i < count; i++) { lens.push(dv.getUint32(p, true)); p += 4; }
        for (let i = 0; i < k; i++) p += lens[i];
        v = new TextDecoder().decode(new Uint8Array(buf, p, Math.max(0, lens[k] - 1)));
        void total;
      } else if (I3S_TYPES[vt]?.[0]) {
        const [T, size] = I3S_TYPES[vt];
        let start = (a.header || []).length * 4;
        if (size === 8 && start % 8) start += 8 - (start % 8);
        v = new T(buf.slice(start + k * size, start + (k + 1) * size))[0];
        if (vt === 'Float64' && Math.abs(v) > 1e37) v = null;
      }
      if (v != null && v !== '') {
        const fld = (info.fields || []).find((f) => f.name === a.name);
        rows.push([fld?.alias || a.name, typeof v === 'number' ? nf.format(v) : String(v)]);
      }
    } catch (e) { /* atribut nejde načíst */ }
  }
  return rows;
}

/* sestavení 3D objektů vrstvy (obrázek = deska nebo potah terénu, vektory = čáry a výplně) */
function buildDataLayer(L) {
  disposeLayerObj(L);
  const F = dataFrame();
  if (!F || L.state !== 'ok') return;
  const H = dataGroundH(F);
  const idx = D.layers.indexOf(L);
  const dem = activeDem();
  const lift = -0.06 + idx * 0.004;
  const grp = new THREE.Group();
  if (L.dem) {
    // terén: stínovaný povrch
    const geo = demGeometry(L.dem, F, 0, null);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(isDarkTheme() ? '#5d665f' : '#c9cfc4'), side: THREE.DoubleSide, transparent: (L.opacity ?? 1) < 1, opacity: L.opacity ?? 1, depthWrite: (L.opacity ?? 1) >= 1 }));
    m.renderOrder = -30;
    m.userData.dem = true;
    grp.add(m);
  } else if (L.i3s) {
    grp.add(buildI3S(L, F));
  } else if (L.img) {
    const X = L.ext;
    const tex = new THREE.Texture(L.img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: L.opacity ?? 1, depthWrite: false, side: THREE.DoubleSide });
    let geo;
    if (dem) {
      // potah terénu: stejná síť, posunutá nad terén, aby se s ním nepřekrývala
      geo = demGeometry(dem, F, 0.03 + idx * 0.01, X);
      Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 - idx });
    } else {
      const c = [[X.e0, X.n0], [X.e1, X.n0], [X.e1, X.n1], [X.e0, X.n1]].map(([E, N]) => dataScene(F, E, N, H, lift));
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([c[0], c[1], c[2], c[0], c[2], c[3]].flatMap((p) => [p.x, p.y, p.z]), 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -20 + idx;
    grp.add(mesh);
  } else if (L.features) {
    const col = new THREE.Color(L.src.color || '#2a78d6');
    const segs = [], tris = [], pts = [];
    for (const f of L.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.rings) {
        const outer = [];
        for (const r of g.rings) {
          for (let i = 0; i + 1 < r.length; i++) segs.push(r[i], r[i + 1]);
          const v2 = r.map(([E, N]) => { const [x, y] = F.toLocal(E, N); return new THREE.Vector2(x, y); });
          if (v2.length > 2 && v2[0].equals(v2[v2.length - 1])) v2.pop();
          if (v2.length < 3) continue;
          if (THREE.ShapeUtils.isClockWise(v2) || !outer.length) outer.push({ c: THREE.ShapeUtils.isClockWise(v2) ? v2.reverse() : v2, h: [] });
          else outer[outer.length - 1].h.push(THREE.ShapeUtils.isClockWise(v2) ? v2 : v2.reverse());
        }
        if (!dem) {
          for (const o of outer) {
            try {
              const all = [o.c, ...o.h].flat();
              for (const t of THREE.ShapeUtils.triangulateShape(o.c, o.h)) tris.push(all[t[0]], all[t[1]], all[t[2]]);
            } catch (e) { /* vadný polygon */ }
          }
        }
      } else if (g.paths) {
        for (const p of g.paths) for (let i = 0; i + 1 < p.length; i++) segs.push(p[i], p[i + 1]);
      } else if (g.x != null) pts.push([g.x, g.y]);
      else if (g.points) g.points.forEach((q) => pts.push(q));
    }
    // výška bodu: na terénu, jinak na desce podkladu
    const zAt = (E, N, up) => {
      const h = dem ? demHeight(dem, E, N) : null;
      return h != null ? F.localZ(h) + up : F.localZ(H) + lift + 0.012;
    };
    const sceneReq = (E, N, up) => { const [x, y] = F.toLocal(E, N); return toScenePoint(new THREE.Vector3(x, y, zAt(E, N, up))); };
    if (tris.length) {
      const pos = [];
      tris.forEach((v) => { const s = toScenePoint(new THREE.Vector3(v.x, v.y, F.localZ(H) + lift + 0.012)); pos.push(s.x, s.y, s.z); });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07 * (L.opacity ?? 1), depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = -10 + idx;
      grp.add(m);
    }
    if (segs.length) {
      const pos = [];
      const step = dem ? Math.max(1, (dem.X.e1 - dem.X.e0) / dem.W) : Infinity;
      for (let i = 0; i < segs.length; i += 2) {
        const [E1, N1] = segs[i], [E2, N2] = segs[i + 1];
        const n = dem ? Math.min(200, Math.max(1, Math.ceil(Math.hypot(E2 - E1, N2 - N1) / step))) : 1;
        let prev = sceneReq(E1, N1, 0.12);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const cur = sceneReq(E1 + (E2 - E1) * t, N1 + (N2 - N1) * t, 0.12);
          pos.push(prev.x, prev.y + (dem ? 0 : 0.004), prev.z, cur.x, cur.y + (dem ? 0 : 0.004), cur.z);
          prev = cur;
        }
      }
      const lg = new LineSegmentsGeometry().setPositions(pos);
      const lm = new LineMaterial({ color: col, linewidth: 2, worldUnits: false, transparent: true, opacity: L.opacity ?? 1 });
      if (dem) Object.assign(lm, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
      lm.resolution.copy(measureMat.resolution);
      const ls = new LineSegments2(lg, lm);
      ls.renderOrder = -9 + idx;
      grp.add(ls);
    }
    if (pts.length) {
      const disc = new THREE.CircleGeometry(0.6, 16);
      disc.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: L.opacity ?? 1, depthWrite: false }), pts.length);
      const M = new THREE.Matrix4();
      pts.forEach(([E, N], i) => { const s = sceneReq(E, N, 0.15); M.makeTranslation(s.x, s.y + 0.02, s.z); im.setMatrixAt(i, M); });
      im.renderOrder = -8 + idx;
      grp.add(im);
    }
  }
  grp.visible = !!L.visible;
  grp.userData.layer = L.id;
  L.obj = grp;
  dataGroup.add(grp);
}
function rebuildDataLayers() { D.layers.forEach((L) => { if (L.state === 'ok') buildDataLayer(L); }); updateDataMarker(); requestRender(); markPlanDirty(0); }
function reloadDataLayers() { D.layers.filter((L) => L.visible).forEach((L) => { L.img = null; L.features = null; L.dem = null; L.i3s = null; loadDataLayer(L); }); }
function addDataLayer(def) {
  if (D.layers.some((l) => l.src.url === def.src.url && l.src.type === def.src.type && (def.src.layers === '*' || (l.src.layers || '') === (def.src.layers || '')))) { toast('Tato vrstva už je přidaná.'); return; }
  const L = { id: ++D.seq, name: def.name, note: def.note || '', src: { ...def.src }, visible: true, opacity: def.src.type === 'agsfeat' ? 1 : (def.opacity ?? 1), state: 'idle' };
  if (def.src.type === 'agsterrain') D.layers.unshift(L); else D.layers.push(L); // terén patří dospod
  saveDataLayers();
  loadDataLayer(L);
  renderDataPanel();
}
function removeDataLayer(L) {
  L.token = (L.token || 0) + 1;
  disposeLayerObj(L);
  D.layers.splice(D.layers.indexOf(L), 1);
  saveDataLayers();
  rebuildDataLayers();
  renderDataPanel();
}

/* popisky vektorů (čísla parcel, domovní čísla) v půdorysu */
function featureLabelField(L) {
  if (L.src.label) return L.src.label;
  const f = L.info?.fields || [];
  const cand = f.find((x) => /^(cislo|číslo|name|nazev|název|label)/i.test(x.name) && /String/.test(x.type));
  return cand?.name || null;
}
function dataPlanLabels() {
  if (!plan.view || !D.layers.length) return '';
  const F = dataFrame();
  if (!F) return '';
  const { w, h } = planSize();
  let out = '';
  let n = 0;
  for (const L of D.layers) {
    if (!L.visible || L.state !== 'ok' || !L.features) continue;
    const fld = featureLabelField(L);
    if (!fld) continue;
    for (const f of L.features) {
      const v = f.attributes?.[fld];
      if (v == null || v === '') continue;
      const g = f.geometry;
      let E, N, ext = 0;
      if (g?.rings?.[0]) {
        // těžiště nejdelšího prstence
        let best = g.rings[0];
        for (const r of g.rings) if (r.length > best.length) best = r;
        let A = 0, cx = 0, cy = 0, e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
        for (let i = 0; i + 1 < best.length; i++) {
          const [x1, y1] = best[i], [x2, y2] = best[i + 1];
          const c = x1 * y2 - x2 * y1;
          A += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
          e0 = Math.min(e0, x1); e1 = Math.max(e1, x1); n0 = Math.min(n0, y1); n1 = Math.max(n1, y1);
        }
        if (Math.abs(A) < 1e-9) continue;
        E = cx / (3 * A); N = cy / (3 * A);
        ext = Math.min(e1 - e0, n1 - n0) * plan.view.ppm;
      } else if (g?.x != null) { E = g.x; N = g.y; ext = 999; } else continue;
      const txt = String(v);
      if (ext < txt.length * 6.5 + 4) continue;
      const [x, y] = F.toLocal(E, N);
      const s = toScenePoint(new THREE.Vector3(x, y, 0));
      const p = planXY(s.x, s.z);
      if (p.x < -40 || p.y < -20 || p.x > w + 40 || p.y > h + 20) continue;
      out += `<text class="dl" x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" style="fill:${L.src.color || 'var(--ink)'}">${esc(txt)}</text>`;
      if (++n > 600) return out;
    }
  }
  if (D.infoAt) {
    const s = D.infoAt.scene, p = planXY(s.x, s.z);
    out += `<circle class="dl-pin" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"/>`;
  }
  return out;
}

/* ---------- informace o místě (ťuknutí do modelu nebo půdorysu) ---------- */
const dataPin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 16), new THREE.MeshBasicMaterial({ color: '#d03b3b' }));
dataPin.geometry.translate(0, 0.7, 0);
dataPin.geometry.rotateX(Math.PI);
dataPin.visible = false;
scene.add(dataPin);
function updateDataMarker() {
  if (!D.infoAt) { dataPin.visible = false; return; }
  const F = dataFrame();
  if (!F) return;
  const p = dataScene(F, D.infoAt.E, D.infoAt.N, dataGroundH(F), 0);
  D.infoAt.scene = p;
  dataPin.position.copy(p).add(new THREE.Vector3(0, 1.4, 0));
  dataPin.visible = true;
}
function dataIdentifyScreen(cx, cy) {
  const F = dataFrame();
  if (!F) return;
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const gy = dataScene(F, 0, 0, dataGroundH(F), 0);
  // nejdřív model (zasažený bod), jinak rovina podkladu
  const targets = S.meshes.filter((m) => m.visible);
  dataGroup.traverse((o) => { if (o.isMesh && (o.userData.i3s || o.userData.dem)) { let v = true; for (let p0 = o; p0; p0 = p0.parent) if (!p0.visible) v = false; if (v) targets.push(o); } });
  dataGroup.updateMatrixWorld(true);
  const hits = ray.intersectObjects(targets, false).filter((h) => !S.clipOn || clipPlane.distanceToPoint(h.point) >= -1e-4);
  const hit = hits[0];
  let P = hit?.point;
  if (!P) { P = new THREE.Vector3(); if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -gy.y), P)) return; }
  const l = toIfcPoint(P);
  let extra = null;
  if (hit?.object.userData.i3s) {
    const L = D.layers.find((x) => x.obj && x.obj.getObjectById(hit.object.id));
    extra = { i3s: { L, ...hit.object.userData.i3s, face: hit.faceIndex } };
  }
  dataIdentify(...F.toReq(l.x, l.y), extra);
}
function dataIdentifyPlan(p) {
  const F = dataFrame();
  if (!F || !plan.view) return;
  const wpt = planWorld(p.x, p.y);
  const l = toIfcPoint(new THREE.Vector3(wpt.x, 0, wpt.z));
  dataIdentify(...F.toReq(l.x, l.y));
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function segDist(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
async function dataIdentify(E, N, extra) {
  D.infoAt = { E, N };
  updateDataMarker();
  const F = dataFrame();
  const res = [];
  D.infoRes = res;
  const dem = activeDem();
  const th = dem ? demHeight(dem, E, N) : null;
  if (th != null) res.push({ layer: 'Terén', rows: [[`Výška terénu ${S.geo?.jtsk ? '(Bpv)' : '(H)'}`, nf3s.format(th)], ['Rozdíl proti ±0,000 modelu', `${th - F.H(0) >= 0 ? '+' : ''}${nf3s.format(th - F.H(0))} m`]] });
  showPanel('data');
  renderDataPanel();
  updatePlanMarker(); requestRender();
  if (extra?.i3s?.L) {
    const { L, n, g, face } = extra.i3s;
    let k = -1;
    if (g.faceRange) for (let i = 0; i < g.faceRange.length / 2; i++) if (face >= g.faceRange[2 * i] && face <= g.faceRange[2 * i + 1]) { k = i; break; }
    if (k >= 0) {
      const rows = await i3sAttributes(L, n, k).catch(() => []);
      if (!rows.length && g.featureId) rows.push(['ID prvku', String(g.featureId[k])]);
      res.push({ layer: L.name, rows });
      if (D.infoRes === res) renderDataPanel();
    }
  }
  const tolM = Math.max(1, 12 / (plan.view?.ppm || 10));
  for (const L of D.layers) {
    if (!L.visible || L.state !== 'ok') continue;
    if (L.features) {
      const hit = L.features.filter((f) => {
        const g = f.geometry;
        if (!g) return false;
        if (g.rings) return g.rings.reduce((ins, r) => (pointInRing(E, N, r) ? !ins : ins), false);
        if (g.paths) return g.paths.some((p) => p.some((q, i) => i && segDist(E, N, p[i - 1], q) < tolM));
        if (g.x != null) return Math.hypot(g.x - E, g.y - N) < tolM * 1.5;
        return false;
      }).slice(0, 5);
      const alias = new Map((L.info?.fields || []).map((f) => [f.name, f]));
      hit.forEach((f) => res.push({ layer: L.name, rows: attrRows(f.attributes, alias) }));
    } else if (L.src.type === 'agsmap' && L.src.identify !== false && (L.src.identify || L.custom)) {
      const X = L.ext;
      try {
        const j = await fetchJson(`${L.src.url}/identify?${qs({ geometry: `${E},${N}`, geometryType: 'esriGeometryPoint', sr: F.sr, layers: 'visible', tolerance: 4, mapExtent: `${X.e0},${X.n0},${X.e1},${X.n1}`, imageDisplay: `${X.W},${X.H},96`, returnGeometry: 'false', f: 'json' })}`);
        (j.results || []).slice(0, 8).forEach((r0) => res.push({ layer: `${L.name}: ${r0.layerName}`, rows: attrRows(r0.attributes) }));
      } catch (e) { res.push({ layer: L.name, text: e.message }); }
    } else if (L.src.type === 'wms' && L.src.queryable) {
      const X = L.ext;
      const i = Math.round((E - X.e0) / (X.e1 - X.e0) * X.W), jy = Math.round((X.n1 - N) / (X.n1 - X.n0) * X.H);
      const sep = L.src.url.includes('?') ? '&' : '?';
      const v13 = String(L.src.version || '1.1.1').startsWith('1.3');
      const fmt = L.src.infoFormat || 'text/plain';
      const url = `${L.src.url}${sep}${qs({ SERVICE: 'WMS', VERSION: v13 ? '1.3.0' : '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: L.src.layers, QUERY_LAYERS: L.src.queryable, STYLES: '', [v13 ? 'CRS' : 'SRS']: `EPSG:${F.sr}`, BBOX: `${X.e0},${X.n0},${X.e1},${X.n1}`, WIDTH: X.W, HEIGHT: X.H, [v13 ? 'I' : 'X']: i, [v13 ? 'J' : 'Y']: jy, INFO_FORMAT: fmt, FEATURE_COUNT: 5 })}`;
      try {
        const r = await fetch(url, { mode: 'cors' });
        const t = (await r.text()).trim();
        if (/json/i.test(fmt)) {
          const j = JSON.parse(t);
          (j.features || []).slice(0, 8).forEach((f) => res.push({ layer: `${L.name}${f.id ? `: ${f.id}` : ''}`, rows: attrRows(f.properties) }));
        } else if (/html|xml|gml/i.test(fmt)) {
          const d = new DOMParser().parseFromString(t, /html/i.test(fmt) ? 'text/html' : 'text/xml');
          const tx = (d.body || d.documentElement)?.textContent?.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
          if (tx) res.push({ layer: L.name, text: tx.slice(0, 3000) });
        } else if (t) res.push({ layer: L.name, text: t.slice(0, 3000) });
      } catch (e) { res.push({ layer: L.name, text: 'Služba informace neposkytla.' }); }
    }
    if (D.infoRes === res) renderDataPanel();
  }
  res.done = true;
  if (D.infoRes === res) renderDataPanel();
}
function attrRows(attrs, alias) {
  const rows = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === '' || /^(objectid|shape|st_area|st_length|globalid)/i.test(k)) continue;
    const f = alias?.get(k);
    let s = v;
    if (f?.type === 'esriFieldTypeDate' && typeof v === 'number') s = new Date(v).toLocaleDateString('cs-CZ');
    else if (typeof v === 'number') s = nf.format(v);
    rows.push([f?.alias || k, String(s)]);
  }
  return rows;
}

/* ---------- vlastní služba: rozpoznání URL ---------- */
async function inspectService(raw) {
  let url = raw.trim();
  if (!/^https:\/\//i.test(url) && !(location.protocol === 'http:' && /^http:\/\//i.test(url))) throw new Error('Zadejte adresu začínající https:// (aplikace běží na https, http služby prohlížeč zablokuje).');
  const scene = url.match(/^(.*\/SceneServer)(\/layers\/(\d+))?\/?(\?.*)?$/i);
  if (scene) {
    const lid = scene[3] ?? 0;
    const info = await fetchJson(`${scene[1]}/layers/${lid}?f=json`);
    return [{ name: info.name || 'Scéna', note: `SceneServer · ${info.layerType || ''}`, src: { type: 'i3s', url: `${scene[1]}/layers/${lid}` }, custom: true }];
  }
  if (/\/ImageServer\/?(\?.*)?$/i.test(url)) {
    const base0 = url.replace(/\?.*$/, '').replace(/\/+$/, '');
    const info = await fetchJson(`${base0}?f=json`);
    const out0 = [{ name: `${info.name || 'Rastr'} (obrázek)`, note: 'ArcGIS ImageServer', src: { type: 'agsimg', url: base0 }, custom: true }];
    if (info.bandCount === 1 && /F32|F64|S16|S32|U16/i.test(info.pixelType || '')) out0.unshift({ name: `${info.name || 'Rastr'} jako terén`, note: `výšky, buňka ${nf.format(info.pixelSizeX || 0)} m`, src: { type: 'agsterrain', url: base0, cell: info.pixelSizeX || 2 }, custom: true });
    return out0;
  }
  const ags = url.match(/^(.*\/(MapServer|FeatureServer|ImageServer))(\/(\d+))?\/?(\?.*)?$/i);
  if (ags) {
    const base = ags[1], layer = ags[4];
    if (layer != null) {
      const info = await fetchJson(`${base}/${layer}?f=json`);
      return [{ name: info.name || `Vrstva ${layer}`, note: 'ArcGIS, vektory', src: { type: 'agsfeat', url: `${base}/${layer}` }, custom: true }];
    }
    const info = await fetchJson(`${base}?f=json`);
    const title = info.documentInfo?.Title || info.mapName || info.name || base.split('/').slice(-2, -1)[0];
    if (/ImageServer$/i.test(base)) return [{ name: title || 'Rastr', note: 'ArcGIS ImageServer', src: { type: 'agsimg', url: base }, custom: true }];
    const out = [];
    if (/MapServer$/i.test(base)) out.push({ name: `${title} (mapa)`, note: 'ArcGIS, obrázek všech vrstev', src: { type: 'agsmap', url: base, format: 'png32', transparent: true, identify: true }, custom: true });
    const canQuery = /Query/i.test(info.capabilities || '') || /FeatureServer$/i.test(base);
    if (canQuery) (info.layers || []).filter((l) => !l.subLayerIds?.length).slice(0, 60).forEach((l) => out.push({ name: l.name, note: 'vektory s atributy', src: { type: 'agsfeat', url: `${base}/${l.id}` }, custom: true }));
    return out;
  }
  // WMS (1.3.0 i 1.1.1)
  const base = url.replace(/\?.*$/, '');
  const cap = await wmsCaps(base);
  const F = dataFrame();
  const out = [];
  const common = { type: 'wms', url: base, version: cap.version, format: cap.format, infoFormat: cap.infoFormat };
  if (cap.all) out.push({ name: `${cap.title} – všechny vrstvy`, note: `WMS ${cap.version}`, src: { ...common, layers: cap.all, queryable: cap.queryAll } });
  for (const l of cap.layers.slice(0, 80)) out.push({ name: l.title, note: `WMS ${cap.version} · ${cap.title}`, src: { ...common, layers: l.name, queryable: l.queryable ? l.name : '' } });
  if (F && !cap.crs.includes(`EPSG:${F.sr}`)) out.warn = `Služba v popisu neuvádí souřadnicový systém EPSG:${F.sr}. Mapa se nemusí zobrazit.`;
  return out;
}
/* popis WMS služby: zkusí verzi 1.3.0, pak 1.1.1 */
const wmsCapCache = new Map();
async function wmsCaps(base) {
  if (wmsCapCache.has(base)) return wmsCapCache.get(base);
  let xml = null, lastErr = null;
  for (const ver of ['1.3.0', '1.1.1']) {
    try {
      const r = await fetch(`${base}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${ver}`, { mode: 'cors' });
      const t = await r.text();
      const x = new DOMParser().parseFromString(t, 'text/xml');
      if (x.querySelector('Capability')) { xml = x; break; }
      const ex = x.querySelector('ServiceException, ExceptionText')?.textContent?.trim();
      lastErr = ex ? `Služba hlásí: ${ex}` : `Služba nevrátila popis WMS (odpověď ${r.status}).`;
    } catch (e) { lastErr = lastErr || 'CORS'; }
  }
  if (!xml) {
    const err = new Error(lastErr === 'CORS'
      ? 'Popis služby (GetCapabilities) nejde načíst – služba nejspíš nepovoluje přístup z jiné aplikace (CORS). Můžete zkusit zadat názvy vrstev ručně.'
      : `${lastErr || 'Na adrese není WMS ani ArcGIS služba.'} Můžete zkusit zadat názvy vrstev ručně.`);
    err.manual = base;
    throw err;
  }
  const txt = (sel) => [...xml.querySelectorAll(sel)].map((n) => n.textContent.trim());
  const pick = (list, pref) => pref.find((f) => list.includes(f)) || list[0] || '';
  const version = xml.documentElement.getAttribute('version') || '1.1.1';
  const format = pick(txt('Capability > Request > GetMap > Format'), ['image/png', 'image/png; mode=8bit', 'image/png8', 'image/png32', 'image/jpeg']) || 'image/png';
  const infoFormat = pick(txt('Capability > Request > GetFeatureInfo > Format'), ['application/json', 'application/geo+json', 'text/plain', 'text/html', 'application/vnd.ogc.gml', 'text/xml']);
  const title = xml.querySelector('Service > Title')?.textContent?.trim() || 'WMS';
  const crs = txt('Layer > SRS, Layer > CRS').flatMap((x) => x.toUpperCase().split(/\s+/));
  const named = [...xml.querySelectorAll('Layer')].filter((n) => n.querySelector(':scope > Name'));
  const layers = named.map((n) => ({ name: n.querySelector(':scope > Name').textContent.trim(), title: n.querySelector(':scope > Title')?.textContent?.trim() || '', queryable: n.getAttribute('queryable') === '1' }))
    .map((l) => ({ ...l, title: l.title || l.name }));
  // „všechny vrstvy“: pojmenovaná kořenová vrstva, jinak pojmenované vrstvy první úrovně
  const root = xml.querySelector('Capability > Layer');
  let all = root?.querySelector(':scope > Name')?.textContent?.trim() || '';
  if (!all && root) all = [...root.querySelectorAll(':scope > Layer > Name')].map((n) => n.textContent.trim()).join(',');
  const queryAll = layers.filter((l) => l.queryable).map((l) => l.name).join(',');
  const res = { version, format, infoFormat, title, crs, layers, all, queryAll };
  wmsCapCache.set(base, res);
  return res;
}

/* ---------- panel Data ---------- */
function renderDataPanel() {
  const root = $('#panel-data');
  if (!root || root.hidden) return;
  const keepUrl = $('#data-url')?.value;
  root.replaceChildren();
  if (S.modelID == null) { root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor tlačítkem nahoře.')); return; }
  const F = dataFrame();
  if (!F) {
    const p = el('div', 'notice');
    p.append(el('span', null, 'Mapové podklady potřebují georeferencovaný model (IfcMapConversion se souřadnicovým systémem, např. EPSG:5514). Tento model georeferenci nemá nebo neznám jeho souřadnicový systém.'));
    root.appendChild(p);
    return;
  }
  // přidané vrstvy
  const sec = el('section', 'group');
  sec.appendChild(el('h3', 'group-title', D.layers.length ? 'Přidané vrstvy' : 'Žádné vrstvy'));
  if (!D.layers.length) sec.appendChild(el('p', 'muted small pad-x', 'Vyberte podklad z nabídky níže nebo vložte adresu vlastní služby. Data se načtou jen pro okolí modelu.'));
  else if (D.layers.length > 1) sec.appendChild(el('p', 'muted small pad-x', 'Nahoře v seznamu = nahoře v mapě. Pořadí změníte šipkami.'));
  [...D.layers].reverse().forEach((L) => {
    const row = el('div', 'dl-row');
    const vis = el('button', 'eye');
    vis.type = 'button';
    vis.innerHTML = L.visible ? EYE : EYE_OFF;
    vis.setAttribute('aria-label', `${L.visible ? 'Skrýt' : 'Zobrazit'}: ${L.name}`);
    vis.addEventListener('click', () => {
      L.visible = !L.visible;
      if (L.visible && L.state !== 'ok') loadDataLayer(L);
      if (L.obj) L.obj.visible = L.visible;
      if (L.dem) rebuildDataLayers();
      saveDataLayers(); renderDataPanel(); requestRender(); markPlanDirty(0);
    });
    const name = el('div', 'dl-name');
    name.appendChild(el('span', 'row-label', L.name));
    const st = L.state === 'loading' ? 'Načítám…' : L.state === 'error' ? L.error
      : L.features ? `${L.features.length.toLocaleString('cs-CZ')} prvků${L.exceeded ? ' (služba vrátila jen část)' : ''}`
      : L.dem ? `Terén ${nf.format(Math.round(L.dem.lo * 10) / 10)} – ${nf.format(Math.round(L.dem.hi * 10) / 10)} m${L.dem === activeDem() ? ', mapy a vektory leží na něm' : ''}`
      : L.i3s ? `${L.i3s.nodes.length} částí scény${L.i3s.warn ? ` · ${L.i3s.warn}` : ''}` : (L.note || '');
    name.appendChild(el('span', 'row-sub' + (L.state === 'error' ? ' dl-err' : ''), st));
    const rm = el('button', 'ib');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Odebrat vrstvu ${L.name}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    rm.addEventListener('click', () => removeDataLayer(L));
    const i = D.layers.indexOf(L);
    const mv = el('div', 'dl-move');
    const mk = (lab, dir, dis) => {
      const b = el('button', 'ib small-ib');
      b.type = 'button';
      b.disabled = dis;
      b.setAttribute('aria-label', `${lab}: ${L.name}`);
      b.innerHTML = dir > 0 ? '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
      b.addEventListener('click', () => {
        const j = i + dir;
        if (j < 0 || j >= D.layers.length) return;
        [D.layers[i], D.layers[j]] = [D.layers[j], D.layers[i]];
        saveDataLayers(); rebuildDataLayers(); renderDataPanel();
      });
      return b;
    };
    mv.append(mk('Posunout výš', 1, i === D.layers.length - 1), mk('Posunout níž', -1, i === 0));
    row.append(vis, name, mv, rm);
    if (L.src.color) { const sw = el('span', 'lg-sw'); sw.style.background = L.src.color; name.prepend(sw); }
    sec.appendChild(row);
    if (L.visible && L.state === 'ok') {
      const op = el('input', 'dl-op');
      op.type = 'range'; op.min = '0.1'; op.max = '1'; op.step = '0.05'; op.value = String(L.opacity ?? 1);
      op.setAttribute('aria-label', `Průhlednost: ${L.name}`);
      op.addEventListener('input', () => {
        L.opacity = Number(op.value);
        L.obj?.traverse((o) => {
          if (!o.material) return;
          const solid = o.userData.dem || o.userData.i3s;
          o.material.opacity = (o.material.map || o.isLineSegments2 || o.isInstancedMesh || solid ? 1 : 0.07) * L.opacity;
          if (solid) { const t = L.opacity < 1; if (o.material.transparent !== t) { o.material.transparent = t; o.material.depthWrite = !t; o.material.needsUpdate = true; } }
        });
        requestRender(); markPlanDirty(150);
      });
      op.addEventListener('change', saveDataLayers);
      sec.appendChild(op);
    }
  });
  root.appendChild(sec);
  // nastavení
  const set = el('section', 'group');
  set.appendChild(el('h3', 'group-title', 'Nastavení'));
  const grid = el('div', 'dl-set');
  const mSel = el('select', 'color-key');
  [[50, '50 m'], [100, '100 m'], [250, '250 m'], [500, '500 m'], [1000, '1 km']].forEach(([v, l]) => { const o = el('option', null, l); o.value = String(v); mSel.appendChild(o); });
  mSel.value = String(D.margin);
  mSel.addEventListener('change', () => { D.margin = Number(mSel.value); saveDataLayers(); reloadDataLayers(); });
  const hIn = el('input', 'flt-val');
  hIn.type = 'number'; hIn.step = '0.1'; hIn.inputMode = 'decimal';
  hIn.value = dataGroundH(F).toFixed(2);
  hIn.addEventListener('change', () => { const v = Number(String(hIn.value).replace(',', '.')); if (Number.isFinite(v)) { D.groundH = v; rebuildDataLayers(); } });
  const hReset = el('button', 'sbtn mini-btn', '±0 modelu');
  hReset.type = 'button';
  hReset.addEventListener('click', () => { D.groundH = null; rebuildDataLayers(); renderDataPanel(); });
  const lab = (t, c) => { const w0 = el('label', 'dl-lab'); w0.append(el('span', 'muted small', t), c); return w0; };
  const hWrap = el('div', 'dl-h'); hWrap.append(hIn, hReset);
  if (activeDem()) { hIn.disabled = true; hReset.disabled = true; hIn.title = 'Mapy a vektory leží na terénu'; }
  grid.append(lab('Okolí modelu', mSel), lab(activeDem() ? 'Výška podkladu: podle terénu' : `Výška podkladu ${S.geo?.jtsk ? '(Bpv)' : '(H)'}`, hWrap));
  set.appendChild(grid);
  const infoB = el('button', 'sbtn' + (D.info ? ' primary' : ''), D.info ? 'Info o místě: zapnuto' : 'Info o místě');
  infoB.type = 'button';
  infoB.setAttribute('aria-pressed', String(D.info));
  infoB.title = 'Ťuknutím do modelu nebo půdorysu zjistíte, co je na místě ve vrstvách (parcela, budova…)';
  infoB.addEventListener('click', () => {
    D.info = !D.info;
    if (!D.info) { D.infoAt = null; D.infoRes = null; updateDataMarker(); updatePlanMarker(); requestRender(); }
    else toast('Ťukněte do modelu nebo do půdorysu.');
    renderDataPanel();
  });
  const ib = el('div', 'pad-x dl-info-row');
  ib.appendChild(infoB);
  set.appendChild(ib);
  root.appendChild(set);
  // výsledky identifikace
  if (D.info && D.infoRes) {
    const r = el('section', 'group');
    const t = el('h3', 'group-title', `Na místě ${S.geo?.jtsk && geoFormat === 'YX' ? `Y ${nf3s.format(-D.infoAt.E)} X ${nf3s.format(-D.infoAt.N)}` : `E ${nf3s.format(D.infoAt.E)} N ${nf3s.format(D.infoAt.N)}`}`);
    r.appendChild(t);
    if (!D.infoRes.length) r.appendChild(el('p', 'muted small pad-x', D.infoRes.done ? 'V zapnutých vrstvách tu nic není.' : 'Zjišťuji…'));
    D.infoRes.forEach((x) => {
      if (x.rows) r.appendChild(table(x.layer, x.rows));
      else { const s0 = el('section', 'pset'); s0.appendChild(el('h3', 'pset-title', x.layer)); const pre = el('pre', 'dl-pre', x.text); s0.appendChild(pre); r.appendChild(s0); }
    });
    root.appendChild(r);
  }
  // nabídka
  for (const g of DATA_CATALOG) {
    const c = el('section', 'group');
    c.appendChild(el('h3', 'group-title', g.group));
    for (const it of g.items) {
      const used = D.layers.some((l) => l.src.url === it.src.url && l.src.type === it.src.type && (it.src.layers === '*' || (l.src.layers || '') === (it.src.layers || '')));
      const b = el('button', 'dl-cat' + (used ? ' used' : ''));
      b.type = 'button';
      b.disabled = used;
      const tx = el('span', 'dl-name');
      tx.append(el('span', 'row-label', it.name), el('span', 'row-sub', it.note));
      b.append(tx, el('span', 'dl-add', used ? 'Přidáno' : '+ Přidat'));
      b.addEventListener('click', () => addDataLayer(it));
      c.appendChild(b);
    }
    root.appendChild(c);
  }
  // vlastní služba
  const cu = el('section', 'group');
  cu.appendChild(el('h3', 'group-title', 'Vlastní služba'));
  const urow = el('div', 'dl-url');
  const u = el('input', 'search-input');
  u.id = 'data-url'; u.type = 'url'; u.placeholder = 'https://…/MapServer, …/FeatureServer/0 nebo WMS';
  u.autocomplete = 'off'; u.spellcheck = false;
  u.value = keepUrl ?? D.lastUrl ?? '';
  const go = el('button', 'sbtn primary', 'Načíst');
  go.type = 'button';
  urow.append(u, go);
  cu.appendChild(urow);
  const outBox = el('div', 'dl-found');
  cu.appendChild(outBox);
  cu.appendChild(el('p', 'muted small pad-x', 'Funguje s veřejnými službami WMS a ArcGIS Server (MapServer, FeatureServer, ImageServer). Služba musí povolit přístup z jiné aplikace (CORS) a souřadnicový systém modelu.'));
  const fd = D.found;
  if (fd?.busy) outBox.appendChild(el('p', 'muted small pad-x', 'Zjišťuji službu…'));
  if (fd?.warn) outBox.appendChild(el('p', 'small pad-x dl-err', fd.warn));
  if (fd?.error) outBox.appendChild(el('p', 'small pad-x dl-err', fd.error));
  if (fd?.items && !fd.items.length) outBox.appendChild(el('p', 'muted small pad-x', 'Služba neobsahuje žádnou vrstvu, kterou umím zobrazit.'));
  (fd?.items || []).forEach((it) => {
    const used = D.layers.some((l) => l.src.url === it.src.url && (l.src.layers || '') === (it.src.layers || ''));
    const b = el('button', 'dl-cat' + (used ? ' used' : ''));
    b.type = 'button';
    b.disabled = used;
    const tx = el('span', 'dl-name');
    tx.append(el('span', 'row-label', it.name), el('span', 'row-sub', it.note));
    b.append(tx, el('span', 'dl-add', used ? 'Přidáno' : '+ Přidat'));
    b.addEventListener('click', () => addDataLayer(it));
    outBox.appendChild(b);
  });
  if (fd?.manual) {
    const mrow = el('div', 'dl-url');
    const li = el('input', 'search-input');
    li.placeholder = 'Názvy vrstev (LAYERS), oddělené čárkou';
    const add = el('button', 'sbtn', 'Přidat jako WMS');
    add.type = 'button';
    add.addEventListener('click', () => { if (li.value.trim()) addDataLayer({ name: `WMS ${li.value.trim()}`, note: fd.manual, src: { type: 'wms', url: fd.manual, layers: li.value.trim(), version: '1.3.0' } }); });
    mrow.append(li, add);
    outBox.appendChild(mrow);
  }
  const run = async () => {
    D.lastUrl = u.value;
    D.found = { busy: true };
    renderDataPanel();
    try {
      const items = await inspectService(D.lastUrl);
      D.found = { items, warn: items.warn };
    } catch (e) {
      D.found = { error: e.message || String(e), manual: e.manual };
    }
    renderDataPanel();
  };
  go.addEventListener('click', run);
  u.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') run(); });
  root.appendChild(cu);
  root.appendChild(el('p', 'muted small pad', 'Mapové podklady: © ČÚZK. Na server se posílá jen výřez okolí modelu, model zůstává v zařízení.'));
}
/* po načtení modelu: znovu vytvořit vrstvy pro nový výřez */
function dataOnModelLoaded() {
  D.infoAt = null; D.infoRes = null; D.groundH = null;
  updateDataMarker();
  D.layers.forEach((L) => { disposeLayerObj(L); L.img = null; L.features = null; L.dem = null; L.i3s = null; L.state = 'idle'; });
  if (dataFrame()) D.layers.filter((L) => L.visible).forEach((L) => loadDataLayer(L));
  renderDataPanel();
}

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
  await loadIfc(await blob.arrayBuffer(), name);
  if (S.modelID == null || S.fileName !== name) return false;
  S.mainBlob = blob;
  S.mainKey = key || recentKey(name, blob.size);
  if (!key) recentSave(blob, name, S.meta?.projectName).then(() => { if (!$('#panel-model').hidden) renderModelPanel(); });
  else { recentDb.get(key).then((r) => { if (r) { r.opened = Date.now(); recentDb.put(r).then(recentRefresh); } }).catch(() => {}); }
  saveLastSet();
  if (blob.size / 1048576 > 150) toast('Velký model: pokud se iPad zpomalí, vypněte hrany nebo skryjte část podlaží.');
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

/* =====================================================================
   PODKLADOVÉ MODELY – další IFC zobrazené spolu s hlavním modelem
   Zarovnání podle georeference (IfcMapConversion) obou modelů, jinak
   podle souřadnic IFC (sdílený počátek projektu).
   ===================================================================== */
const refsGroup = new THREE.Group();
refsGroup.name = 'refs';
scene.add(refsGroup);
const REF_TINTS = ['#2a78d6', '#1baf7a', '#eb6834', '#6250d6', '#e87ba4'];
let refSeq = 0;
S.refs = [];
/* afinní matice lokální IFC (m) → mapové souřadnice (E/N S-JTSK sjednocené na EPSG:5514) */
function mapAffine(g) {
  const flip = g.jtsk && (g.jtskPositive || g.epsg === 5513 || g.epsg === 2065) ? -1 : 1;
  const m = (x, y, z) => { const r = geoMapFromLocal({ x, y, z }, g); return new THREE.Vector3(flip * r.E, flip * r.N, r.H); };
  const o = m(0, 0, 0);
  return new THREE.Matrix4().makeBasis(m(1, 0, 0).sub(o), m(0, 1, 0).sub(o), m(0, 0, 1).sub(o)).setPosition(o);
}
function sameCrs(a, b) { return !!(a?.ok && b?.ok && ((a.jtsk && b.jtsk) || (a.epsg && a.epsg === b.epsg))); }
function alignRef(R) {
  const Smain = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), N_YUP);
  const Sref = new THREE.Matrix4().multiplyMatrices(R.coord, N_YUP);
  let T;
  if (sameCrs(S.geo, R.geo)) {
    // scéna reference → lokální IFC reference → mapa → lokální IFC hlavního → scéna hlavního
    T = Smain.clone().multiply(mapAffine(S.geo).invert()).multiply(mapAffine(R.geo)).multiply(Sref.clone().invert());
    R.align = 'geo';
  } else {
    T = new THREE.Matrix4().multiplyMatrices(S.coordMatrix || new THREE.Matrix4(), R.coord.clone().invert());
    R.align = 'coord';
  }
  R.group.matrixAutoUpdate = false;
  R.group.matrix.copy(T);
  R.group.matrixWorldNeedsUpdate = true;
  R.group.updateMatrixWorld(true);
}
async function addRefModel(blob, name, key) {
  if (S.modelID == null) { await openMainBlob(blob, name, key); return; }
  if ((S.refs || []).some((R) => R.key === (key || recentKey(name, blob.size)))) { toast('Tento model už je přidaný.'); return; }
  const head = await blob.slice(0, 64).text();
  if (!/ISO-10303-21/.test(head)) { toast('Tohle nevypadá jako IFC soubor (STEP).', true); return; }
  showLoading(`Přidávám ${name}`);
  await nextFrame();
  const api = S.api;
  let mid = null;
  try {
    setLoadingStep('Čtu geometrii…');
    await nextFrame();
    mid = api.OpenModel(new Uint8Array(await blob.arrayBuffer()), { COORDINATE_TO_ORIGIN: true });
    if (mid < 0) throw new Error('Soubor se nepodařilo otevřít.');
    const R = { id: ++refSeq, key: key || recentKey(name, blob.size), name, blob, mid, group: new THREE.Group(), meshes: [], ids: new Set(), visible: true, ghost: false, tint: REF_TINTS[(refSeq - 1) % REF_TINTS.length] };
    const geoCache = new Map();
    const onMesh = (flat) => {
      const id = flat.expressID;
      const pgs = flat.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        let geo = geoCache.get(pg.geometryExpressID);
        if (!geo) {
          const g = api.GetGeometry(mid, pg.geometryExpressID);
          const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
          const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
          g.delete();
          if (!idx.length) continue;
          const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
          geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
          geo.computeBoundingSphere();
          geoCache.set(pg.geometryExpressID, geo);
        }
        const mesh = new THREE.Mesh(geo, materialFor(pg.color));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.userData.ref = R.id;
        mesh.userData.id = id;
        R.meshes.push(mesh);
        R.ids.add(id);
        R.group.add(mesh);
      }
    };
    api.StreamAllMeshes(mid, onMesh);
    R.coord = (() => { try { return new THREE.Matrix4().fromArray(api.GetCoordinationMatrix(mid)); } catch (e) { return new THREE.Matrix4(); } })();
    try { R.geo = readGeoref(mid); } catch (e) { R.geo = { ok: false }; }
    try {
      const pids = api.GetLineIDsWithType(mid, WebIFC.IFCPROJECT);
      if (pids.size()) { const p = api.GetLine(mid, pids.get(0)); R.project = p?.LongName?.value || p?.Name?.value || ''; }
    } catch (e) { /* ignore */ }
    R.schema = (() => { try { return api.GetModelSchema(mid); } catch (e) { return ''; } })();
    if (!R.meshes.length) throw new Error('Model neobsahuje žádnou geometrii.');
    refsGroup.add(R.group);
    alignRef(R);
    S.refs.push(R);
    mid = null;
    hideLoading();
    saveLastSet();
    if (!key) await recentSave(blob, name, R.project);
    renderModelPanel();
    requestRender(); markPlanDirty(0);
    // kontrola, jestli model leží u hlavního
    const bb = new THREE.Box3().setFromObject(R.group);
    const far = bb.isEmpty() || bb.distanceToPoint(S.bbox.getCenter(new THREE.Vector3())) > Math.max(200, S.bbox.getSize(new THREE.Vector3()).length() * 3);
    toast(`Přidáno: ${name}. ${R.align === 'geo' ? 'Zarovnáno podle georeference.' : 'Zarovnáno podle souřadnic IFC.'}${far ? ' Pozor: model leží daleko od hlavního, zkontrolujte souřadnice.' : ''}`, far);
  } catch (e) {
    console.error(e);
    if (mid != null) { try { api.CloseModel(mid); } catch (_) { /* ignore */ } }
    hideLoading();
    toast(`Model se nepodařilo přidat: ${e?.message || e}`, true);
  }
}
function removeRef(R, keepSet) {
  if (S.refSel?.R === R) deselect();
  disposeRefGhost(R);
  const geos = new Set();
  R.group.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
  geos.forEach((g) => g.dispose());
  refsGroup.remove(R.group);
  try { S.api.CloseModel(R.mid); } catch (e) { /* ignore */ }
  S.refs.splice(S.refs.indexOf(R), 1);
  if (!keepSet) saveLastSet();
  renderModelPanel(); requestRender(); markPlanDirty(0);
}
/* průhledné zobrazení podkladového modelu: sloučeno do jednoho objektu v barvě modelu */
function disposeRefGhost(R) {
  if (!R.ghostObj) return;
  R.ghostObj.geometry.dispose(); R.ghostObj.material.dispose();
  R.group.remove(R.ghostObj); R.ghostObj = null;
}
function setRefGhost(R, on) {
  R.ghost = on;
  disposeRefGhost(R);
  if (on) {
    let nv = 0, ni = 0;
    for (const m of R.meshes) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), I = new Uint32Array(ni);
    let vo = 0, io = 0;
    const nm = new THREE.Matrix3();
    for (const m of R.meshes) {
      const w = m.matrix.elements;
      nm.getNormalMatrix(m.matrix);
      const n9 = nm.elements;
      const pos = m.geometry.attributes.position, arr = pos.data.array, st = pos.data.stride, po = pos.offset;
      for (let i = 0; i < pos.count; i++) {
        const a = i * st + po, x = arr[a], y = arr[a + 1], z = arr[a + 2], nx = arr[a + 3], ny = arr[a + 4], nz = arr[a + 5], k = (vo + i) * 3;
        P[k] = w[0] * x + w[4] * y + w[8] * z + w[12]; P[k + 1] = w[1] * x + w[5] * y + w[9] * z + w[13]; P[k + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        Nn[k] = n9[0] * nx + n9[3] * ny + n9[6] * nz; Nn[k + 1] = n9[1] * nx + n9[4] * ny + n9[7] * nz; Nn[k + 2] = n9[2] * nx + n9[5] * ny + n9[8] * nz;
      }
      const ia = m.geometry.index.array;
      for (let i = 0; i < ia.length; i++) I[io + i] = ia[i] + vo;
      io += ia.length; vo += pos.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    R.ghostObj = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(R.tint), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    R.ghostObj.renderOrder = 1;
    R.group.add(R.ghostObj);
  }
  R.meshes.forEach((m) => { m.visible = !on; });
  requestRender(); markPlanDirty(0);
}
async function makeRefMain(R) {
  const old = S.mainBlob ? { blob: S.mainBlob, name: S.fileName, key: S.mainKey } : null;
  const { blob, name, key } = R;
  removeRef(R, true);
  const ok = await openMainBlob(blob, name, key, { keepRefs: true });
  if (ok && old) await addRefModel(old.blob, old.name, old.key);
}
function refsOnMainLoaded() {
  for (const R of S.refs) { try { alignRef(R); } catch (e) { console.warn('align', e); } }
  if (S.refs.length) { requestRender(); markPlanDirty(0); }
}
/* výběr prvku podkladového modelu */
function selectRef(rid, id) {
  deselect(false);
  const R = S.refs.find((x) => x.id === rid);
  if (!R) return;
  S.refSel = { R, id };
  for (const m of R.meshes) if (m.userData.id === id) { m.userData.mat = m.material; m.material = selTinted(m.material); }
  updateToolbar();
  if ($('#panel-tree').hidden) showPanel('props');
  renderProps();
  requestRender();
}
function refDeselect() {
  const s0 = S.refSel;
  if (!s0) return;
  for (const m of s0.R.meshes) if (m.userData.id === s0.id && m.userData.mat) { m.material = m.userData.mat; m.userData.mat = null; }
  S.refSel = null;
}
async function refPropsView(root, token) {
  const { R, id } = S.refSel;
  const api = S.api, mid = R.mid;
  root.replaceChildren(el('p', 'muted pad', 'Načítám vlastnosti…'));
  try {
    const item = await api.properties.getItemProperties(mid, id, false);
    let cls = '';
    try { cls = api.GetNameFromTypeCode(api.GetLineType(mid, id)); } catch (e) { /* ignore */ }
    const psets = (await api.properties.getPropertySets(mid, id, true)).map((p) => ({ p, from: null }));
    try {
      for (const t of (await api.properties.getTypeProperties(mid, id, true)) || []) for (const p of t.HasPropertySets || []) if (p && typeof p === 'object') psets.push({ p, from: 'Typ' });
    } catch (e) { /* no type */ }
    if (token !== propToken) return;
    root.replaceChildren();
    const head = el('header', 'el-head');
    head.append(el('div', 'el-class', prettyCls(cls)), el('h2', 'el-name', val(item.Name) || classLabel(cls)));
    const badge = el('div', 'cmp-badge ref-badge', `Podkladový model: ${R.name}`);
    badge.style.setProperty('--tint', R.tint);
    head.appendChild(badge);
    const gid = val(item.GlobalId);
    if (gid) {
      const g = el('button', 'guid'); g.type = 'button';
      g.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', gid), el('span', 'guid-a', 'Kopírovat'));
      g.addEventListener('click', () => copy(gid, g));
      head.appendChild(g);
    }
    root.appendChild(head);
    const attrs = [];
    for (const k of ['Description', 'ObjectType', 'Tag', 'PredefinedType', 'LongName']) { const v = val(item[k]); if (v) attrs.push([k, v]); }
    attrs.push(['Express ID', `#${id}`]);
    root.appendChild(table('Atributy', attrs));
    const seen = new Set();
    for (const { p, from } of psets.sort((a, b) => val(a.p.Name).localeCompare(val(b.p.Name), 'cs'))) {
      if (seen.has(p.expressID)) continue;
      seen.add(p.expressID);
      const rows = propRows(p);
      if (rows.length) root.appendChild(table(val(p.Name) || 'Bez názvu', rows, p.Quantities ? 'Množství' : from));
    }
  } catch (e) {
    if (token === propToken) root.replaceChildren(el('p', 'muted pad', 'Vlastnosti se nepodařilo načíst.'));
  }
}
function modelsSection() {
  const sec = el('section', 'group');
  sec.appendChild(el('h3', 'group-title', 'Modely'));
  const main = el('div', 'md-row');
  const mdot = el('span', 'md-dot main');
  const mn = el('div', 'dl-name');
  mn.append(el('span', 'row-label', S.fileName), el('span', 'row-sub', `hlavní · ${S.elements.size.toLocaleString('cs-CZ')} prvků`));
  main.append(mdot, mn);
  sec.appendChild(main);
  for (const R of S.refs) {
    const row = el('div', 'md-row');
    const vis = el('button', 'eye');
    vis.type = 'button';
    vis.innerHTML = R.visible ? EYE : EYE_OFF;
    vis.setAttribute('aria-label', `${R.visible ? 'Skrýt' : 'Zobrazit'}: ${R.name}`);
    vis.addEventListener('click', () => { R.visible = !R.visible; R.group.visible = R.visible; if (!R.visible && S.refSel?.R === R) deselect(); renderModelPanel(); requestRender(); markPlanDirty(0); });
    const nm = el('div', 'dl-name');
    const lab = el('span', 'row-label', R.name);
    const sw = el('span', 'lg-sw'); sw.style.background = R.tint; lab.prepend(sw);
    nm.append(lab, el('span', 'row-sub', `${R.align === 'geo' ? 'podle georeference' : 'podle souřadnic IFC'} · ${R.ids.size.toLocaleString('cs-CZ')} prvků`));
    const acts = el('div', 'md-acts');
    const gh = el('button', 'sbtn mini-btn' + (R.ghost ? ' primary' : ''), 'Průhledně');
    gh.type = 'button';
    gh.setAttribute('aria-pressed', String(R.ghost));
    gh.addEventListener('click', () => { if (S.refSel?.R === R) deselect(); setRefGhost(R, !R.ghost); renderModelPanel(); });
    const mk = el('button', 'sbtn mini-btn', 'Hlavní');
    mk.type = 'button';
    mk.title = 'Udělat hlavním modelem (strom, hledání, barvení…)';
    mk.addEventListener('click', () => makeRefMain(R));
    const rm = el('button', 'ib small-ib');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Odebrat model ${R.name}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    rm.addEventListener('click', () => removeRef(R));
    acts.append(gh, mk, rm);
    row.append(vis, nm, acts);
    sec.appendChild(row);
  }
  const add = el('label', 'sbtn md-add', '+ Přidat další model…');
  add.htmlFor = 'ref-input';
  add.title = 'Například TZB nebo statika. Zarovná se podle georeference, jinak podle souřadnic IFC.';
  const w0 = el('div', 'pad-x md-add-row');
  w0.appendChild(add);
  sec.appendChild(w0);
  if (S.refs.length) sec.appendChild(el('p', 'muted small pad-x', 'Strom, hledání, barvení a porovnání pracují s hlavním modelem. Ťuknutím na prvek podkladového modelu zobrazíte jeho vlastnosti.'));
  return sec;
}
$('#ref-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addRefModel(f, f.name); });
recentRefresh();

/* reset a napojení na načtení modelu */
function resetFeatures() {
  exitCompare(true);
  S.color = null; S.idx = null; S.idxPromise = null; S.idxFor = null;
  rebuildGhosts();
  S.spaceGeo = null; S.roomLbl = null; S.legendCollapsed = false;
  if (S.search) { S.search.results = []; S.search.active = false; }
  colorMatCache.forEach((m) => m.dispose()); colorMatCache.clear();
  renderLegend();
}
function featuresOnModelLoaded() {
  if (S.search) { S.search.conds = S.search.conds.filter((c) => ATTR_KEYS.includes(c.key)); }
  updatePlanLabelUi();
  if (!$('#panel-search').hidden) renderSearchPanel();
  // index na pozadí, aby hledání a barvení bylo hned po ruce
  setTimeout(() => { if (S.modelID != null) ensureIndex().catch(() => {}); }, 600);
}

/* ---------- boot ---------- */
renderModelPanel();
renderProps();
updateToolbar();
showPanel('model');
if (matchMedia('(max-width: 719px)').matches) app.classList.remove('sheet-open');
(async () => {
  try {
    const res = await fetch('sample.ifc');
    if (!res.ok) throw new Error('sample');
    await loadIfc(await res.arrayBuffer(), 'ukazkovy-pavilon.ifc');
    $('#sample-badge').hidden = false;
  } catch (e) {
    hideLoading();
    $('#empty-hint').hidden = false;
  }
})();
window.__ifc = S;
window.__ifcView = { camera, dataGroup, renderer, renderFrame, scene };

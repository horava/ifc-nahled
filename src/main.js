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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(viewport);

function renderFrame() {
  renderer.clear();
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
function applyVisibility() {
  for (const [id, rec] of S.elements) {
    const v = isVisible(id, rec);
    for (const m of rec.meshes) m.visible = v;
  }
  updateToolbar();
  requestRender();
  if (S.tree && !$('#panel-tree').hidden) renderTree();
  markPlanDirty();
}

/* ---------- selection ---------- */
function select(id, opts = {}) {
  deselect(false);
  const rec = S.elements.get(id);
  if (!rec) return;
  S.selected = id;
  for (const m of rec.meshes) {
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
  if (S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec) for (const m of rec.meshes) {
      if (m.userData.mat) m.material = m.userData.mat;
      for (const c of [...m.children]) if (c.userData.selOutline) { m.remove(c); c.geometry.dispose(); }
    }
  }
  S.selected = null;
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

function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  const hit = hitAt(cx, cy);
  if (coord.on) { if (hit) addGeoPoint(hit, cx - r.left, cy - r.top); return; }
  if (S.measure.on) { if (hit) measurePoint(hit, cx - r.left, cy - r.top); return; }
  if (hit) {
    const id = hit.object.userData.id;
    if (id === S.selected) deselect(); else select(id);
  } else deselect();
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
  S.storeys.forEach((s) => { s.visible = true; });
  S.classes.forEach((c, k) => { c.visible = !HIDDEN_BY_DEFAULT.has(U(k)); });
  applyVisibility(); renderModelPanel();
}

/* ---------- panel: model ---------- */
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/></svg>';

function rowList(title, items, onToggle, onOnly) {
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
    const name = el('span', 'row-name');
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
    summary.appendChild(sb);
  }
  root.appendChild(summary);

  if (S.isolated || S.hidden.size) {
    const note = el('div', 'notice');
    note.append(el('span', null, S.isolated ? 'Zobrazen jen izolovaný prvek.' : `Skryto ručně: ${S.hidden.size} prvků.`));
    const b = el('button', 'link', 'Zobrazit vše');
    b.type = 'button';
    b.addEventListener('click', showAll);
    note.appendChild(b);
    root.appendChild(note);
  }

  root.appendChild(rowList('Podlaží', [...S.storeys].reverse().map((s) => ({ ...s, label: s.name, ref: s })),
    (it) => { it.ref.visible = !it.ref.visible; S.isolated = null; applyVisibility(); renderModelPanel(); },
    (it) => { S.storeys.forEach((s) => { s.visible = s === it.ref; }); S.isolated = null; applyVisibility(); renderModelPanel(); }));

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
    dl.append(el('dt', null, k), el('dd', v ? null : 'empty', v || '—'));
  });
  sec.appendChild(dl);
  return sec;
}

let propToken = 0;
async function renderProps() {
  const root = $('#panel-props');
  const token = ++propToken;
  if (S.selected == null) {
    root.replaceChildren();
    const empty = el('div', 'props-empty');
    empty.append(el('p', 'props-empty-title', 'Žádný vybraný prvek'),
      el('p', 'muted', 'Klepněte na prvek v modelu. Zobrazí se jeho atributy a všechny sady vlastností včetně vlastností typu.'));
    root.appendChild(empty);
    return;
  }
  const id = S.selected, api = S.api, mid = S.modelID;
  const rec = S.elements.get(id);
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
    head.appendChild(el('div', 'el-class', rec.cls));
    head.appendChild(el('h2', 'el-name', val(item.Name) || classLabel(rec.cls)));
    const st = S.storeys.find((s) => s.id === rec.storey);
    if (st) head.appendChild(el('div', 'el-storey', st.name));
    const gid = val(item.GlobalId);
    if (gid) {
      const g = el('button', 'guid');
      g.type = 'button';
      g.append(el('span', 'guid-k', 'GlobalId'), el('span', 'guid-v', gid), el('span', 'guid-a', 'Kopírovat'));
      g.addEventListener('click', () => copy(gid, g));
      head.appendChild(g);
    }
    const nb = el('button', 'sbtn primary bcf-new', 'Přidat BCF záznam');
    nb.type = 'button';
    nb.addEventListener('click', () => bcfStartNew());
    head.appendChild(nb);
    root.appendChild(head);

    const attrs = [];
    for (const k of ['Description', 'ObjectType', 'Tag', 'PredefinedType', 'LongName', 'OverallWidth', 'OverallHeight']) {
      const v = val(item[k]);
      if (v) attrs.push([k, v]);
    }
    attrs.push(['Express ID', `#${id}`]);
    if (typeNames.length) attrs.push(['Typ', typeNames.join(', ')]);
    if (materials.length) attrs.push(['Materiál', materials.join(', ')]);
    root.appendChild(table('Atributy', attrs));
    try { const pos = geoElementRows(rec); if (pos.length) root.appendChild(table(S.geo?.ok ? 'Poloha v mapě' : 'Poloha v projektu', pos)); } catch (e) { console.warn(e); }

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
    if (!sorted.length) root.appendChild(el('p', 'muted pad', 'Prvek nemá žádné sady vlastností.'));
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

function readGeoref() {
  const api = S.api, mid = S.modelID;
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
  g.epsg = g.crs ? detectEpsg(g.crs.name, g.crs.desc) : null;
  g.def = g.epsg ? epsgDef(g.epsg) : null;
  g.jtsk = [5514, 5513, 2065].includes(g.epsg);
  g.jtskPositive = g.jtsk && g.mc && (g.mc.E > 0 || g.mc.N > 0);
  if (g.def) { try { proj4.defs(`EPSG:${g.epsg}`, g.def[1]); } catch (e) { g.def = null; } }
  g.ok = !!g.mc;
  // jednotky: Scale má kompenzovat rozdíl jednotek projektu a mapy
  const sx = g.mc ? (g.mc.fx ?? g.mc.scale) : 1;
  g.unitMismatch = g.mc && Math.abs(g.pu / g.mu - 1) > 1e-9 && Math.abs(sx - g.pu / g.mu) > Math.abs(sx) * 0.01;
  return g;
}

/* lokální souřadnice IFC (m) → mapové (m, v ose CRS) */
function geoMapFromLocal(l) {
  const g = S.geo;
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
  if (!g.unitMismatch && Math.abs(g.mc.scale - g.pu / g.mu) > 1e-9 && Math.abs(g.mc.scale - 1) < 0.01) {
    add('info', 'Měřítko ≠ 1', `Scale ${nf.format(g.mc.scale)} pravděpodobně zahrnuje měřítkový faktor zobrazení.`);
  }
  // S-JTSK
  if (g.jtsk) {
    if (g.jtskPositive && g.epsg === 5514) add('warn', 'Kladné souřadnice v EPSG:5514', 'EPSG:5514 (East-North) má na území ČR záporné souřadnice. Kladné hodnoty odpovídají Y/X (EPSG:5513). Aplikace je vykládá jako Y/X.');
    const [Y, X] = g.jtskPositive ? [g.mc.E, g.mc.N] : [-g.mc.E, -g.mc.N];
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
  rows.filter(Boolean).forEach(([k, v, mono]) => { dl.append(el('dt', null, k), el('dd', mono ? 'mono' : (v ? null : 'empty'), v || '—')); });
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
        ['MapUnit', g.crs.mapUnit != null ? unitLabel(g.crs.mapUnit) : '— (platí jednotky projektu)'],
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
  for (const c of node.children || []) out.push(...descIds(c));
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
function findPath(node, id, path = []) {
  if (node.expressID === id) return [...path, node];
  for (const c of treeChildren(node)) {
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
    const ids = node.group ? node.children.flatMap(descIds) : descIds(node);
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
    if (hasGeo && node.expressID === S.selected) row.classList.add('is-sel');
    if (allHidden) row.classList.add('is-off');
    lab.addEventListener('click', () => {
      if (hasGeo) { if (S.selected === node.expressID) deselect(); else select(node.expressID, { keepPanel: true }); }
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

async function saveFile(name, blob) {
  // 1) claude.ai artifact: platform save dialog (.bcfzip is not on its list, so .zip)
  if (window.claude?.use) {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        const zipName = name.replace(/\.bcfzip$/i, '.bcf.zip');
        await dl.save({ filename: zipName, data: blob });
        toast('Uloženo jako .zip. Pro import do BIM nástroje přejmenujte příponu na .bcfzip.');
        return;
      }
    } catch (e) {
      if (e?.code === 'declined') return;
      console.warn('downloads', e);
    }
  }
  // 2) iPad / iPhone: share sheet (Uložit do Souborů, Mail, Teams…)
  const file = new File([blob], name, { type: 'application/octet-stream' });
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
  $('#panel-model').hidden = name !== 'model';
  $('#panel-props').hidden = name !== 'props';
  $('#panel-bcf').hidden = name !== 'bcf';
  $('#panel-tree').hidden = name !== 'tree';
  $('#panel-geo').hidden = name !== 'geo';
  if (name === 'geo') renderGeo();
  if (name === 'tree') renderTree(true);
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
  const mb = file.size / 1048576;
  $('#sample-badge').hidden = true;
  const buf = await file.arrayBuffer();
  await loadIfc(buf, file.name);
  if (mb > 150) toast('Velký model: pokud se iPad zpomalí, vypněte hrany nebo skryjte část podlaží.');
}
$('#file-input').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); $('#drop').hidden = false; }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  $('#drop').hidden = true;
  if (ev === 'drop') {
    const f = e.dataTransfer.files[0];
    if (f && /\.(bcfzip|bcf|zip)$/i.test(f.name)) bcfImport(f); else openFile(f);
  }
}));

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

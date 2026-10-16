import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as WebIFC from 'web-ifc';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 2, 1.4);
scene.add(sun);
const modelGroup = new THREE.Group();
scene.add(modelGroup);
const measureScene = new THREE.Scene();
const measureMat = new LineMaterial({ linewidth: 3, depthTest: false, transparent: true, worldUnits: false });
renderer.autoClear = false;

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
const selMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.92 });

let needsRender = true;
const requestRender = () => { needsRender = true; };
controls.addEventListener('change', requestRender);

function applyTheme() {
  scene.background = new THREE.Color(cssVar('--ground') || '#e6e9e7');
  edgeMat.color.set(cssVar('--edge') || '#17201e');
  selMat.color.set(cssVar('--sel') || '#ff7a1a');
  measureMat.color.set(cssVar('--sel') || '#ff7a1a');
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(viewport);

(function loop() {
  requestAnimationFrame(loop);
  const moved = controls.update();
  if (moved || needsRender) {
    renderer.clear();
    renderer.clippingPlanes = S.clipOn ? [clipPlane] : [];
    renderer.render(scene, camera);
    renderer.clippingPlanes = [];
    renderer.clearDepth();
    renderer.render(measureScene, camera);
    updateOverlay();
    needsRender = false;
  }
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
    api.StreamAllMeshes(modelID, (flat) => {
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
    });

    // classes
    for (const [id, rec] of S.elements) {
      let cls = 'IFCUNKNOWN';
      try { cls = api.GetNameFromTypeCode(api.GetLineType(modelID, id)) || cls; } catch (e) { /* keep */ }
      rec.cls = cls;
      if (!S.classes.has(cls)) S.classes.set(cls, { visible: !HIDDEN_BY_DEFAULT.has(U(cls)), count: 0 });
      S.classes.get(cls).count++;
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
    } catch (e) { console.warn('Spatial structure', e); }
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
    setupClip();
    fitView('iso', false);

    const schema = (() => { try { return api.GetModelSchema(modelID); } catch (e) { return ''; } })();
    let projectName = '';
    try {
      const pids = api.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
      if (pids.size()) { const p = api.GetLine(modelID, pids.get(0)); projectName = p?.LongName?.value || p?.Name?.value || ''; }
    } catch (e) { /* ignore */ }
    S.meta = { schema, projectName, ms: Math.round(performance.now() - t0) };

    renderModelPanel();
    renderProps();
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
}

/* ---------- selection ---------- */
function select(id) {
  deselect(false);
  const rec = S.elements.get(id);
  if (!rec) return;
  S.selected = id;
  for (const m of rec.meshes) { m.userData.mat = m.material; m.material = selMat; }
  updateToolbar();
  requestRender();
  showPanel('props');
  renderProps();
}
function deselect(render = true) {
  if (S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec) for (const m of rec.meshes) { if (m.userData.mat) m.material = m.userData.mat; }
  }
  S.selected = null;
  if (render) { updateToolbar(); renderProps(); requestRender(); }
}

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let down = null;
let activePointers = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers++;
  down = activePointers === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
const endPointer = (e) => {
  activePointers = Math.max(0, activePointers - 1);
  if (!down || e.type === 'pointercancel') { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (moved > 8 || dt > 600) return;
  pick(e.clientX, e.clientY);
};
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(S.meshes.filter((m) => m.visible), false);
  const hit = hits.find((h) => !S.clipOn || clipPlane.distanceToPoint(h.point) >= -1e-4);
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
  if (mode === 'top') dir = new THREE.Vector3(0, 1, 0.0001);
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
function setupClip() {
  const b = S.bbox;
  if (b.isEmpty()) return;
  clipRange.min = (b.min.y).toFixed(2);
  clipRange.max = (b.max.y + 0.01).toFixed(2);
  clipRange.step = 0.01;
  clipRange.value = clipRange.max;
  clipPlane.constant = Number(clipRange.max);
  renderClipChips();
  updateClipLabel();
}
function setClip(h) {
  clipRange.value = h;
  clipPlane.constant = Number(h);
  updateClipLabel();
  requestRender();
}
function updateClipLabel() {
  const rel = Number(clipRange.value) - S.bbox.min.y;
  const t = `${nf2.format(rel)} m`;
  $('#clip-value').textContent = t;
  $('#clip-mini-value').textContent = t;
}
clipRange.addEventListener('input', () => setClip(clipRange.value));
function storeyCutHeight(st) {
  const meshes = [];
  for (const rec of S.elements.values()) {
    if (rec.storey === st.id && !['IFCSLAB', 'IFCSPACE', 'IFCCOVERING', 'IFCROOF'].includes(U(rec.cls))) meshes.push(...rec.meshes);
  }
  if (!meshes.length) return null;
  return boxOf(meshes).min.y + 1.2;
}
function renderClipChips() {
  const wrap = $('#clip-chips');
  wrap.replaceChildren();
  S.storeys.filter((s) => s.id !== -1).forEach((st) => {
    const b = el('button', 'chip', st.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      const h = storeyCutHeight(st);
      if (h == null) return;
      setClip(h.toFixed(2));
      fitView('top');
    });
    wrap.appendChild(b);
  });
}
function updateClipUi() {
  $('#clip-pop').hidden = !(S.clipOn && S.clipPanel);
  $('#clip-mini').hidden = !(S.clipOn && !S.clipPanel);
}
function toggleClip(force) {
  S.clipOn = force ?? !S.clipOn;
  if (S.clipOn) {
    S.clipPanel = true;
    if (Number(clipRange.value) >= Number(clipRange.max) - 0.01) {
      const mid = (S.bbox.min.y + S.bbox.max.y) / 2;
      setClip(mid.toFixed(2));
    }
  }
  updateClipUi();
  updateToolbar();
  requestRender();
}
function nudgeClip(d) {
  const v = Math.min(Number(clipRange.max), Math.max(Number(clipRange.min), Number(clipRange.value) + d));
  setClip(v.toFixed(2));
}
$('#clip-collapse').addEventListener('click', () => { S.clipPanel = false; updateClipUi(); });
$('#clip-mini').addEventListener('click', () => { S.clipPanel = true; updateClipUi(); });
$('#clip-off').addEventListener('click', () => toggleClip(false));
$('#clip-up').addEventListener('click', () => nudgeClip(0.1));
$('#clip-down').addEventListener('click', () => nudgeClip(-0.1));

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

function renderModelPanel() {
  const root = $('#panel-model');
  root.replaceChildren();
  if (S.modelID == null) {
    root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor tlačítkem nahoře.'));
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

/* ---------- panel switching ---------- */
const app = $('#app');
function showPanel(name) {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $('#panel-model').hidden = name !== 'model';
  $('#panel-props').hidden = name !== 'props';
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
  if (ev === 'drop') openFile(e.dataTransfer.files[0]);
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

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
    for (const m of rec.meshes) m.visible = v && !(merge && m.userData.ghost && id !== S.selected && !m.userData.big);
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
      if (m.userData.ghost && S.color && !m.userData.big) m.visible = false;
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
// střed otáčení: 'point' = bod modelu pod prstem/kurzorem na začátku tažení, 'sel' = vybraný prvek, 'center' = střed pohledu
const ORBIT_MODES = ['point', 'sel', 'center'];
try { S.orbitMode = localStorage.getItem('ifc-nahled-orbit-mode'); } catch (e) { /* ignore */ }
if (!ORBIT_MODES.includes(S.orbitMode)) S.orbitMode = 'point';

/* ----- otáčení kolem středu: výběr / cíl kamery ----- */
const pivotEl = $('#pivot');
let pivotHideT = 0;
const _pivPlane = new THREE.Plane();
function currentPivot(sx, sy) {
  if (S.orbitMode === 'sel' && S.selected != null) {
    const rec = S.elements.get(S.selected);
    if (rec && rec.meshes.length) return boxOf(rec.meshes).getCenter(new THREE.Vector3());
  }
  if (S.orbitMode !== 'center' && sx != null) {
    // bod modelu pod prstem; mimo model rovina pod modelem (terén, mapa), jinak střed pohledu
    const hit = hitAt(sx, sy);
    if (hit) return hit.point.clone();
    if (!S.bbox.isEmpty()) {
      _pivPlane.set(new THREE.Vector3(0, 1, 0), -S.bbox.min.y);
      const p = ray.ray.intersectPlane(_pivPlane, new THREE.Vector3());
      const lim = S.bbox.getSize(new THREE.Vector3()).length() * 20 + 100;
      if (p && p.distanceTo(camera.position) < lim) return p;
    }
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
const finePointer = () => { try { return matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { return false; } };
function orbitUi() {
  const b = $('#btn-orbit');
  const m = S.orbitMode;
  const label = m === 'point' ? (finePointer() ? 'Pod kurzorem' : 'Pod prstem') : m === 'sel' ? 'Kolem prvku' : 'Kolem středu';
  b.querySelector('span').textContent = label;
  b.setAttribute('aria-pressed', String(m !== 'center'));
  b.dataset.mode = m;
  b.title = m === 'point' ? 'Otáčí se kolem bodu modelu, kde začneš táhnout (ťuknutím přepneš)'
    : m === 'sel' ? 'Otáčí se kolem vybraného prvku, bez výběru kolem bodu pod prstem (ťuknutím přepneš)'
      : 'Otáčí se kolem středu pohledu (ťuknutím přepneš)';
}
function setOrbitMode(m) {
  S.orbitMode = m;
  try { localStorage.setItem('ifc-nahled-orbit-mode', m); } catch (e) { /* ignore */ }
  orbitUi();
  toast(m === 'point' ? `Otáčí se kolem bodu ${finePointer() ? 'pod kurzorem' : 'pod prstem'}, kde začneš táhnout.`
    : m === 'sel' ? 'Otáčí se kolem vybraného prvku.' : 'Otáčí se kolem středu pohledu.');
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pinchPrev = null;
  lastPtrType = e.pointerType || 'touch';
  const single = pointers.size === 1 && (e.pointerType !== 'mouse' || e.button === 0);
  down = single ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  orbit = single ? { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, P: null, moved: false } : null;
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
  if (!orbit.P) orbit.P = currentPivot(orbit.sx, orbit.sy);
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
  if (!S.measure.on && !coord.on && lastTap && now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    doubleTap(e.clientX, e.clientY);
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  pick(e.clientX, e.clientY);
};
renderer.domElement.addEventListener('pointerup', endPointer);
/* Safari na iPadu při dvojitém ťuknutí zvětšuje celou stránku (i přes touch-action);
   druhé rychlé ťuknutí do 3D nebo půdorysu proto stránce nepředáme. Výběr a cílení běží
   přes pointer události, kterých se to netýká. */
{
  let lastTouchEnd = 0;
  const noDoubleTapZoom = (e) => {
    const now = performance.now();
    if (now - lastTouchEnd < 400 && e.changedTouches?.length === 1) e.preventDefault();
    lastTouchEnd = now;
  };
  renderer.domElement.addEventListener('touchend', noDoubleTapZoom, { passive: false });
  document.getElementById('plan-view')?.addEventListener('touchend', noDoubleTapZoom, { passive: false });
}
renderer.domElement.addEventListener('pointercancel', endPointer);

function hitAt(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(S.meshes.filter(pickable), false);
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
  const targets = S.meshes.filter(pickable);
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
    const sn = findSnap(cx, cy, lastPtrType);
    if (!sn) return;
    if (coord.on) addGeoPoint(sn); else measurePoint(sn);
    if (hoverPos) { hoverSnap = findSnap(hoverPos.x, hoverPos.y, hoverPos.type); showHover(); }
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


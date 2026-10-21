/* ---------- measurement ---------- */
const overlay = $('#overlay');
const _v = new THREE.Vector3();
function toScreen(p) {
  _v.copy(p).project(camera);
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  return { x: (_v.x + 1) / 2 * w, y: (1 - _v.y) / 2 * h, ok: _v.z > -1 && _v.z < 1 };
}
/* ----- přichytávání (Měřit, Souřadnice) -----
   Kandidáti jsou lomové body a hrany prvků z EdgesGeometry (30°), tedy skutečné hrany, ne úhlopříčky
   triangulace. Berou se z prvku pod kurzorem i ze sousedních prvků (paprsky v kroužku kolem kurzoru),
   takže se chytí i roh na obrysu budovy proti obloze. Zakryté body (za jiným prvkem) a body za rovinou
   řezu se nenabízejí. Lomový bod má přednost před hranou, hrana před plochou. */
const SNAP_PX = { mouse: 12, pen: 16, touch: 26 };
const SNAP_TXT = { vertex: 'Přichyceno k lomovému bodu.', edge: 'Přichyceno k hraně.', face: 'Bod na ploše prvku.' };
let lastPtrType = 'touch';
const _snRay = new THREE.Raycaster();
const _snOcc = new THREE.Raycaster();
const _snPtr = new THREE.Vector2();
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sq = new THREE.Vector3(), _sd = new THREE.Vector3();
function snapTargets() {
  const t = S.meshes.filter(pickable);
  for (const R of S.refs || []) if (R.visible && !R.ghost) for (const m of R.meshes) if (m.visible) t.push(m);
  return t;
}
const notCut = (p) => !S.clipOn || clipPlane.distanceToPoint(p) >= -1e-4;
function castAt(rc, cx, cy, targets) {
  const r = renderer.domElement.getBoundingClientRect();
  _snPtr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  rc.setFromCamera(_snPtr, camera);
  rc.near = 0; rc.far = Infinity;
  return rc.intersectObjects(targets, false).find((h) => notCut(h.point)) || null;
}
function snapEdgesOf(mesh) {
  const g = mesh.geometry;
  if (!g.userData.snapEdges) g.userData.snapEdges = new THREE.EdgesGeometry(g, 30);
  return g.userData.snapEdges.attributes.position;
}
function occluded(p, targets) {
  _sd.copy(p).sub(camera.position);
  const dist = _sd.length();
  if (dist < 1e-6) return false;
  _snOcc.set(camera.position, _sd.divideScalar(dist));
  _snOcc.near = 0; _snOcc.far = dist;
  const h = _snOcc.intersectObjects(targets, false).find((x) => notCut(x.point));
  return !!h && h.distance < dist - Math.max(0.01, dist * 0.003);
}
/* předvýběr prvků, jejichž obalová koule je u paprsku pod kurzorem (velké modely: místo desítek tisíc
   prvků se testuje jen pár desítek) */
const _sph = new THREE.Sphere(), _sv = new THREE.Vector3(), _nr = new THREE.Raycaster();
function nearRay(list, cx, cy, Rpx) {
  const r = renderer.domElement.getBoundingClientRect();
  _snPtr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  _nr.setFromCamera(_snPtr, camera);
  const ray = _nr.ray;
  const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / r.height;
  const out = [];
  for (const m of list) {
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _sph.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
    const t = _sv.copy(_sph.center).sub(ray.origin).dot(ray.direction);
    if (t < -_sph.radius) continue;
    const tol = _sph.radius + Rpx * 1.5 * k * Math.max(t, camera.near);
    if (ray.distanceSqToPoint(_sph.center) <= tol * tol) out.push(m);
  }
  return out;
}
function findSnap(cx, cy, type) {
  if (S.modelID == null) return null;
  const R = SNAP_PX[type] || SNAP_PX.touch;
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = cx - rect.left, sy = cy - rect.top;
  let targets = snapTargets();
  if (targets.length > 1500) targets = nearRay(targets, cx, cy, R);
  const center = castAt(_snRay, cx, cy, targets);
  const ray0 = _snRay.ray.clone();
  const near = new Map();
  if (center) near.set(center.object, center);
  // dva kroužky paprsků kolem kurzoru: chytí i roh na obrysu, kde do modelu míří jen úzký klín
  for (const rr of [R * 0.45, R * 0.85]) {
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4 + (rr < R * 0.5 ? 0.2 : 0.6);
      const h = castAt(_snOcc, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, targets);
      if (h && !near.has(h.object)) near.set(h.object, h);
    }
  }
  const verts = [], edges = [];
  for (const mesh of near.keys()) {
    const pos = snapEdgesOf(mesh);
    if (pos.count > 400000) continue;
    const mw = mesh.matrixWorld;
    for (let i = 0; i + 1 < pos.count; i += 2) {
      _sa.fromBufferAttribute(pos, i).applyMatrix4(mw);
      _sb.fromBufferAttribute(pos, i + 1).applyMatrix4(mw);
      for (const p of [_sa, _sb]) {
        const s = toScreen(p);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - sx, s.y - sy);
        if (d < R) verts.push({ d, p: p.clone(), mesh });
      }
      ray0.distanceSqToSegment(_sa, _sb, null, _sq);
      const s = toScreen(_sq);
      if (s.ok) {
        const d = Math.hypot(s.x - sx, s.y - sy);
        if (d < R * 0.7) edges.push({ d, p: _sq.clone(), mesh });
      }
    }
  }
  const best = (list, n) => {
    list.sort((a, b) => a.d - b.d);
    const tried = [];
    for (const c of list) {
      if (!notCut(c.p) || tried.some((q) => q.distanceToSquared(c.p) < 1e-8)) continue;
      if (tried.length >= n) break;
      tried.push(c.p);
      if (!occluded(c.p, targets)) return c;
    }
    return null;
  };
  const v = best(verts, 4);
  if (v) return { p: v.p, kind: 'vertex', object: v.mesh };
  const e = best(edges, 3);
  if (e) return { p: e.p, kind: 'edge', object: e.mesh };
  if (center) return { p: center.point.clone(), kind: 'face', object: center.object };
  return null;
}

/* ----- měření: přímá vzdálenost + pravoúhlý trojúhelník (svislá a vodorovná odvěsna) ----- */
const fmtM = (v) => `${nf3.format(v)} m`;
function dot(kind) {
  const d = el('div', 'mdot' + (kind === 'vertex' ? ' snap' : kind === 'edge' ? ' edge' : ''));
  overlay.appendChild(d);
  return d;
}
function triParts(a, b) {
  const low = a.y <= b.y ? a : b, high = low === a ? b : a;
  const c = new THREE.Vector3(low.x, high.y, low.z);
  const dy = high.y - low.y, dh = Math.hypot(b.x - a.x, b.z - a.z);
  return { low, high, c, dy, dh, d: a.distanceTo(b), legs: dy >= 0.005 && dh >= 0.005 };
}
function newLine(mat) {
  const l = new Line2(new LineGeometry(), mat);
  l.renderOrder = 999;
  measureScene.add(l);
  return l;
}
function setLine(l, a, b) {
  l.geometry.dispose();
  l.geometry = new LineGeometry();
  l.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
}
function buildMeasure(a, b, dots, preview = false) {
  const m = { dots, preview };
  m.line = newLine(measureMat);
  m.vLine = newLine(legVMat);
  m.hLine = newLine(legHMat);
  m.label = el('div', 'mlabel' + (preview ? ' preview' : ''));
  m.vLabel = el('div', 'mlabel leg v' + (preview ? ' preview' : ''));
  m.hLabel = el('div', 'mlabel leg h' + (preview ? ' preview' : ''));
  overlay.append(m.label, m.vLabel, m.hLabel);
  setMeasureGeom(m, a, b);
  return m;
}
function setMeasureGeom(m, a, b) {
  m.a = a; m.b = b; m.t = triParts(a, b);
  setLine(m.line, a, b);
  setLine(m.vLine, m.t.low, m.t.c);
  setLine(m.hLine, m.t.c, m.t.high);
  m.label.textContent = fmtM(m.t.d);
  m.vLabel.textContent = `↕ ${fmtM(m.t.dy)}`;
  m.hLabel.textContent = `↔ ${fmtM(m.t.dh)}`;
  applyTriVis(m);
}
function applyTriVis(m) {
  const on = S.measure.tri && m.t.legs;
  m.vLine.visible = m.hLine.visible = on;
  m.legsOn = on;
}
function disposeMeasure(m) {
  for (const l of [m.line, m.vLine, m.hLine]) { measureScene.remove(l); l.geometry.dispose(); }
  for (const n of [m.label, m.vLabel, m.hLabel, ...(m.dots || [])]) n?.remove();
}
function measurePoint(sn) {
  const M = S.measure;
  if (!M.first) {
    M.first = { p: sn.p, dot: dot(sn.kind) };
    setMeasureText('Klepněte na druhý bod', `První bod: ${SNAP_TXT[sn.kind].toLowerCase()}`);
  } else {
    const m = buildMeasure(M.first.p, sn.p, [M.first.dot, dot(sn.kind)]);
    M.list.push(m);
    M.first = null;
    showMeasureResult(m);
  }
  updatePreview(null);
  requestRender();
}
function measureSub(t) {
  return `vodorovně ${nf3.format(t.dh)} · svisle ${nf3.format(t.dy)} m`;
}
function showMeasureResult(m) {
  setMeasureText(fmtM(m.t.d), measureSub(m.t));
}
function setMeasureText(main, sub) { $('#m-main').textContent = main; $('#m-sub').textContent = sub; }
function idleMeasureText() {
  const M = S.measure;
  if (M.first) setMeasureText('Klepněte na druhý bod', 'Esc nebo Smazat zruší rozpracované měření.');
  else if (M.list.length) showMeasureResult(M.list[M.list.length - 1]);
  else setMeasureText('Klepněte na první bod', 'Body se přichytávají k lomovým bodům a hranám prvků.');
}
/* náhled druhého bodu při najetí myší nebo Apple Pencil */
function updatePreview(p) {
  const M = S.measure;
  if (!p || !M.first || !M.on) {
    if (M.preview) { disposeMeasure(M.preview); M.preview = null; requestRender(); }
    return;
  }
  if (!M.preview) M.preview = buildMeasure(M.first.p, p, [], true);
  else setMeasureGeom(M.preview, M.first.p, p);
  setMeasureText(fmtM(M.preview.t.d), measureSub(M.preview.t));
}
const snapHint = el('div', 'snaphint');
snapHint.hidden = true;
let hoverReq = 0, hoverPos = null, hoverSnap = null;
function runHover() {
  hoverReq = 0;
  if (!hoverPos || !(S.measure.on || coord.on)) return;
  hoverSnap = findSnap(hoverPos.x, hoverPos.y, hoverPos.type);
  showHover();
}
function showHover() {
  const sn = hoverSnap;
  if (!sn) {
    snapHint.hidden = true;
    updatePreview(null);
    if (S.measure.on) idleMeasureText();
    requestRender();
    return;
  }
  if (!snapHint.isConnected) overlay.appendChild(snapHint);
  snapHint.className = `snaphint ${sn.kind}`;
  snapHint.hidden = false;
  if (S.measure.on) {
    if (S.measure.first) updatePreview(sn.p);
    else setMeasureText('Klepněte na první bod', SNAP_TXT[sn.kind]);
  }
  requestRender();
}
function clearHover() {
  hoverPos = null; hoverSnap = null;
  snapHint.hidden = true;
  updatePreview(null);
  if (S.measure.on) idleMeasureText();
  requestRender();
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || !(S.measure.on || coord.on)) return;
  if (pointers.size) { if (hoverPos) clearHover(); return; } // tažení = otáčení pohledu
  hoverPos = { x: e.clientX, y: e.clientY, type: e.pointerType || 'mouse' };
  if (!hoverReq) hoverReq = requestAnimationFrame(runHover);
});
renderer.domElement.addEventListener('pointerleave', () => { if (hoverPos) clearHover(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.measure.on || !S.measure.first) return;
  S.measure.first.dot.remove();
  S.measure.first = null;
  updatePreview(null);
  idleMeasureText();
  requestRender();
});
function updateOverlay() {
  const M = S.measure;
  const place = (node, p, off) => {
    const s = toScreen(p);
    node.hidden = off || !s.ok;
    node.style.left = `${s.x}px`; node.style.top = `${s.y}px`;
  };
  if (M.first) place(M.first.dot, M.first.p);
  const all = M.preview ? [...M.list, M.preview] : M.list;
  for (const m of all) {
    if (m.dots[0]) place(m.dots[0], m.a);
    if (m.dots[1]) place(m.dots[1], m.b);
    place(m.label, _mid.copy(m.a).add(m.b).multiplyScalar(0.5));
    place(m.vLabel, _mid.copy(m.t.low).add(m.t.c).multiplyScalar(0.5), !m.legsOn);
    place(m.hLabel, _mid.copy(m.t.c).add(m.t.high).multiplyScalar(0.5), !m.legsOn);
  }
  if (hoverSnap && !snapHint.hidden) place(snapHint, hoverSnap.p);
}
const _mid = new THREE.Vector3();
function clearMeasures() {
  const M = S.measure;
  M.list.forEach(disposeMeasure);
  M.list = [];
  if (M.first) M.first.dot.remove();
  M.first = null;
  updatePreview(null);
  idleMeasureText();
  requestRender();
}
function toggleMeasure(force) {
  const M = S.measure;
  M.on = force ?? !M.on;
  if (M.on && coord.on) toggleCoord(false);
  if (!M.on && M.first) { M.first.dot.remove(); M.first = null; }
  if (!M.on) { updatePreview(null); snapHint.hidden = true; hoverSnap = null; }
  if (M.on) {
    if (S.selected != null) deselect();
    idleMeasureText();
  }
  $('#measure-bar').hidden = !M.on;
  updateToolbar();
  requestRender();
}
function setMeasureTri(on) {
  S.measure.tri = on;
  try { localStorage.setItem('ifc-nahled-measure-tri', on ? '1' : '0'); } catch (e) { /* ignore */ }
  $('#m-tri').setAttribute('aria-pressed', String(on));
  for (const m of S.measure.list) applyTriVis(m);
  if (S.measure.preview) applyTriVis(S.measure.preview);
  requestRender();
}
try { S.measure.tri = localStorage.getItem('ifc-nahled-measure-tri') !== '0'; } catch (e) { S.measure.tri = true; }
$('#m-tri').setAttribute('aria-pressed', String(S.measure.tri));
$('#m-tri').addEventListener('click', () => setMeasureTri(!S.measure.tri));
$('#m-clear').addEventListener('click', clearMeasures);
$('#m-done').addEventListener('click', () => toggleMeasure(false));


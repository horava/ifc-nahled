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


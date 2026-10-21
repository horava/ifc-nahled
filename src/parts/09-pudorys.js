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
  bigSync();
  renderer.render(scene, oc);
  if (typeof watchDetailPlan === 'function') watchDetailPlan();
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


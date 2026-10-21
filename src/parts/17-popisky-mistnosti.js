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
  bigSync();
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
  // citace mapových podkladů
  let srcs = [];
  try { srcs = dataAttribution(true); } catch (e) { /* bez dat */ }
  if (srcs.length) {
    const t = `Zdroje dat: ${srcs.join(' · ')}`;
    g.font = `10px ${sans}`; g.textAlign = 'right';
    const tw = g.measureText(t).width;
    g.fillStyle = bg; g.globalAlpha = 0.85; g.fillRect(w - tw - 12, head + h - 18, tw + 10, 15); g.globalAlpha = 1;
    g.fillStyle = muted; g.fillText(t, w - 7, head + h - 7);
  }
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


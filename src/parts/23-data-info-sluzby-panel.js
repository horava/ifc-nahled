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
    let attr = cleanAttr(info.copyrightText);
    if (!attr) { try { attr = cleanAttr((await fetchJson(`${scene[1]}?f=json`)).copyrightText); } catch (e) { /* bez popisu */ } }
    return [{ name: info.name || 'Scéna', note: `SceneServer · ${info.layerType || ''}`, src: { type: 'i3s', url: `${scene[1]}/layers/${lid}`, attr }, custom: true }];
  }
  if (/\/ImageServer\/?(\?.*)?$/i.test(url)) {
    const base0 = url.replace(/\?.*$/, '').replace(/\/+$/, '');
    const info = await fetchJson(`${base0}?f=json`);
    const attr = cleanAttr(info.copyrightText);
    const out0 = [{ name: `${info.name || 'Rastr'} (obrázek)`, note: 'ArcGIS ImageServer', src: { type: 'agsimg', url: base0, attr }, custom: true }];
    if (info.bandCount === 1 && /F32|F64|S16|S32|U16/i.test(info.pixelType || '')) out0.unshift({ name: `${info.name || 'Rastr'} jako terén`, note: `výšky, buňka ${nf.format(info.pixelSizeX || 0)} m`, src: { type: 'agsterrain', url: base0, cell: info.pixelSizeX || 2, attr }, custom: true });
    return out0;
  }
  const ags = url.match(/^(.*\/(MapServer|FeatureServer|ImageServer))(\/(\d+))?\/?(\?.*)?$/i);
  if (ags) {
    const base = ags[1], layer = ags[4];
    if (layer != null) {
      const info = await fetchJson(`${base}/${layer}?f=json`);
      let attr = cleanAttr(info.copyrightText);
      if (!attr) { try { attr = cleanAttr((await fetchJson(`${base}?f=json`)).copyrightText); } catch (e) { /* bez popisu */ } }
      return [{ name: info.name || `Vrstva ${layer}`, note: 'ArcGIS, vektory', src: { type: 'agsfeat', url: `${base}/${layer}`, attr }, custom: true }];
    }
    const info = await fetchJson(`${base}?f=json`);
    const title = info.documentInfo?.Title || info.mapName || info.name || base.split('/').slice(-2, -1)[0];
    const attr = cleanAttr(info.copyrightText);
    if (/ImageServer$/i.test(base)) return [{ name: title || 'Rastr', note: 'ArcGIS ImageServer', src: { type: 'agsimg', url: base, attr }, custom: true }];
    const out = [];
    if (/MapServer$/i.test(base)) out.push({ name: `${title} (mapa)`, note: 'ArcGIS, obrázek všech vrstev', src: { type: 'agsmap', url: base, format: 'png32', transparent: true, identify: true, attr }, custom: true });
    const canQuery = /Query/i.test(info.capabilities || '') || /FeatureServer$/i.test(base);
    if (canQuery) (info.layers || []).filter((l) => !l.subLayerIds?.length).slice(0, 60).forEach((l) => out.push({ name: l.name, note: 'vektory s atributy', src: { type: 'agsfeat', url: `${base}/${l.id}`, attr }, custom: true }));
    return out;
  }
  // WMS (1.3.0 i 1.1.1)
  const base = url.replace(/\?.*$/, '');
  const cap = await wmsCaps(base);
  const F = dataFrame();
  const out = [];
  const common = { type: 'wms', url: base, version: cap.version, format: cap.format, infoFormat: cap.infoFormat, attr: cap.attr };
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
  // citace: Attribution kořenové vrstvy, jinak poskytovatel služby
  const attr = cleanAttr(root?.querySelector(':scope > Attribution > Title')?.textContent
    || xml.querySelector('Service ContactOrganization')?.textContent || '');
  const res = { version, format, infoFormat, title, crs, layers, all, queryAll, attr };
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
      : L.i3s ? `${L.i3s.nodes.length} částí scény${L.src.hideUnderIfc !== false && L.hiddenCount ? ` · skryto ${L.hiddenCount} pod IFC` : ''}${L.i3s.warn ? ` · ${L.i3s.warn}` : ''}` : (L.note || '');
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
    if (L.visible && L.state === 'ok' && L.i3s) {
      const on = L.src.hideUnderIfc !== false;
      const hb = el('button', 'sbtn mini-btn dl-hide' + (on ? ' primary' : ''), on ? 'Skrývat budovy pod IFC: zapnuto' : 'Skrývat budovy pod IFC');
      hb.type = 'button';
      hb.setAttribute('aria-pressed', String(on));
      hb.title = 'Budovy scény, které leží v půdorysu načtených IFC modelů, se nezobrazí';
      hb.addEventListener('click', () => { L.src.hideUnderIfc = !on; saveDataLayers(); buildDataLayer(L); renderDataPanel(); requestRender(); markPlanDirty(0); });
      const w0 = el('div', 'dl-hide-row'); w0.appendChild(hb);
      sec.appendChild(w0);
    }
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
  // WMS: ostré podle displeje (popisky můžou být u některých serverů drobné), nebo větší písmo
  const shSel = el('select', 'color-key');
  [['1', 'Ostré'], ['0', 'Větší písmo']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; shSel.appendChild(o); });
  shSel.value = D.sharp ? '1' : '0';
  shSel.title = 'Když jsou popisky WMS map (katastr, technická mapa) moc drobné, zvolte Větší písmo.';
  shSel.addEventListener('change', () => {
    D.sharp = shSel.value === '1';
    try { localStorage.setItem('ifc-nahled-data-sharp', D.sharp ? '1' : '0'); } catch (e) { /* ignore */ }
    D.layers.forEach((L) => { L.detailTok = (L.detailTok || 0) + 1; L.detailPending = null; dropDetail(L); });
    scheduleDetail();
  });
  grid.append(lab('Popisky WMS map', shSel));
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
  const src = dataAttribution(false);
  root.appendChild(el('p', 'muted small pad', src.length
    ? `Zdroje dat: ${src.join(' · ')}. Na server se posílá jen výřez okolí modelu, model zůstává v zařízení.`
    : 'Podklady poskytují ČÚZK (ČÚZK, rok; licence CC BY 4.0), statutární město Brno a provozovatelé vlastních služeb. Na server se posílá jen výřez okolí modelu, model zůstává v zařízení.'));
}
/* po načtení modelu: znovu vytvořit vrstvy pro nový výřez */
function dataOnModelLoaded() {
  D.infoAt = null; D.infoRes = null; D.groundH = null;
  updateDataMarker();
  D.layers.forEach((L) => { disposeLayerObj(L); L.img = null; L.features = null; L.dem = null; L.i3s = null; L.state = 'idle'; });
  if (dataFrame()) D.layers.filter((L) => L.visible).forEach((L) => loadDataLayer(L));
  renderDataPanel();
}


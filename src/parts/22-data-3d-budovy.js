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
/* půdorysná stopa načtených IFC modelů (hlavní + viditelné podkladové) jako mřížka 0,5 m ve scéně */
const FOOT_SKIP = new Set(['IFCSITE', 'IFCGEOGRAPHICELEMENT', 'IFCSPACE', 'IFCOPENINGELEMENT', 'IFCVIRTUALELEMENT', 'IFCANNOTATION', 'IFCGRID', 'IFCCIVILELEMENT']);
let footCache = null;
function ifcFootprint() {
  const sig = `${S.modelGen}|${S.fileName}|${(S.refs || []).filter((R) => R.visible).map((R) => `${R.id}`).join(',')}`;
  if (footCache?.sig === sig) return footCache;
  const meshes = [];
  for (const rec of S.elements.values()) if (!FOOT_SKIP.has(U(rec.cls))) meshes.push(...rec.meshes);
  for (const R of S.refs || []) {
    if (!R.visible) continue;
    if (!R.cls) R.cls = new Map();
    for (const m of R.meshes) {
      const id = m.userData.id;
      if (!R.cls.has(id)) { let c = ''; try { c = U(S.api.GetNameFromTypeCode(S.api.GetLineType(R.mid, id))); } catch (e) { /* ignore */ } R.cls.set(id, c); }
      if (!FOOT_SKIP.has(R.cls.get(id))) meshes.push(m);
    }
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const tmp = new THREE.Box3();
  for (const m of meshes) {
    m.updateMatrixWorld();
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    x0 = Math.min(x0, tmp.min.x); z0 = Math.min(z0, tmp.min.z); x1 = Math.max(x1, tmp.max.x); z1 = Math.max(z1, tmp.max.z);
  }
  if (!meshes.length || !Number.isFinite(x0)) { footCache = { sig, empty: true }; return footCache; }
  let cell = 0.5;
  while (((x1 - x0) / cell) * ((z1 - z0) / cell) > 4e6) cell *= 2;
  x0 -= cell * 2; z0 -= cell * 2;
  const nx = Math.ceil((x1 - x0) / cell) + 3, nz = Math.ceil((z1 - z0) / cell) + 3;
  const occ = new Uint8Array(nx * nz);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, ix = m.geometry.index?.array;
    if (!pos || !ix) continue;
    for (let t = 0; t < ix.length; t += 3) {
      a.fromBufferAttribute(pos, ix[t]).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ix[t + 1]).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ix[t + 2]).applyMatrix4(m.matrixWorld);
      const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(d) < 1e-6) continue; // svislé plochy půdorys nepokrývají
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / cell));
      for (let j = j0; j <= j1; j++) {
        const pz = z0 + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * cell;
          const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / d;
          const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / d;
          if (w0 >= -1e-9 && w1 >= -1e-9 && w0 + w1 <= 1 + 1e-9) occ[j * nx + i] = 1;
        }
      }
    }
  }
  // rozšíření o jednu buňku: tolerance mezi LoD2 modelem a IFC
  const dil = occ.slice();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!occ[j * nx + i]) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) dil[jj * nx + ii] = 1;
    }
  }
  footCache = { sig, x0, z0, cell, nx, nz, occ: dil };
  return footCache;
}
function footInside(fp, x, z) {
  const i = Math.floor((x - fp.x0) / fp.cell), j = Math.floor((z - fp.z0) / fp.cell);
  return i >= 0 && j >= 0 && i < fp.nx && j < fp.nz && fp.occ[j * fp.nx + i] === 1;
}
/* budovy scény, které z víc než poloviny střechy leží ve stopě IFC modelu, se skryjí (trojúhelníky se zdegenerují,
   takže zůstane platné číslování prvků pro „Info o místě“) */
function i3sHideUnderIfc(mesh, g, fp) {
  if (!g.faceRange || fp.empty) return { pos: g.position, hidden: 0 };
  const pos = g.position.slice();
  const m = mesh.matrix;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let hidden = 0;
  for (let k = 0; k < g.faceRange.length / 2; k++) {
    const t0 = g.faceRange[2 * k], t1 = g.faceRange[2 * k + 1];
    let flat = 0, flatIn = 0, all = 0, allIn = 0;
    for (let t = t0; t <= t1; t++) {
      const o = t * 9;
      va.set(pos[o], pos[o + 1], pos[o + 2]).applyMatrix4(m);
      vb.set(pos[o + 3], pos[o + 4], pos[o + 5]).applyMatrix4(m);
      vc.set(pos[o + 6], pos[o + 7], pos[o + 8]).applyMatrix4(m);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      const n = ab.cross(ac), A = n.length() / 2;
      if (A < 1e-6) continue;
      const inside = footInside(fp, (va.x + vb.x + vc.x) / 3, (va.z + vb.z + vc.z) / 3);
      all += A; if (inside) allIn += A;
      if (Math.abs(n.y) / (2 * A) > 0.3) { flat += A; if (inside) flatIn += A; }
    }
    const frac = flat > 0 ? flatIn / flat : all > 0 ? allIn / all : 0;
    if (frac > 0.5) {
      hidden++;
      for (let t = t0; t <= t1; t++) {
        const o = t * 9;
        pos[o + 3] = pos[o + 6] = pos[o]; pos[o + 4] = pos[o + 7] = pos[o + 1]; pos[o + 5] = pos[o + 8] = pos[o + 2];
      }
    }
  }
  return { pos, hidden };
}
function buildI3S(L, F) {
  const grp = new THREE.Group();
  const M = reqToSceneMatrix(F);
  const hideIfc = L.src.hideUnderIfc !== false;
  const fp = hideIfc ? ifcFootprint() : null;
  L.hiddenCount = 0;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: (L.opacity ?? 1) < 1, opacity: L.opacity ?? 1 });
  const plain = new THREE.MeshLambertMaterial({ color: 0xd9d4cc, side: THREE.DoubleSide, transparent: (L.opacity ?? 1) < 1, opacity: L.opacity ?? 1 });
  for (const { n, g } of L.i3s.nodes) {
    const geo = new THREE.BufferGeometry();
    const c0 = n.obb.center;
    const mtx = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(c0[0], c0[1], c0[2]));
    let posArr = g.position;
    if (fp) { const r = i3sHideUnderIfc({ matrix: mtx }, g, fp); posArr = r.pos; L.hiddenCount += r.hidden; }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
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
/* obrázek mapy položený pod model nebo na terén; detail = ostrý výřez nad základním obrázkem */
function imageLayerMesh(L, F, img, X, detail) {
  const idx = D.layers.indexOf(L);
  const dem = activeDem();
  const H = dataGroundH(F);
  const lift = -0.06 + idx * 0.004 + (detail ? 0.002 : 0);
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: L.opacity ?? 1, depthWrite: false, side: THREE.DoubleSide });
  if (!detail) {
    // „díra“ v základním obrázku pod ostrým detailem: u průhledných map (katastr, DTM) by jinak
    // rozmazané čáry základního obrázku prosvítaly pod ostrými
    const hole = { value: new THREE.Vector4(0, 0, 0, 0) };
    mat.userData.hole = hole;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHole = hole;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uHole;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  if (vMapUv.x > uHole.x && vMapUv.x < uHole.z && vMapUv.y > uHole.y && vMapUv.y < uHole.w) discard;');
    };
    mat.customProgramCacheKey = () => 'map-hole';
    L.baseMat = mat;
  }
  let geo;
  if (dem) {
    // potah terénu: stejná síť, posunutá nad terén, aby se s ním nepřekrývala
    geo = demGeometry(dem, F, 0.03 + idx * 0.01 + (detail ? 0.005 : 0), X, detail ? X : null);
    Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 - idx - (detail ? 1 : 0) });
  } else {
    const c = [[X.e0, X.n0], [X.e1, X.n0], [X.e1, X.n1], [X.e0, X.n1]].map(([E, N]) => dataScene(F, E, N, H, lift));
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([c[0], c[1], c[2], c[0], c[2], c[3]].flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -20 + idx + (detail ? 0.5 : 0);
  if (detail) mesh.userData.detail = true;
  return mesh;
}

/* ---------- ostrý detail mapových podkladů ----------
   Základní obrázek vrstvy pokrývá celé okolí (2048 px), takže po přiblížení je rozmazaný a popisky
   nečitelné. Když se pohled na chvíli zastaví, dočte se pro právě viditelnou oblast druhý obrázek
   v rozlišení displeje a položí se nad základní – podobně jako dlaždice webových map. */
const DETAIL_TYPES = new Set(['wms', 'agsmap', 'agsimg']);
const DETAIL_MAX = 2048;
let detailTimer = 0, detailFrom = '3d', lastCamKey = '', lastPlanKey = '';
try { D.sharp = localStorage.getItem('ifc-nahled-data-sharp') !== '0'; } catch (e) { D.sharp = true; }
function scheduleDetail(from) {
  if (from) detailFrom = from;
  clearTimeout(detailTimer);
  detailTimer = setTimeout(updateDetails, 450);
}
function watchDetailView() {
  if (!D.layers.length) return;
  const e = camera.matrixWorld.elements;
  const k = [e[12], e[13], e[14], e[8], e[9], e[10]].map((v) => v.toFixed(3)).join(',') + camera.fov;
  if (k !== lastCamKey) { lastCamKey = k; scheduleDetail('3d'); }
}
function watchDetailPlan() {
  if (!D.layers.length || !plan.view) return;
  const { w, h } = planSize();
  const k = `${plan.view.cx.toFixed(2)},${plan.view.cz.toFixed(2)},${plan.view.ppm.toFixed(4)},${w},${h}`;
  if (k !== lastPlanKey) { lastPlanKey = k; scheduleDetail('plan'); }
}
const _dRay = new THREE.Raycaster(), _dPlane = new THREE.Plane(), _dV = new THREE.Vector3(), _dN = new THREE.Vector2();
/* viditelná oblast v souřadnicích požadavku a potřebné rozlišení (m na CSS pixel) */
function detailView(F, base) {
  const toReq = (p) => { const l = toIfcPoint(p); return F.toReq(l.x, l.y); };
  const pts = [];
  let mpp;
  if (detailFrom === 'plan' && plan.on && plan.view) {
    const { w, h } = planSize();
    const A = planAxes(), hw = w / 2 / plan.view.ppm, hh = h / 2 / plan.view.ppm;
    for (const a of [-hw, hw]) for (const b of [-hh, hh]) pts.push(toReq(new THREE.Vector3(plan.view.cx + a * A.rx + b * A.ux, 0, plan.view.cz + a * A.rz + b * A.uz)));
    mpp = 1 / plan.view.ppm;
  } else {
    const H = dataGroundH(F);
    const g = dataScene(F, (base.e0 + base.e1) / 2, (base.n0 + base.n1) / 2, H, 0);
    _dPlane.set(new THREE.Vector3(0, 1, 0), -g.y);
    const vh = renderer.domElement.clientHeight || 1;
    _dN.set(0, 0); _dRay.setFromCamera(_dN, camera);
    const c = _dRay.ray.intersectPlane(_dPlane, _dV);
    if (!c) return null;
    const dc = c.distanceTo(camera.position);
    mpp = dc * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / vh;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      _dN.set(-1 + i / 2, -1 + j / 2); _dRay.setFromCamera(_dN, camera);
      const p = _dRay.ray.intersectPlane(_dPlane, _dV);
      if (p && p.distanceTo(camera.position) < dc * 2.5) pts.push(toReq(p));
    }
    if (pts.length < 3) return null;
  }
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const [E, N] of pts) { e0 = Math.min(e0, E); n0 = Math.min(n0, N); e1 = Math.max(e1, E); n1 = Math.max(n1, N); }
  // jen uvnitř načteného okolí
  e0 = Math.max(e0, base.e0); n0 = Math.max(n0, base.n0); e1 = Math.min(e1, base.e1); n1 = Math.min(n1, base.n1);
  if (!(e1 - e0 > 1 && n1 - n0 > 1)) return null;
  return { e0, n0, e1, n1, mpp };
}
function updateDetails() {
  const F = dataFrame();
  if (!F) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const L of D.layers) {
    if (!DETAIL_TYPES.has(L.src.type) || L.state !== 'ok' || !L.img || !L.obj || !L.visible) continue;
    const base = L.ext;
    const v = detailView(F, base);
    // hustota: ArcGIS umí dpi vždy; u WMS „ostré“ = podle displeje, „větší písmo“ = 1 obrazový bod na CSS pixel
    const s = L.src.type === 'wms' && !D.sharp ? 1 : dpr;
    const need = v ? v.mpp / s : Infinity;
    const baseMpp = (base.e1 - base.e0) / base.W;
    if (!v || baseMpp <= need * 1.4) { dropDetail(L); continue; }
    let W = (v.e1 - v.e0) / need, Hh = (v.n1 - v.n0) / need;
    const k = Math.min(1, DETAIL_MAX / Math.max(W, Hh));
    W = Math.max(64, Math.round(W * k)); Hh = Math.max(64, Math.round(Hh * k));
    const X = { e0: v.e0, n0: v.n0, e1: v.e1, n1: v.n1, W, H: Hh, dpi: Math.round(96 * s) };
    const key = [X.e0, X.n0, X.e1, X.n1].map((x) => x.toFixed(1)).join(',') + `|${W}x${Hh}|${X.dpi}`;
    if (L.detail?.key === key || L.detailPending === key) continue;
    L.detailPending = key;
    const tok = (L.detailTok = (L.detailTok || 0) + 1);
    loadImage(imageUrl(L.src, F, X)).then((img) => {
      if (tok !== L.detailTok || !L.obj || L.state !== 'ok') return;
      dropDetail(L);
      const mesh = imageLayerMesh(L, F, img, X, true);
      L.obj.add(mesh);
      L.detail = { key, mesh };
      if (L.baseMat?.userData.hole) {
        const b = L.ext, du = 1.5 / b.W, dv = 1.5 / b.H;
        L.baseMat.userData.hole.value.set((X.e0 - b.e0) / (b.e1 - b.e0) + du, (X.n0 - b.n0) / (b.n1 - b.n0) + dv, (X.e1 - b.e0) / (b.e1 - b.e0) - du, (X.n1 - b.n0) / (b.n1 - b.n0) - dv);
      }
      requestRender(); markPlanDirty(0);
    }).catch(() => { /* detail je jen vylepšení, základní obrázek zůstává */ }).finally(() => { if (tok === L.detailTok) L.detailPending = null; });
  }
}
function dropDetail(L) {
  if (!L.detail) return;
  const m = L.detail.mesh;
  m.parent?.remove(m);
  m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose();
  L.detail = null;
  L.baseMat?.userData.hole?.value.set(0, 0, 0, 0);
  requestRender(); markPlanDirty(0);
}
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
    grp.add(imageLayerMesh(L, F, L.img, L.ext, false));
    L.detail = null;
    scheduleDetail();
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


/* ---------- velké modely ----------
   Každý prvek má dál svůj „logický“ mesh (výběr, vlastnosti, měření, viditelnost…), ale ty se
   nekreslí jednotlivě – desítky tisíc kreslení za snímek by iPad nezvládl. Kreslí se sloučené bloky
   po podlažích a materiálech (geometrie ve světových souřadnicích) a opakované tvary jako instance.
   Logické meshe sdílejí s bloky pole vrcholů (pohled do stejné paměti), takže paměť se neduplikuje.
   Prvek, který má jiný materiál než výchozí (výběr, porovnání), se dočasně kreslí samostatně. */
const BIG_FILE = 60 * 1048576;   // od této velikosti souboru se geometrie čte bez normál (stínování po ploškách)
const BIG_MESHES = 6000;          // od tohoto počtu meshů se kreslí sloučeně
const INST_MIN = 16;              // tvar použitý aspoň tolikrát se kreslí jako instance
const CHUNK_VERTS = 1500000;
const flatMats = new Map();
function flatOf(mat) {
  let f = flatMats.get(mat);
  if (!f) { f = mat.clone(); f.flatShading = true; flatMats.set(mat, f); }
  return f;
}
const bigGhostMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, flatShading: true });
async function streamGeometry(api, modelID, onMesh, total) {
  const skip = new Set([WebIFC.IFCOPENINGELEMENT, WebIFC.IFCSPACE, WebIFC.IFCOPENINGSTANDARDCASE]);
  let ids = [];
  try {
    for (const t of api.GetIfcEntityList(modelID)) {
      if (skip.has(t) || !api.IsIfcElement(t)) continue;
      const v = api.GetLineIDsWithType(modelID, t);
      for (let i = 0; i < v.size(); i++) ids.push(v.get(i));
    }
  } catch (e) { ids = null; }
  if (!ids) { api.StreamAllMeshes(modelID, onMesh); return; }
  const B = 1000;
  let t = performance.now();
  for (let i = 0; i < ids.length; i += B) {
    api.StreamMeshes(modelID, ids.slice(i, i + B), onMesh);
    if (performance.now() - t > 150 && i + B < ids.length) {
      setLoadingStep(`Čtu geometrii… ${Math.round(100 * (i + B) / ids.length)} % (${(i + B).toLocaleString('cs-CZ')} z ${ids.length.toLocaleString('cs-CZ')} prvků)`);
      await nextFrame();
      t = performance.now();
    }
  }
}
/* geometrie z web-ifc: u velkých souborů jen polohy (bez normál) a 16bitové indexy, kde to jde */
function geometryFromIfc(v, idx, lean) {
  const geo = new THREE.BufferGeometry();
  if (lean) {
    const n = v.length / 6, P = new Float32Array(n * 3);
    for (let i = 0, j = 0; i < n; i++, j += 6) { P[i * 3] = v[j]; P[i * 3 + 1] = v[j + 1]; P[i * 3 + 2] = v[j + 2]; }
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setIndex(new THREE.BufferAttribute(n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), 1));
  } else {
    const ib = new THREE.InterleavedBuffer(new Float32Array(v), 6);
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  }
  geo.computeBoundingSphere();
  return geo;
}
function buildBigRender() {
  const t0 = performance.now();
  const uses = new Map();
  const cand = [];
  for (const m of S.meshes) {
    const rec = S.elements.get(m.userData.id);
    if (!rec || U(rec.cls) === 'IFCSPACE' || !m.geometry.index) continue;
    cand.push(m);
    uses.set(m.geometry, (uses.get(m.geometry) || 0) + 1);
  }
  const chunkLists = new Map(), instLists = new Map();
  for (const m of cand) {
    const rec = S.elements.get(m.userData.id);
    m.userData.big = true;
    m.userData.bigMat = m.material;
    if (uses.get(m.geometry) >= INST_MIN) {
      const k = m.geometry.uuid + '|' + m.material.uuid;
      if (!instLists.has(k)) instLists.set(k, []);
      instLists.get(k).push(m);
    } else {
      const k = `${rec.storey}|${m.material.uuid}`;
      if (!chunkLists.has(k)) chunkLists.set(k, []);
      chunkLists.get(k).push(m);
    }
  }
  S.bigChunks = [];
  S.bigInst = [];
  const left = new Map(uses);
  for (const list of chunkLists.values()) {
    let part = [], nv = 0;
    for (const m of list) {
      const n = m.geometry.attributes.position.count;
      if (part.length && nv + n > CHUNK_VERTS) { S.bigChunks.push(makeChunk(part, left)); part = []; nv = 0; }
      part.push(m); nv += n;
    }
    if (part.length) S.bigChunks.push(makeChunk(part, left));
  }
  for (const list of instLists.values()) S.bigInst.push(makeInst(list));
  for (const m of cand) { if (m.parent) m.parent.remove(m); m.updateMatrixWorld(true); }
  console.info(`Sloučené kreslení: ${S.bigChunks.length} bloků, ${S.bigInst.length} skupin instancí, ${Math.round(performance.now() - t0)} ms`);
}
function makeChunk(list, left) {
  let nv = 0, ni = 0;
  const withN = list.every((m) => !!m.geometry.attributes.normal);
  for (const m of list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
  const P = new Float32Array(nv * 3), N = withN ? new Float32Array(nv * 3) : null;
  const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  const nm = new THREE.Matrix3();
  const c = { members: list, ranges: new Uint32Array(list.length * 2), state: new Uint8Array(list.length) };
  let vo = 0, io = 0;
  list.forEach((m, k) => {
    const g = m.geometry, pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const w = m.matrix.elements;
    const arr = pos.isInterleavedBufferAttribute ? pos.data.array : pos.array;
    const st = pos.isInterleavedBufferAttribute ? pos.data.stride : 3, po = pos.offset || 0;
    for (let i = 0; i < n; i++) {
      const a = i * st + po, x = arr[a], y = arr[a + 1], z = arr[a + 2], o = (vo + i) * 3;
      P[o] = w[0] * x + w[4] * y + w[8] * z + w[12];
      P[o + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
      P[o + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
    }
    if (N) {
      nm.getNormalMatrix(m.matrix);
      const n9 = nm.elements;
      const narr = nor.isInterleavedBufferAttribute ? nor.data.array : nor.array;
      const nst = nor.isInterleavedBufferAttribute ? nor.data.stride : 3, no = nor.offset || 0;
      for (let i = 0; i < n; i++) {
        const b = i * nst + no, x = narr[b], y = narr[b + 1], z = narr[b + 2], o = (vo + i) * 3;
        N[o] = n9[0] * x + n9[3] * y + n9[6] * z; N[o + 1] = n9[1] * x + n9[4] * y + n9[7] * z; N[o + 2] = n9[2] * x + n9[5] * y + n9[8] * z;
      }
    }
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) I[io + i] = ia[i] + vo;
    c.ranges[k * 2] = io; c.ranges[k * 2 + 1] = ia.length;
    // logický mesh: pohled do polí bloku, vlastní (lokální) index, světové souřadnice
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(P.subarray(vo * 3, (vo + n) * 3), 3));
    if (N) lg.setAttribute('normal', new THREE.BufferAttribute(N.subarray(vo * 3, (vo + n) * 3), 3));
    lg.setIndex(new THREE.BufferAttribute(n < 65536 && !(ia instanceof Uint16Array) ? new Uint16Array(ia) : ia, 1));
    lg.computeBoundingSphere();
    const rest = left.get(g) - 1;
    left.set(g, rest);
    if (rest <= 0) g.dispose();
    m.geometry = lg;
    m.matrix.identity();
    vo += n; io += ia.length;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (N) geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  c.full = new THREE.BufferAttribute(I, 1);
  geo.setIndex(c.full);
  geo.computeBoundingSphere();
  const base = list[0].material;
  c.mesh = new THREE.Mesh(geo, [N ? base : flatOf(base), bigGhostMat]);
  c.mesh.userData.bigChunk = true;
  c.mesh.matrixAutoUpdate = false;
  if (base.transparent) c.mesh.renderOrder = 1;
  modelGroup.add(c.mesh);
  return c;
}
function makeInst(list) {
  const geo = list[0].geometry, base = list[0].material;
  const mat = geo.attributes.normal ? base : flatOf(base);
  const g = { members: list, state: new Uint8Array(list.length), geo, mat };
  g.mesh = new THREE.InstancedMesh(geo, mat, list.length);
  g.mesh.userData.bigChunk = true;
  modelGroup.add(g.mesh);
  return g;
}
/* stav prvku pro kreslení: 0 skrytý, 1 ve sloučeném bloku, 2 samostatně (jiný materiál), 3 duch při barvení */
function bigState(m) {
  if (!m.visible) return 0;
  if (m.material === m.userData.bigMat) return 1;
  if (S.color && m.userData.ghost && S.selected !== m.userData.id) return 3;
  return 2;
}
function setOverlay(m, on) {
  if (on) {
    if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
    if (m.parent !== modelGroup) modelGroup.add(m);
  } else if (m.parent) m.parent.remove(m);
}
function bigSync() {
  if (!S.bigChunks) return;
  if (S.color) bigGhostMat.color.set(ghostColor());
  for (const c of S.bigChunks) {
    let changed = false;
    const st = c.state;
    for (let k = 0; k < c.members.length; k++) {
      const m = c.members[k], s = bigState(m);
      if (s !== st[k]) { if (s === 2 || st[k] === 2) setOverlay(m, s === 2); st[k] = s; changed = true; }
    }
    if (changed || !c.ready) chunkIndex(c);
  }
  for (const g of S.bigInst) {
    let changed = false;
    const st = g.state;
    for (let k = 0; k < g.members.length; k++) {
      const m = g.members[k], s = bigState(m);
      if (s !== st[k]) { if (s === 2 || st[k] === 2) setOverlay(m, s === 2); st[k] = s; changed = true; }
    }
    if (changed || !g.ready) instUpdate(g);
  }
}
function chunkIndex(c) {
  c.ready = true;
  const geo = c.mesh.geometry, full = c.full.array, st = c.state, R = c.ranges;
  let n1 = 0, n3 = 0;
  for (let k = 0; k < st.length; k++) { if (st[k] === 1) n1 += R[k * 2 + 1]; else if (st[k] === 3) n3 += R[k * 2 + 1]; }
  geo.clearGroups();
  c.mesh.visible = n1 + n3 > 0;
  if (n1 === full.length) { geo.setIndex(c.full); geo.addGroup(0, n1, 0); return; }
  if (!c.part) c.part = new THREE.BufferAttribute(new full.constructor(full.length), 1);
  const out = c.part.array;
  let o = 0;
  for (const want of [1, 3]) {
    for (let k = 0; k < st.length; k++) {
      if (st[k] !== want) continue;
      const a = R[k * 2], n = R[k * 2 + 1];
      out.set(full.subarray(a, a + n), o);
      o += n;
    }
  }
  c.part.needsUpdate = true;
  geo.setIndex(c.part);
  if (n1) geo.addGroup(0, n1, 0);
  if (n3) geo.addGroup(n1, n3, 1);
}
function instUpdate(g) {
  g.ready = true;
  let n1 = 0, n3 = 0;
  for (let k = 0; k < g.state.length; k++) {
    const s = g.state[k];
    if (s === 1) g.mesh.setMatrixAt(n1++, g.members[k].matrix);
  }
  g.mesh.count = n1;
  g.mesh.visible = n1 > 0;
  g.mesh.instanceMatrix.needsUpdate = true;
  g.mesh.computeBoundingSphere();
  for (let k = 0; k < g.state.length; k++) if (g.state[k] === 3) n3++;
  if (n3 && !g.ghost) {
    g.ghost = new THREE.InstancedMesh(g.geo, bigGhostMat, g.members.length);
    g.ghost.userData.bigChunk = true;
    modelGroup.add(g.ghost);
  }
  if (g.ghost) {
    let j = 0;
    for (let k = 0; k < g.state.length; k++) if (g.state[k] === 3) g.ghost.setMatrixAt(j++, g.members[k].matrix);
    g.ghost.count = j;
    g.ghost.visible = j > 0;
    g.ghost.instanceMatrix.needsUpdate = true;
    g.ghost.computeBoundingSphere();
  }
}
/* prvek, na který jde ťuknout / přichytit se (duchové velkého modelu jsou „viditelní“ jen kvůli kreslení) */
const pickable = (m) => m.visible && !(S.color && m.userData.big && m.userData.ghost && S.selected !== m.userData.id);


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

async function saveFile(name, blob, mime) {
  // 1) claude.ai artifact: platform save dialog (.bcfzip is not on its list, so .zip)
  if (window.claude?.use) {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        const isBcf = /\.bcfzip$/i.test(name);
        await dl.save({ filename: isBcf ? name.replace(/\.bcfzip$/i, '.bcf.zip') : name, data: blob });
        toast(isBcf ? 'Uloženo jako .zip. Pro import do BIM nástroje přejmenujte příponu na .bcfzip.' : `Uloženo: ${name}`);
        return;
      }
    } catch (e) {
      if (e?.code === 'declined') return;
      console.warn('downloads', e);
    }
  }
  // 2) iPad / iPhone: share sheet (Uložit do Souborů, Mail, Teams…)
  const file = new File([blob], name, { type: mime || blob.type || 'application/octet-stream' });
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


/* =====================================================================
   EXPORT MÍSTNOSTÍ DO EXCELU (.xlsx)
   Soubor se skládá přímo v prohlížeči (SpreadsheetML zabalený přes fflate).
   ===================================================================== */
function xlsxBlob(sheets) {
  const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // styly: 0 výchozí, 1 hlavička, 2 číslo 0,00, 3 číslo 0,000, 4 celé číslo, 5 tučný řádek součtu (0,00), 6 tučný text
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECE9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8A9490"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const files = {};
  const sheetXml = (sh) => {
    const ncol = sh.cols.length;
    let rows = `<row r="1">${sh.cols.map((c, i) => `<c r="${col(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${x(c.h)}</t></is></c>`).join('')}</row>`;
    sh.rows.forEach((r, ri) => {
      const rn = ri + 2;
      let cells = '';
      r.forEach((v, ci) => {
        if (v == null || v === '') return;
        const ref = `${col(ci)}${rn}`;
        const bold = sh.boldRows?.has(ri);
        if (typeof v === 'number' && Number.isFinite(v)) {
          const st = bold ? 5 : sh.cols[ci].fmt === 'int' ? 4 : sh.cols[ci].fmt === '3' ? 3 : sh.cols[ci].fmt === '2' ? 2 : 0;
          cells += `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}" t="inlineStr"${bold ? ' s="6"' : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
        }
      });
      rows += `<row r="${rn}">${cells}</row>`;
    });
    const last = `${col(ncol - 1)}${sh.rows.length + 1}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${sh.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData>
${sh.filter !== false && sh.rows.length ? `<autoFilter ref="A1:${last}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
  };
  const safeName = (n, i) => (String(n).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `List${i + 1}`);
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sh)); });
  files['xl/styles.xml'] = strToU8(styles);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sh, i) => `<sheet name="${x(safeName(sh.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${sheets.map((sh, i) => (sh.filter !== false && sh.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(safeName(sh.name, i)).replace(/'/g, "''")}'!$A$1:$${col(sh.cols.length - 1)}$${sh.rows.length + 1}</definedName>` : '')).join('')}</definedNames>
</workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((sh, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(sheets[0]?.name || '')}</dc:title><dc:creator>IFC prohlížečka</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((sh, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
/* všechny místnosti modelu s podlažím (podle stromu i podle přiřazení geometrie) */
function allSpaces() {
  const out = new Map(); // id -> storeyId
  const walk = (n, st) => {
    let s = st;
    if (U(n.type || '') === 'IFCBUILDINGSTOREY') s = n.expressID;
    if (U(n.type || '') === 'IFCSPACE') out.set(n.expressID, s);
    for (const c of n.children || []) walk(c, s);
  };
  if (S.tree) walk(S.tree, null);
  for (const [id, rec] of S.elements) if (U(rec.cls) === 'IFCSPACE' && !out.has(id)) out.set(id, rec.storey);
  return out;
}
/* objem uzavřené geometrie (součet orientovaných čtyřstěnů) */
function meshVolume(rec) {
  let V = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of rec?.meshes || []) {
    const pos = m.geometry.attributes.position, ix = m.geometry.index?.array;
    if (!pos || !ix) continue;
    for (let i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(pos, ix[i]).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ix[i + 1]).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ix[i + 2]).applyMatrix4(m.matrixWorld);
      V += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return Math.abs(V);
}
async function exportRoomsXlsx(onlyIds, label) {
  if (S.modelID == null) return;
  const all = allSpaces();
  const ids = onlyIds ? onlyIds.filter((id) => all.has(id) || S.elements.has(id)) : [...all.keys()];
  if (!ids.length) { toast('Model nemá žádné místnosti (IfcSpace).', true); return; }
  toast('Připravuji tabulku místností…');
  try { await ensureIndex(); } catch (e) { /* bez indexu jen základní údaje */ }
  const stInfo = new Map(S.storeys.map((s, i) => [s.id, { name: s.name, order: i }]));
  const stName = (sid) => stInfo.get(sid)?.name || (() => { try { return val(S.api.GetLine(S.modelID, sid)?.Name); } catch (e) { return ''; } })() || '';
  const geo = S.geo?.ok;
  const [lE, lN, lH] = geoLabels();
  const rows = [];
  const propKeys = new Map(); // key -> {num}
  for (const id of ids) {
    const rec = S.elements.get(id);
    const r = S.idx?.ready ? S.idx.el.get(id) : null;
    let name = r?.a.Name || '', ln = r?.a.LongName || '', gid = r?.a.GlobalId || '';
    if (!r) { try { const L = S.api.GetLine(S.modelID, id); name = val(L?.Name); ln = val(L?.LongName); gid = val(L?.GlobalId); } catch (e) { /* ignore */ } }
    const sid = all.get(id) ?? rec?.storey;
    const fp = rec ? spaceFootprint(id) : null;
    const ar = spaceArea(id, fp);
    let h = null, vol = null, E = null, N = null, H = null;
    if (rec) {
      const bx = boxOf(rec.meshes);
      if (!bx.isEmpty()) h = bx.max.y - bx.min.y;
      vol = meshVolume(rec) || null;
      if (fp) {
        const p = new THREE.Vector3(fp.x, fp.y, fp.z);
        if (geo) { const m = geoMapFromScene(p); [E, N, H] = geoValues(m); } else { const l = toIfcPoint(p); E = l.x; N = l.y; H = l.z; }
      }
    }
    const props = new Map();
    if (r) {
      for (const s of [...r.tsets, ...r.sets]) for (const [k, v] of s.props) props.set(k, v);
      for (const [k, v] of props) { let pk = propKeys.get(k); if (!pk) { pk = { num: true }; propKeys.set(k, pk); } if (typeof v !== 'number') pk.num = false; }
    }
    rows.push({
      order: stInfo.get(sid)?.order ?? 9999, storey: sid != null && sid !== -1 ? stName(sid) : '',
      name, ln, area: ar?.v ?? null, src: ar ? (ar.src === 'geometrie' ? 'geometrie' : ar.src) : '', garea: fp?.area || null,
      h, vol, E, N, H, gid, type: r?.a.Typ || '', props,
    });
  }
  const coll = new Intl.Collator('cs', { numeric: true });
  rows.sort((a, b) => a.order - b.order || coll.compare(a.name || a.ln, b.name || b.ln));
  const pkeys = [...propKeys.keys()].sort(coll.compare);
  const cols = [
    { h: 'Podlaží', w: 12 }, { h: 'Číslo (Name)', w: 14 }, { h: 'Název (LongName)', w: 28 },
    { h: 'Plocha [m²]', w: 12, fmt: '2' }, { h: 'Zdroj plochy', w: 30 }, { h: 'Plocha z geometrie [m²]', w: 14, fmt: '2' },
    { h: 'Výška z geometrie [m]', w: 12, fmt: '2' }, { h: 'Objem z geometrie [m³]', w: 13, fmt: '2' },
    { h: geo ? `Těžiště ${lE}` : 'Těžiště x', w: 15, fmt: '3' }, { h: geo ? `Těžiště ${lN}` : 'Těžiště y', w: 15, fmt: '3' }, { h: geo ? `Podlaha ${lH}` : 'Podlaha z', w: 13, fmt: '3' },
    { h: 'Typ', w: 16 }, { h: 'GlobalId', w: 25 },
    ...pkeys.map((k) => ({ h: k, w: Math.min(Math.max(12, k.length * 0.9), 34), fmt: propKeys.get(k).num ? '2' : null })),
  ];
  const rd = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  const data = rows.map((r) => [r.storey, r.name, r.ln, rd(r.area, 4), r.src, rd(r.garea, 3), rd(r.h, 3), rd(r.vol, 3), rd(r.E, 3), rd(r.N, 3), rd(r.H, 3), r.type, r.gid, ...pkeys.map((k) => { const v = r.props.get(k); return v == null ? '' : typeof v === 'number' ? v : String(v); })]);
  // souhrn po podlažích
  const sum = new Map();
  for (const r of rows) {
    const k = r.storey || 'Mimo podlaží';
    if (!sum.has(k)) sum.set(k, { order: r.order, n: 0, a: 0 });
    const s0 = sum.get(k); s0.n++; s0.a += r.area || 0;
  }
  const sumRows = [...sum.entries()].sort((a, b) => a[1].order - b[1].order).map(([k, v]) => [k, v.n, rd(v.a, 3)]);
  const tot = sumRows.reduce((t, r) => [t[0] + r[1], t[1] + r[2]], [0, 0]);
  sumRows.push(['Celkem', tot[0], rd(tot[1], 3)]);
  // souhrn podle účelu / LongName
  const useKey = pkeys.find((k) => /\.(Ucel|Účel|Usage|OccupancyType)$/i.test(k));
  const byUse = new Map();
  for (const r of rows) {
    const u = (useKey ? r.props.get(useKey) : r.ln) || '(neuvedeno)';
    if (!byUse.has(u)) byUse.set(u, { n: 0, a: 0 });
    const s0 = byUse.get(u); s0.n++; s0.a += r.area || 0;
  }
  const useRows = [...byUse.entries()].sort((a, b) => b[1].a - a[1].a).map(([k, v]) => [String(k), v.n, rd(v.a, 3)]);
  useRows.push(['Celkem', tot[0], rd(tot[1], 3)]);
  const sheets = [
    { name: 'Místnosti', cols, rows: data },
    { name: 'Souhrn podle podlaží', cols: [{ h: 'Podlaží', w: 22 }, { h: 'Počet místností', w: 16, fmt: 'int' }, { h: 'Plocha celkem [m²]', w: 18, fmt: '2' }], rows: sumRows, filter: false, boldRows: new Set([sumRows.length - 1]) },
    { name: useKey ? 'Souhrn podle účelu' : 'Souhrn podle názvu', cols: [{ h: useKey ? useKey.slice(useKey.indexOf('.') + 1) : 'Název (LongName)', w: 28 }, { h: 'Počet místností', w: 16, fmt: 'int' }, { h: 'Plocha celkem [m²]', w: 18, fmt: '2' }], rows: useRows, filter: false, boldRows: new Set([useRows.length - 1]) },
  ];
  const blob = xlsxBlob(sheets);
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  const suffix = label ? `-${String(label).replace(/[\\/:*?"<>|]+/g, '_')}` : '';
  await saveFile(`${base}${suffix}-mistnosti.xlsx`, blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

$('#cmp-input').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; compareWith(f); });


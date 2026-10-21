/* ---------- georeference: IfcMapConversion ---------- */
const GEO_NUM = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v.value === 'number') return v.value;
    if (v._representationValue != null) return Number(v._representationValue);
    if (v._internalValue != null) return Number(v._internalValue);
    if (v.value != null && isFinite(Number(v.value))) return Number(v.value);
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const GEO_STR = (v) => (v == null ? '' : typeof v === 'object' ? String(v.value ?? v._representationValue ?? '') : String(v));
const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9 };
function unitFactor(u, depth = 0) { // metrů na jednotku
  if (!u || typeof u !== 'object' || depth > 4) return null;
  const name = GEO_STR(u.Name).toUpperCase();
  if (name === 'METRE') return SI_PREFIX[GEO_STR(u.Prefix).toUpperCase()] ?? 1;
  if (u.ConversionFactor) {
    const vc = GEO_NUM(u.ConversionFactor.ValueComponent);
    const base = unitFactor(u.ConversionFactor.UnitComponent, depth + 1) ?? 1;
    if (vc) return vc * base;
  }
  if (name === 'FOOT') return 0.3048;
  if (name === 'INCH') return 0.0254;
  return null;
}
function unitLabel(f) {
  if (f == null) return '—';
  const known = [[1, 'm'], [0.001, 'mm'], [0.01, 'cm'], [0.1, 'dm'], [0.3048, 'ft'], [0.0254, 'in'], [1000, 'km']];
  const k = known.find(([v]) => Math.abs(v - f) < 1e-9);
  return k ? k[1] : `${f} m`;
}

/* známé souřadnicové systémy pro převod do WGS84 (proj4) */
const KROVAK = '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs';
const EPSG_DEFS = {
  5514: ['S-JTSK / Krovak East North', KROVAK],
  5513: ['S-JTSK / Krovak (Y, X kladné)', KROVAK],
  2065: ['S-JTSK (Ferro) / Krovak (Y, X kladné)', KROVAK],
  28992: ['Amersfoort / RD New', '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs'],
  3857: ['WGS 84 / Pseudo-Mercator', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs'],
};
function epsgDef(code) {
  if (EPSG_DEFS[code]) return EPSG_DEFS[code];
  let m = String(code).match(/^(326|327|258)(\d\d)$/);
  if (m) {
    const zone = Number(m[2]), south = m[1] === '327', grs = m[1] === '258';
    return [`${grs ? 'ETRS89' : 'WGS 84'} / UTM ${zone}${south ? 'S' : 'N'}`, `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=${grs ? 'GRS80' : 'WGS84'} +units=m +no_defs`];
  }
  return null;
}
function detectEpsg(name, desc) {
  const t = `${name} ${desc}`;
  let m = t.match(/EPSG\D{0,3}(\d{4,6})/i) || String(name).trim().match(/^(\d{4,6})$/);
  if (m) return Number(m[1]);
  if (/JTSK|K[rř]ov[aá]k/i.test(t)) return /east\s*north|5514/i.test(t) ? 5514 : 5514;
  if (/amersfoort|rd\s*new/i.test(t)) return 28992;
  return null;
}

const GEO_FMT_KEY = 'ifc-nahled-geo-format';
let geoFormat = 'EN';
try { geoFormat = localStorage.getItem(GEO_FMT_KEY) || 'EN'; } catch (e) { /* ignore */ }

function jtskInRange(E, N) {
  const Y = Math.abs(E), X = Math.abs(N);
  return Y > 420000 && Y < 910000 && X > 930000 && X < 1240000;
}
function readGeoref(mid = S.modelID) {
  const api = S.api;
  const g = { ok: false, source: null, mc: null, crs: null, pu: 1, mu: null, trueNorth: null, wcsOffset: null, site: null, fix: false, checks: [] };
  // jednotky projektu
  try {
    const ua = api.GetLineIDsWithType(mid, WebIFC.IFCUNITASSIGNMENT);
    if (ua.size()) {
      const a = api.GetLine(mid, ua.get(0), true);
      const lu = (a.Units || []).find((u) => GEO_STR(u?.UnitType).toUpperCase() === 'LENGTHUNIT');
      g.pu = unitFactor(lu) ?? 1;
    }
  } catch (e) { /* default metre */ }
  // IFC4 / IFC4.3: IfcMapConversion (+ Scaled)
  const types = [WebIFC.IFCMAPCONVERSION, WebIFC.IFCMAPCONVERSIONSCALED].filter(Boolean);
  for (const T of types) {
    let ids;
    try { ids = api.GetLineIDsWithType(mid, T); } catch (e) { continue; }
    if (!ids || !ids.size()) continue;
    const mc = api.GetLine(mid, ids.get(0), true);
    const xa = GEO_NUM(mc.XAxisAbscissa), xo = GEO_NUM(mc.XAxisOrdinate);
    const sc = GEO_NUM(mc.Scale) ?? 1;
    g.mc = {
      E: GEO_NUM(mc.Eastings) ?? 0, N: GEO_NUM(mc.Northings) ?? 0, H: GEO_NUM(mc.OrthogonalHeight) ?? 0,
      xa: xa ?? 1, xo: xo ?? 0, scale: sc,
      scaleY: GEO_NUM(mc.ScaleY), scaleZ: GEO_NUM(mc.ScaleZ),
      fx: GEO_NUM(mc.FactorX), fy: GEO_NUM(mc.FactorY), fz: GEO_NUM(mc.FactorZ),
      entity: T === WebIFC.IFCMAPCONVERSIONSCALED ? 'IfcMapConversionScaled' : 'IfcMapConversion',
    };
    const c = mc.TargetCRS;
    if (c) {
      g.crs = {
        name: GEO_STR(c.Name), desc: GEO_STR(c.Description), geodetic: GEO_STR(c.GeodeticDatum), vertical: GEO_STR(c.VerticalDatum),
        projection: GEO_STR(c.MapProjection), zone: GEO_STR(c.MapZone), mapUnit: c.MapUnit ? unitFactor(c.MapUnit) : null,
      };
    }
    const ctx = mc.SourceCRS;
    if (ctx?.TrueNorth?.DirectionRatios) g.trueNorth = ctx.TrueNorth.DirectionRatios.map(GEO_NUM);
    const loc = ctx?.WorldCoordinateSystem?.Location?.Coordinates;
    if (loc) { const o = loc.map(GEO_NUM); if (o.some((v) => Math.abs(v) > 1e-6)) g.wcsOffset = o; }
    g.source = `${g.mc.entity} (${S.meta?.schema || 'IFC4'})`;
    break;
  }
  // IFC2x3: ePSet_MapConversion / ePSet_ProjectedCRS
  if (!g.mc) {
    try {
      const ids = api.GetLineIDsWithType(mid, WebIFC.IFCPROPERTYSET);
      let mcP = null, crsP = null;
      for (let i = 0; i < ids.size() && !(mcP && crsP); i++) {
        const l = api.GetLine(mid, ids.get(i), false);
        const n = GEO_STR(l.Name).toLowerCase();
        if (n === 'epset_mapconversion') mcP = api.GetLine(mid, ids.get(i), true);
        else if (n === 'epset_projectedcrs') crsP = api.GetLine(mid, ids.get(i), true);
      }
      const props = (ps) => Object.fromEntries((ps?.HasProperties || []).map((p) => [GEO_STR(p.Name), p.NominalValue]));
      if (mcP) {
        const P = props(mcP);
        g.mc = {
          E: GEO_NUM(P.Eastings) ?? 0, N: GEO_NUM(P.Northings) ?? 0, H: GEO_NUM(P.OrthogonalHeight) ?? 0,
          xa: GEO_NUM(P.XAxisAbscissa) ?? 1, xo: GEO_NUM(P.XAxisOrdinate) ?? 0, scale: GEO_NUM(P.Scale) ?? 1,
          entity: 'ePSet_MapConversion',
        };
        g.source = `ePSet_MapConversion (${S.meta?.schema || 'IFC2X3'})`;
      }
      if (crsP) {
        const P = props(crsP);
        g.crs = { name: GEO_STR(P.Name), desc: GEO_STR(P.Description), geodetic: GEO_STR(P.GeodeticDatum), vertical: GEO_STR(P.VerticalDatum),
          projection: GEO_STR(P.MapProjection), zone: GEO_STR(P.MapZone), mapUnit: null };
      }
    } catch (e) { console.warn('ePSet_MapConversion', e); }
  }
  // TrueNorth i bez MapConversion
  if (!g.trueNorth) {
    try {
      const ids = api.GetLineIDsWithType(mid, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT);
      for (let i = 0; i < ids.size(); i++) {
        const c = api.GetLine(mid, ids.get(i), true);
        if (c?.TrueNorth?.DirectionRatios) { g.trueNorth = c.TrueNorth.DirectionRatios.map(GEO_NUM); break; }
      }
    } catch (e) { /* ignore */ }
  }
  // IfcSite RefLatitude / RefLongitude
  try {
    const ids = api.GetLineIDsWithType(mid, WebIFC.IFCSITE);
    if (ids.size()) {
      const s0 = api.GetLine(mid, ids.get(0), false);
      const dms = (a) => { const v = Array.isArray(a) ? a : a?.value; return Array.isArray(v) && v.length >= 3 ? v.map(GEO_NUM) : null; };
      const toDeg = (a) => a && (a[0] + a[1] / 60 + a[2] / 3600 + (a[3] || 0) / 3.6e9);
      const la = dms(s0.RefLatitude), lo = dms(s0.RefLongitude);
      if (la && lo) g.site = { lat: toDeg(la), lon: toDeg(lo), elev: GEO_NUM(s0.RefElevation) };
    }
  } catch (e) { /* ignore */ }

  g.mu = g.crs?.mapUnit ?? g.pu;
  g.muInferred = null;
  // MapUnit nevyplněné: podle normy platí jednotky projektu, ale exportéry běžně
  // zapisují Eastings v metrech a rozdíl jednotek vyrovnají přes Scale (mm projekt → Scale 0,001).
  // Jednotku mapy proto odvodíme ze Scale: Scale = jednotka projektu / jednotka mapy.
  if (g.mc && g.crs?.mapUnit == null) {
    const sx0 = g.mc.fx ?? g.mc.scale;
    if (sx0 > 0) {
      const cand = g.pu / sx0;
      const snap = [1, 0.001, 0.01, 0.1, 0.3048, 0.0254, 1000].find((u) => Math.abs(cand / u - 1) < 0.01);
      if (snap != null && Math.abs(snap / g.pu - 1) > 1e-9) { g.mu = snap; g.muInferred = 'scale'; }
    }
  }
  g.epsg = g.crs ? detectEpsg(g.crs.name, g.crs.desc) : null;
  g.def = g.epsg ? epsgDef(g.epsg) : null;
  g.jtsk = [5514, 5513, 2065].includes(g.epsg);
  // S-JTSK: když vychází počátek mimo ČR a v metrech by seděl, jsou Eastings/Northings v metrech
  if (g.mc && g.jtsk && g.crs?.mapUnit == null && !g.muInferred && !jtskInRange(g.mc.E * g.mu, g.mc.N * g.mu) && jtskInRange(g.mc.E, g.mc.N)) {
    g.mu = 1; g.muInferred = 'range';
  }
  g.jtskPositive = g.jtsk && g.mc && (g.mc.E > 0 || g.mc.N > 0);
  if (g.def) { try { proj4.defs(`EPSG:${g.epsg}`, g.def[1]); } catch (e) { g.def = null; } }
  g.ok = !!g.mc;
  // jednotky: Scale má kompenzovat rozdíl jednotek projektu a mapy
  const sx = g.mc ? (g.mc.fx ?? g.mc.scale) : 1;
  g.unitMismatch = g.mc && Math.abs(g.pu / g.mu - 1) > 1e-9 && Math.abs(sx - g.pu / g.mu) > Math.abs(sx) * 0.01;
  return g;
}

/* lokální souřadnice IFC (m) → mapové (m, v ose CRS) */
function geoMapFromLocal(l, g = S.geo) {
  if (!g?.ok) return null;
  const m = g.mc;
  const th = Math.atan2(m.xo, m.xa);
  const c = Math.cos(th), s = Math.sin(th);
  if (g.fix) {
    // oprava: Eastings/Northings/H v metrech, lokální souřadnice převedené na metry, bez Scale
    return { E: m.E + l.x * c - l.y * s, N: m.N + l.x * s + l.y * c, H: m.H + l.z };
  }
  const pu = g.pu, mu = g.mu;
  const x = l.x / pu, y = l.y / pu, z = l.z / pu; // v jednotkách projektu
  const sx = (m.fx ?? 1) * m.scale, sy = (m.fy ?? 1) * (m.scaleY ?? m.scale), sz = (m.fz ?? 1) * (m.scaleZ ?? m.scale);
  return {
    E: (m.E + sx * (x * c - y * s)) * mu,
    N: (m.N + sy * (x * s + y * c)) * mu,
    H: (m.H + sz * z) * mu,
  };
}
function geoLocalFromScene(p) { return toIfcPoint(p); }
function geoMapFromScene(p) { return geoMapFromLocal(geoLocalFromScene(p)); }
function geoToWgs(E, N) {
  const g = S.geo;
  if (!g?.def) return null;
  try {
    const [lon, lat] = proj4(`EPSG:${g.epsg}`, 'EPSG:4326', g.jtskPositive || g.epsg === 5513 || g.epsg === 2065 ? [-E, -N] : [E, N]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) { return null; }
}
function geoFromWgs(lon, lat) {
  const g = S.geo;
  const [e, n] = proj4('EPSG:4326', `EPSG:${g.epsg}`, [lon, lat]);
  return g.jtskPositive || g.epsg === 5513 || g.epsg === 2065 ? { E: -e, N: -n } : { E: e, N: n };
}
/* sever mapy (osa N) jako směr ve scéně */
function geoNorthScene() {
  const g = S.geo;
  if (!g?.ok) return null;
  const th = Math.atan2(g.mc.xo, g.mc.xa);
  const sign = g.jtskPositive ? -1 : 1; // v Y/X (kladné) míří osa X na jih
  const d = toSceneDir(new THREE.Vector3(Math.sin(th) * sign, Math.cos(th) * sign, 0));
  d.y = 0;
  if (d.lengthSq() < 1e-9) return null;
  d.normalize();
  return { x: d.x, z: d.z };
}
/* konvergence poledníků a očekávaný TrueNorth v počátku */
function geoTrueNorthExpected() {
  const g = S.geo;
  if (!g?.ok || !g.def) return null;
  const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
  const w = geoToWgs(o.E, o.N);
  if (!w) return null;
  const q = geoFromWgs(w.lon, w.lat + 0.0005);
  let vE = q.E - o.E, vN = q.N - o.N;
  const L = Math.hypot(vE, vN); vE /= L; vN /= L;
  const th = Math.atan2(g.mc.xo, g.mc.xa);
  // R(−θ)·v → směr skutečného severu v lokálních osách
  const lx = vE * Math.cos(th) + vN * Math.sin(th), ly = -vE * Math.sin(th) + vN * Math.cos(th);
  const conv = Math.atan2(vE, vN) * 180 / Math.PI; // úhel mezi severem mapy a skutečným severem
  return { lx, ly, conv };
}
const angDeg = (x, y) => Math.atan2(y, x) * 180 / Math.PI;
const nf3s = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: true });
const nf6 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const nfAng = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const raw3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
function geoLabels() {
  const g = S.geo;
  const vert = g?.crs?.vertical || (g?.jtsk ? 'Bpv' : '');
  const H = vert ? `H (${vert})` : 'H';
  if (g?.jtsk && geoFormat === 'YX') return ['Y', 'X', H];
  return ['E', 'N', H];
}
/* hodnoty v aktuálním formátu: E/N, nebo Y/X kladné pro S-JTSK */
function geoValues(m) {
  const g = S.geo;
  if (g?.jtsk && geoFormat === 'YX') return g.jtskPositive ? [m.E, m.N, m.H] : [-m.E, -m.N, m.H];
  if (g?.jtskPositive) return [-m.E, -m.N, m.H];
  return [m.E, m.N, m.H];
}
function geoFormatScene(p, short) {
  const g = S.geo;
  if (g?.ok) {
    const [a, b, c] = geoValues(geoMapFromScene(p));
    const [la, lb] = geoLabels();
    return short ? `${la} ${nf3s.format(a)}   ${lb} ${nf3s.format(b)}` : `${la} ${nf3s.format(a)} · ${lb} ${nf3s.format(b)} · H ${nf3s.format(c)}`;
  }
  const l = geoLocalFromScene(p);
  return short ? `x ${nf3s.format(l.x)}   y ${nf3s.format(l.y)}` : `x ${nf3s.format(l.x)} · y ${nf3s.format(l.y)} · z ${nf3s.format(l.z)}`;
}

function runGeoChecks() {
  const g = S.geo, out = [];
  const add = (level, title, text) => out.push({ level, title, text });
  if (!g.ok) {
    add('warn', 'Model není georeferencovaný', 'Soubor neobsahuje IfcMapConversion ani ePSet_MapConversion. Souřadnice se zobrazují jen v lokálním systému projektu.');
    if (g.site) add('info', 'IfcSite má zeměpisnou polohu', `RefLatitude/RefLongitude: ${nf6.format(g.site.lat)}°, ${nf6.format(g.site.lon)}°. Pro přesnou georeferenci to nestačí, chybí natočení a mapové souřadnice.`);
    return out;
  }
  if (!g.crs?.name) add('warn', 'Chybí cílový souřadnicový systém', 'IfcProjectedCRS nemá vyplněný Name (např. EPSG:5514).');
  else if (!g.epsg) add('warn', 'Neznámý souřadnicový systém', `„${g.crs.name}“ neumím převést do WGS84. Mapové souřadnice se zobrazují, odkaz na mapu ne.`);
  else add('ok', `Souřadnicový systém EPSG:${g.epsg}`, g.def ? g.def[0] : '');
  // jednotky
  if (g.unitMismatch) {
    add('warn', 'Nesoulad jednotek', `Projekt je v ${unitLabel(g.pu)}, mapa v ${unitLabel(g.mu)}, ale Scale = ${nf.format(g.mc.scale)}. Správně by Scale mělo být ${nf.format(g.pu / g.mu)}. Souřadnice prvků proto můžou vycházet ${nf.format(Math.max(g.pu / g.mu, g.mu / g.pu))}× špatně. Zkuste přepínač „Opravit jednotky“.`);
  } else {
    add('ok', 'Jednotky', `Projekt ${unitLabel(g.pu)}, mapa ${unitLabel(g.mu)}, Scale ${nf.format(g.mc.scale)}.`);
  }
  if (g.muInferred === 'scale') add('info', 'MapUnit není vyplněné', `IfcProjectedCRS nemá MapUnit. Podle normy by Eastings/Northings byly v jednotkách projektu (${unitLabel(g.pu)}), ale Scale ${nf.format(g.mc.scale)} ukazuje na mapu v ${unitLabel(g.mu)}. Aplikace proto počítá s ${unitLabel(g.mu)}. Doporučení: v exportu vyplnit MapUnit.`);
  if (g.muInferred === 'range') add('warn', 'MapUnit není vyplněné', `IfcProjectedCRS nemá MapUnit a Eastings/Northings v jednotkách projektu (${unitLabel(g.pu)}) by ležely mimo ČR. Aplikace je vykládá v metrech. Doporučení: v exportu vyplnit MapUnit.`);
  if (!g.unitMismatch && Math.abs(g.mc.scale - g.pu / g.mu) > 1e-9 && Math.abs(g.mc.scale - 1) < 0.01) {
    add('info', 'Měřítko ≠ 1', `Scale ${nf.format(g.mc.scale)} pravděpodobně zahrnuje měřítkový faktor zobrazení.`);
  }
  // S-JTSK
  if (g.jtsk) {
    if (g.jtskPositive && g.epsg === 5514) add('warn', 'Kladné souřadnice v EPSG:5514', 'EPSG:5514 (East-North) má na území ČR záporné souřadnice. Kladné hodnoty odpovídají Y/X (EPSG:5513). Aplikace je vykládá jako Y/X.');
    const [Y, X] = (g.jtskPositive ? [g.mc.E, g.mc.N] : [-g.mc.E, -g.mc.N]).map((v) => v * (g.fix ? 1 : g.mu));
    if (Y < 420000 || Y > 910000 || X < 930000 || X > 1240000) add('warn', 'Počátek mimo území ČR', `Y ${nf3s.format(Y)}, X ${nf3s.format(X)} neleží v rozsahu S-JTSK pro ČR. Zkontrolujte jednotky a znaménka.`);
    else add('ok', 'Poloha v rozsahu S-JTSK', `Y ${nf3s.format(Y)}, X ${nf3s.format(X)}.`);
  }
  // WGS84 vs IfcSite
  const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
  const w = geoToWgs(o.E, o.N);
  if (w && g.site) {
    const R = 6371000, dLat = (g.site.lat - w.lat) * Math.PI / 180, dLon = (g.site.lon - w.lon) * Math.PI / 180 * Math.cos(w.lat * Math.PI / 180);
    const d = R * Math.hypot(dLat, dLon);
    if (d > 50) add('warn', 'IfcSite neodpovídá MapConversion', `RefLatitude/RefLongitude v IfcSite leží ${nf.format(Math.round(d))} m od počátku spočteného z IfcMapConversion.`);
    else add('ok', 'IfcSite odpovídá MapConversion', `Rozdíl polohy ${nf.format(Math.round(d * 10) / 10)} m.`);
  } else if (!g.site) add('info', 'IfcSite bez zeměpisné polohy', 'RefLatitude/RefLongitude nejsou vyplněné. Pro georeferenci to nevadí, rozhoduje IfcMapConversion.');
  // TrueNorth
  const ex = geoTrueNorthExpected();
  if (g.trueNorth && ex) {
    const a1 = angDeg(g.trueNorth[0], g.trueNorth[1]), a2 = angDeg(ex.lx, ex.ly);
    let d = Math.abs(((a1 - a2 + 540) % 360) - 180);
    if (d > 1) add('warn', 'TrueNorth nesouhlasí s MapConversion', `TrueNorth v kontextu míří na ${nfAng.format(a1)}°, z natočení MapConversion a konvergence poledníků (${nfAng.format(ex.conv)}°) vychází ${nfAng.format(a2)}°. Rozdíl ${nfAng.format(d)}°.`);
    else add('ok', 'TrueNorth souhlasí', `Rozdíl ${nfAng.format(d)}° (konvergence poledníků ${nfAng.format(ex.conv)}°).`);
  } else if (!g.trueNorth) add('info', 'TrueNorth není vyplněný', 'Kontext nemá TrueNorth. Pro souřadnice to nevadí.');
  if (g.wcsOffset) add('info', 'WCS kontextu není v počátku', `WorldCoordinateSystem je posunutý o (${g.wcsOffset.map((v) => nf.format(v)).join('; ')}).`);
  return out;
}

/* ---------- panel Geo ---------- */
function geoTable(title, rows) {
  const sec = el('section', 'pset');
  sec.appendChild(el('h3', 'pset-title', title));
  const dl = el('dl', 'kv');
  rows.filter(Boolean).forEach(([k, v, mono]) => { dl.append(el('dt', null, k), el('dd', v ? (mono ? 'mono' : null) : 'kv-empty', v || '—')); });
  sec.appendChild(dl);
  return sec;
}
function seg(options, value, onChange, label) {
  const w = el('div', 'seg geo-seg');
  w.setAttribute('role', 'group');
  if (label) w.setAttribute('aria-label', label);
  options.forEach(([v, t]) => {
    const b = el('button', null, t); b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.addEventListener('click', () => onChange(v));
    w.appendChild(b);
  });
  return w;
}
function mapLinks(w) {
  const wrap = el('div', 'geo-links');
  const a1 = el('a', 'sbtn', 'Mapy.cz'); a1.href = `https://mapy.cz/zakladni?x=${w.lon.toFixed(7)}&y=${w.lat.toFixed(7)}&z=19&source=coor&id=${w.lon.toFixed(7)}%2C${w.lat.toFixed(7)}`; a1.target = '_blank'; a1.rel = 'noopener';
  const a2 = el('a', 'sbtn', 'Google Maps'); a2.href = `https://www.google.com/maps?q=${w.lat.toFixed(7)},${w.lon.toFixed(7)}`; a2.target = '_blank'; a2.rel = 'noopener';
  wrap.append(a1, a2);
  return wrap;
}
function renderGeo() {
  try { renderGeoInner(); } catch (e) {
    console.error(e);
    const root = $('#panel-geo');
    if (root) root.replaceChildren(el('p', 'muted pad', `Záložku Geo se nepodařilo zobrazit: ${e.message}`));
  }
}
function renderGeoInner() {
  const root = $('#panel-geo');
  if (!root) return;
  root.replaceChildren();
  if (S.modelID == null || !S.geo) { root.appendChild(el('p', 'muted pad', 'Otevřete IFC soubor.')); return; }
  const g = S.geo;
  const head = el('div', 'summary');
  const st = el('div', 'geo-status ' + (g.ok ? 'is-ok' : 'is-none'));
  st.append(el('span', 'geo-dot'), el('span', null, g.ok ? 'Georeferencováno' : 'Bez georeference'));
  head.appendChild(st);
  head.appendChild(el('p', 'muted small geo-src', g.ok ? `Zdroj: ${g.source}` : 'Souřadnice se zobrazují v lokálním systému projektu.'));
  if (g.jtsk) {
    head.appendChild(seg([['EN', 'E/N (EPSG:5514)'], ['YX', 'Y/X kladné']], geoFormat, (v) => {
      geoFormat = v; try { localStorage.setItem(GEO_FMT_KEY, v); } catch (e) { /* ignore */ }
      renderGeo(); renderProps(); updateCoordBar();
    }, 'Formát souřadnic'));
  }
  if (g.unitMismatch) {
    head.appendChild(el('p', 'small geo-fixnote', 'Jednotky v souboru nesedí. Vyberte výklad:'));
    head.appendChild(seg([['file', 'Podle souboru'], ['fix', 'Opravit jednotky']], g.fix ? 'fix' : 'file', (v) => {
      g.fix = v === 'fix'; g.checks = runGeoChecks(); renderGeo(); renderProps(); updateCoordBar(); markPlanDirty(0);
    }, 'Výklad jednotek'));
  }
  root.appendChild(head);

  if (g.ok) {
    const o = geoMapFromLocal({ x: 0, y: 0, z: 0 });
    const [a, b, c] = geoValues(o);
    const [la, lb, lc] = geoLabels();
    const w = geoToWgs(o.E, o.N);
    const sec = geoTable('Počátek projektu (0, 0, 0)', [
      [la, nf3s.format(a), true], [lb, nf3s.format(b), true], [lc, nf3s.format(c), true],
      w && ['WGS84', `${nf6.format(w.lat)}° N, ${nf6.format(w.lon)}° E`, true],
    ]);
    if (w) sec.appendChild(mapLinks(w));
    root.appendChild(sec);
    const m = g.mc, th = Math.atan2(m.xo, m.xa) * 180 / Math.PI;
    root.appendChild(geoTable(m.entity, [
      ['Eastings', nf3s.format(m.E), true], ['Northings', nf3s.format(m.N), true], ['OrthogonalHeight', nf3s.format(m.H), true],
      ['XAxisAbscissa', String(m.xa), true], ['XAxisOrdinate', String(m.xo), true],
      ['Natočení osy x', `${nfAng.format(th)}° (od osy E proti směru hodin)`],
      ['Scale', nf.format(m.scale), true],
      m.scaleY != null && ['ScaleY', nf.format(m.scaleY), true], m.scaleZ != null && ['ScaleZ', nf.format(m.scaleZ), true],
      m.fx != null && ['FactorX / Y / Z', `${nf.format(m.fx)} / ${nf.format(m.fy ?? 1)} / ${nf.format(m.fz ?? 1)}`, true],
    ]));
    if (g.crs) {
      root.appendChild(geoTable('IfcProjectedCRS', [
        ['Name', g.crs.name], ['Description', g.crs.desc], ['GeodeticDatum', g.crs.geodetic], ['VerticalDatum', g.crs.vertical],
        g.crs.projection && ['MapProjection', g.crs.projection], g.crs.zone && ['MapZone', g.crs.zone],
        ['MapUnit', g.crs.mapUnit != null ? unitLabel(g.crs.mapUnit) : g.muInferred ? `— (nevyplněno, odvozeno: ${unitLabel(g.mu)})` : '— (platí jednotky projektu)'],
      ]));
    }
    const ex = geoTrueNorthExpected();
    root.appendChild(geoTable('Jednotky a sever', [
      ['Jednotky projektu', unitLabel(g.pu)], ['Jednotky mapy', unitLabel(g.mu)],
      ['TrueNorth (kontext)', g.trueNorth ? `${nfAng.format(angDeg(g.trueNorth[0], g.trueNorth[1]))}° (${g.trueNorth.map((v) => nf.format(v)).join('; ')})` : ''],
      ex && ['Konvergence poledníků', `${nfAng.format(ex.conv)}°`],
      ex && ['TrueNorth podle MapConversion', `${nfAng.format(angDeg(ex.lx, ex.ly))}°`],
    ]));
  }
  // kontroly
  const cs = el('section', 'pset');
  cs.appendChild(el('h3', 'pset-title', 'Kontroly'));
  const ul = el('ul', 'checks');
  g.checks.forEach((c) => {
    const li = el('li', `check is-${c.level}`);
    li.append(el('span', 'check-pill', c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'Pozor' : 'Info'));
    const t = el('div', 'check-body');
    t.append(el('strong', null, c.title));
    if (c.text) t.append(el('span', null, c.text));
    li.appendChild(t);
    ul.appendChild(li);
  });
  cs.appendChild(ul);
  root.appendChild(cs);
  // body
  root.appendChild(renderGeoPoints());
}

/* ---------- body (nástroj Souřadnice) ---------- */
function geoPointRow(pt) {
  if (S.geo?.ok) {
    const [a, b, c] = geoValues(geoMapFromScene(pt.p));
    return [a, b, c];
  }
  const l = geoLocalFromScene(pt.p);
  return [l.x, l.y, l.z];
}
function geoHeader() {
  if (S.geo?.ok) { const [a, b, c] = geoLabels(); return [a, b, c.replace(/\s.*$/, '')]; }
  return ['x', 'y', 'z'];
}
function renderGeoPoints() {
  const sec = el('section', 'pset');
  const h = el('h3', 'pset-title', `Body (${geoPts.length})`);
  sec.appendChild(h);
  if (!geoPts.length) {
    sec.appendChild(el('p', 'muted pad small', 'Zapněte nástroj Souřadnice v liště a klepejte do modelu. Body se přichytávají k rohům prvků.'));
    return sec;
  }
  const [ha, hb, hc] = geoHeader();
  const tbl = el('div', 'pts-wrap');
  const t = el('table', 'pts');
  const thead = el('tr');
  ['', ha, hb, hc, ''].forEach((x) => thead.appendChild(el('th', null, x)));
  t.appendChild(thead);
  geoPts.forEach((pt, i) => {
    const tr = el('tr');
    const [a, b, c] = geoPointRow(pt);
    tr.append(el('td', 'pt-id', pt.name), el('td', null, nf3s.format(a)), el('td', null, nf3s.format(b)), el('td', null, nf3s.format(c)));
    const td = el('td');
    const del = el('button', 'ib small-ib', null); del.type = 'button';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.setAttribute('aria-label', `Smazat bod ${pt.name}`);
    del.addEventListener('click', () => { removeGeoPoint(i); });
    td.appendChild(del);
    tr.appendChild(td);
    if (pt.el) tr.title = pt.el;
    t.appendChild(tr);
  });
  tbl.appendChild(t);
  sec.appendChild(tbl);
  const bar = el('div', 'bcf-bar pts-bar');
  const cp = el('button', 'sbtn', 'Kopírovat'); cp.type = 'button';
  cp.addEventListener('click', async () => {
    const txt = geoPts.map((pt) => [pt.name, ...geoPointRow(pt).map(raw3)].join('\t')).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Souřadnice zkopírovány (oddělené tabulátorem)'); } catch (e) { toast('Kopírování se nepovedlo.', true); }
  });
  const ex = el('button', 'sbtn', 'Export CSV'); ex.type = 'button';
  ex.addEventListener('click', exportGeoCsv);
  const clr = el('button', 'sbtn', 'Smazat body'); clr.type = 'button';
  clr.addEventListener('click', clearGeoPoints);
  bar.append(cp, ex, clr);
  sec.appendChild(bar);
  return sec;
}
async function exportGeoCsv() {
  const [ha, hb, hc] = geoHeader();
  const crs = S.geo?.ok ? (S.geo.epsg ? `EPSG:${S.geo.epsg}${S.geo.jtsk && geoFormat === 'YX' ? ' (Y/X kladne)' : ''}` : S.geo.crs?.name || '') : 'lokalni';
  const lines = [`bod,${ha},${hb},${hc},prvek,globalid,crs`];
  geoPts.forEach((pt) => {
    const q = (s) => `"${String(s || '').replace(/"/g, '""')}"`;
    lines.push([pt.name, ...geoPointRow(pt).map(raw3), q(pt.el), pt.gid || '', crs].join(','));
  });
  const base = (S.meta?.projectName || S.fileName || 'model').replace(/\.ifc$/i, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  await saveFile(`${base}-body.csv`, new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
}
function geoPointElName(id) {
  const rec = S.elements.get(id);
  if (!rec) return '';
  try { return S.api.GetLine(S.modelID, id)?.Name?.value || classLabel(rec.cls); } catch (e) { return rec.cls; }
}
function addGeoPoint(sn) {
  const { p } = sn;
  const snap = sn.kind === 'vertex' ? 'roh' : sn.kind === 'edge' ? 'hrana' : '';
  const ref = sn.object.userData.ref != null;
  const id = ref ? null : sn.object.userData.id;
  const n = (geoPts.at(-1)?.n || 0) + 1;
  const pt = { n, name: `B${n}`, p, snap, el: ref ? '' : geoPointElName(id), gid: ref ? '' : guidOf(id) };
  pt.dot = el('div', 'mdot gdot' + (sn.kind === 'vertex' ? ' snap' : sn.kind === 'edge' ? ' edge' : ''));
  pt.label = el('div', 'glabel', pt.name);
  overlay.append(pt.dot, pt.label);
  geoPts.push(pt);
  updateCoordBar(pt);
  if (!$('#panel-geo').hidden) renderGeo();
  if (plan.on) updatePlanMarker();
  requestRender();
}
function removeGeoPoint(i) {
  const pt = geoPts[i];
  pt.dot.remove(); pt.label.remove();
  geoPts.splice(i, 1);
  renderGeo(); updateCoordBar(); requestRender();
  if (plan.on) updatePlanMarker();
}
function clearGeoPoints() {
  geoPts.splice(0).forEach((pt) => { pt.dot.remove(); pt.label.remove(); });
  renderGeo(); updateCoordBar(); requestRender();
  if (plan.on) updatePlanMarker();
}
function placeGeoOverlay() {
  for (const pt of geoPts) {
    const s1 = toScreen(pt.p);
    pt.dot.hidden = !s1.ok; pt.label.hidden = !s1.ok;
    pt.dot.style.left = `${s1.x}px`; pt.dot.style.top = `${s1.y}px`;
    pt.label.style.left = `${s1.x + 10}px`; pt.label.style.top = `${s1.y - 10}px`;
  }
}
function geoPlanMarks() {
  if (!plan.view) return '';
  return geoPts.map((pt) => {
    const q = planXY(pt.p.x, pt.p.z);
    return `<circle cx="${q.x}" cy="${q.y}" r="4.5" class="pg-dot"/><text x="${q.x + 7}" y="${q.y - 6}" class="pg-txt">${pt.name}</text>`;
  }).join('');
}
function updateCoordBar(pt) {
  const bar = $('#coord-bar');
  if (!coord.on) { bar.hidden = true; return; }
  bar.hidden = false;
  const last = pt || geoPts.at(-1);
  if (!last) {
    $('#c-main').textContent = 'Klepněte do modelu';
    $('#c-sub').textContent = S.geo?.ok ? `Souřadnice v ${S.geo.epsg ? 'EPSG:' + S.geo.epsg : 'mapovém systému'}, body se přichytávají k lomovým bodům a hranám.` : 'Model není georeferencovaný, zobrazí se lokální souřadnice.';
    return;
  }
  const [a, b, c] = geoPointRow(last);
  const [la, lb, lc] = geoHeader();
  $('#c-main').textContent = `${last.name}  ${la} ${nf3s.format(a)}  ${lb} ${nf3s.format(b)}`;
  $('#c-sub').textContent = `${lc} ${nf3s.format(c)}${last.el ? ' · ' + last.el : ''}${last.snap ? ' · ' + last.snap : ''}`;
}
function toggleCoord(force) {
  coord.on = force ?? !coord.on;
  if (coord.on && S.measure.on) toggleMeasure(false);
  if (coord.on && S.selected != null) deselect();
  if (!coord.on && !S.measure.on) { snapHint.hidden = true; hoverSnap = null; requestRender(); }
  $('#btn-coord').setAttribute('aria-pressed', String(coord.on));
  updateCoordBar();
}
$('#btn-coord').addEventListener('click', () => toggleCoord());
$('#c-done').addEventListener('click', () => toggleCoord(false));
$('#c-copy').addEventListener('click', async () => {
  const last = geoPts.at(-1);
  if (!last) return;
  const txt = geoPointRow(last).map(raw3).join('\t');
  try { await navigator.clipboard.writeText(txt); toast(`${last.name} zkopírován`); } catch (e) { toast('Kopírování se nepovedlo.', true); }
});

/* ---------- kompas ve 3D ---------- */
function updateCompass() {
  const cEl = $('#compass');
  if (!cEl) return;
  if (S.modelID == null) { cEl.hidden = true; return; }
  const n = geoNorthScene() || { x: 0, z: -1 };
  const T = controls.target;
  const a = toScreen(T), b = toScreen(new THREE.Vector3(T.x + n.x * 5, T.y, T.z + n.z * 5));
  const ang = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
  cEl.hidden = false;
  $('#compass-needle').style.transform = `rotate(${ang}deg)`;
  cEl.title = S.geo?.ok ? 'Sever mapy' : 'Sever projektu (model není georeferencovaný)';
}

/* poloha vybraného prvku pro panel Vlastnosti */
function geoElementRows(rec) {
  const b = boxOf(rec.meshes);
  if (b.isEmpty()) return [];
  const c = b.getCenter(new THREE.Vector3());
  const bottom = new THREE.Vector3(c.x, b.min.y, c.z), top = new THREE.Vector3(c.x, b.max.y, c.z);
  if (S.geo?.ok) {
    const [a1, b1, h0] = geoValues(geoMapFromScene(bottom));
    const h1 = geoMapFromScene(top).H;
    const [la, lb, lc] = geoLabels();
    const w = geoToWgs(geoMapFromScene(bottom).E, geoMapFromScene(bottom).N);
    return [[`Střed ${la}`, nf3s.format(a1)], [`Střed ${lb}`, nf3s.format(b1)], [`${lc} spodní hrana`, nf3s.format(h0)], [`${lc} horní hrana`, nf3s.format(h1)],
      w ? ['WGS84', `${nf6.format(w.lat)}°, ${nf6.format(w.lon)}°`] : null].filter(Boolean);
  }
  const l0 = geoLocalFromScene(bottom), l1 = geoLocalFromScene(top);
  return [['Střed x', nf3s.format(l0.x)], ['Střed y', nf3s.format(l0.y)], ['z spodní hrana', nf3s.format(l0.z)], ['z horní hrana', nf3s.format(l1.z)]];
}
function geoOnModelLoaded() {
  try { S.geo = readGeoref(); S.geo.checks = runGeoChecks(); } catch (e) { console.warn('Georeference', e); S.geo = { ok: false, checks: [] }; }
  clearGeoPoints();
  $('#plan-orient').hidden = !S.geo.ok;
  if (!S.geo.ok) { plan.north = 'project'; $('#plan-orient').value = 'project'; }
  const warn = S.geo.checks.some((c) => c.level === 'warn') && S.geo.ok;
  $('#geo-flag').hidden = !warn;
  renderGeo();
}


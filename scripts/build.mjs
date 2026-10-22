// Sestavení app.js: části zdrojového kódu ze src/parts/ se spojí v pořadí podle čísla v názvu
// (00-…, 01-…) do jednoho modulu a ten esbuild zabalí i s knihovnami.
// Části sdílejí jeden obor platnosti (jako původní jeden soubor), proto nemají vlastní import/export.
//
// Použití:  node scripts/build.mjs [výstupní soubor]   (výchozí app.js v kořeni)
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = join(root, 'src', 'parts');
const outfile = resolve(process.argv[2] || join(root, 'app.js'));
const files = readdirSync(partsDir).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
const contents = files.map((f) => readFileSync(join(partsDir, f), 'utf8')).join('');
// otisk sestavení: stránka (meta app-build) a app.js ho musí mít stejný, jinak aplikace smaže mezipaměť a načte se znovu
const buildId = createHash('sha256').update(contents).digest('hex').slice(0, 12);
// číslo verze: APP_VERSION, jinak VERSION ze sw.js (ifc-nahled-vNN) v kořeni repozitáře
const swFile = join(root, 'sw.js');
const appVersion = process.env.APP_VERSION
  || (existsSync(swFile) && (readFileSync(swFile, 'utf8').match(/const VERSION = 'ifc-nahled-v(\d+)'/) || [])[1]) || 'dev';

const banner = '/*! IFC prohlížečka | (c) 2026 IFC prohlížečka authors | MIT. Obsahuje / includes: three.js (MIT), '
  + 'web-ifc 0.0.77 (MPL-2.0, beze změn, zdroj: https://github.com/ThatOpen/engine_web-ifc), fflate (MIT), '
  + 'proj4js + mgrs + wkt-parser (MIT), lerc (Apache-2.0). Viz THIRD_PARTY_LICENSES.md */';

await build({
  stdin: { contents, resolveDir: join(root, 'src'), sourcefile: 'main.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'safari15',
  legalComments: 'eof',
  external: ['fs', 'path'],
  banner: { js: banner },
  define: { __BUILD__: JSON.stringify(buildId), __VERSION__: JSON.stringify(appVersion) },
  outfile,
  logLevel: 'warning',
});

// wasm soubory knihoven vedle app.js
const outDir = dirname(outfile);
for (const [from, name] of [['node_modules/web-ifc/web-ifc.wasm', 'web-ifc.wasm'], ['node_modules/lerc/lerc-wasm.wasm', 'lerc-wasm.wasm']]) {
  const src = join(root, from);
  if (existsSync(src)) copyFileSync(src, join(outDir, name));
}
// otisk do index.html vedle app.js
const html = join(outDir, 'index.html');
if (existsSync(html)) {
  let s = readFileSync(html, 'utf8');
  const meta = `<meta name="app-build" content="${buildId}">`;
  s = /<meta name="app-build"[^>]*>/.test(s) ? s.replace(/<meta name="app-build"[^>]*>/, meta) : s.replace('<title>', `${meta}\n<title>`);
  writeFileSync(html, s);
}
console.log(`app.js: verze ${appVersion}, ${files.length} částí, sestavení ${buildId} → ${outfile}`);

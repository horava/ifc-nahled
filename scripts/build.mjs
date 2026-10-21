// Sestavení app.js: části zdrojového kódu ze src/parts/ se spojí v pořadí podle čísla v názvu
// (00-…, 01-…) do jednoho modulu a ten esbuild zabalí i s knihovnami.
// Části sdílejí jeden obor platnosti (jako původní jeden soubor), proto nemají vlastní import/export.
//
// Použití:  node scripts/build.mjs [výstupní soubor]   (výchozí app.js v kořeni)
import { build } from 'esbuild';
import { readdirSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = join(root, 'src', 'parts');
const outfile = resolve(process.argv[2] || join(root, 'app.js'));
const files = readdirSync(partsDir).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
const contents = files.map((f) => readFileSync(join(partsDir, f), 'utf8')).join('');

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
  outfile,
  logLevel: 'warning',
});

// wasm soubory knihoven vedle app.js
const outDir = dirname(outfile);
for (const [from, name] of [['node_modules/web-ifc/web-ifc.wasm', 'web-ifc.wasm'], ['node_modules/lerc/lerc-wasm.wasm', 'lerc-wasm.wasm']]) {
  const src = join(root, from);
  if (existsSync(src)) copyFileSync(src, join(outDir, name));
}
console.log(`app.js: ${files.length} částí → ${outfile}`);

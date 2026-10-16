# Licence použitých knihoven / Third-party licenses

IFC prohlížečka obsahuje tyto komponenty třetích stran. Každá zůstává pod svou vlastní licencí, plné texty jsou ve složce [`licenses/`](licenses/).

IFC prohlížečka includes the following third-party components. Each remains under its own license; full texts are in [`licenses/`](licenses/).

| Komponenta | Verze | Licence | Kde je v aplikaci | Zdroj |
|---|---|---|---|---|
| three.js | 0.180.0 | MIT | `app.js` | https://github.com/mrdoob/three.js |
| web-ifc | 0.0.77 | MPL-2.0 | `app.js`, `web-ifc.wasm` | https://github.com/ThatOpen/engine_web-ifc |
| fflate | 0.8.2 | MIT | `app.js` | https://github.com/101arrowz/fflate |
| proj4js | 2.19.10 | MIT | `app.js` | https://github.com/proj4js/proj4js |
| mgrs (závislost proj4js) | 1.0.0 | MIT | `app.js` | https://github.com/proj4js/mgrs |
| wkt-parser (závislost proj4js) | 1.6.0 | MIT | `app.js` | https://github.com/proj4js/wkt-parser |
| IBM Plex Sans, Sans Condensed, Mono | Fontsource 5.1.0 | SIL Open Font License 1.1 | `fonts/` | https://github.com/IBM/plex |

## web-ifc (MPL-2.0)

web-ifc je v aplikaci použitý **beze změn** (balíček `web-ifc@0.0.77` z npm), sestavený do `app.js` a `web-ifc.wasm`. Zdrojový kód této verze je veřejně dostupný:

- https://github.com/ThatOpen/engine_web-ifc
- https://www.npmjs.com/package/web-ifc/v/0.0.77

web-ifc is used **unmodified** (npm package `web-ifc@0.0.77`), bundled into `app.js` and `web-ifc.wasm`. Its source code is available at the links above, as required by MPL-2.0 section 3.2.

## Vzorový model / Sample model

`sample.ifc` je smyšlený ukázkový pavilon vygenerovaný skriptem `src/make_sample.py` (IfcOpenShell). Nepředstavuje žádnou skutečnou budovu.

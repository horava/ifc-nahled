# Architektura

Statická webová aplikace bez serveru: `index.html` (rozvržení, styly, návod), `app.js` (sestavený kód),
`web-ifc.wasm` a `lerc-wasm.wasm`, `sw.js` (offline mezipaměť). Modely se zpracují v prohlížeči
knihovnou web-ifc a kreslí přes three.js.

## Zdrojový kód (`src/parts/`)

Kód je jeden modul rozdělený do částí, které `scripts/build.mjs` spojí v pořadí podle čísla a zabalí esbuildem.
Části **sdílejí jeden obor platnosti** (funkce a konstanty jsou vidět napříč částmi), proto nemají import/export;
importy knihoven jsou jen v `00-zaklad.js`. Pořadí je důležité u konstant (`const`), které se používají při
spuštění – nová část patří tam, kde jsou definované věci, které při načtení potřebuje.

| Část | Obsah |
|---|---|
| 00-zaklad | importy, pomocné funkce, stav `S`, three.js (scéna, kamera, světla), téma, vykreslení snímku, zoom |
| 01-materialy-a-web-ifc | materiály z barev IFC, inicializace web-ifc |
| 02-velke-modely | sloučené kreslení (bloky, instance), proudové čtení geometrie, `bigSync` |
| 03-nacteni-modelu | čtení souboru po částech, `loadIfc` (geometrie, třídy, podlaží), viditelnost |
| 04-viditelnost-vyber-ovladani | výběr, ovládání dotykem / myší, otáčení kolem bodu, dvojité ťuknutí, výběr ťuknutím |
| 05-kamera-a-rez | pohledy (Celý, 3D, Shora), řezy |
| 06-mereni-a-prichytavani | přichytávání, měření s trojúhelníkem, nabídka při najetí |
| 07-lista-panel-napoveda-pruvodce | lišta nástrojů, panel Model, návod, průvodce |
| 08-vlastnosti | panel Vlastnosti |
| 09-pudorys | půdorys na rozdělené obrazovce |
| 10-georeference-souradnice-kompas | IfcMapConversion, panel Geo, nástroj Souřadnice, kompas |
| 11-strom | strom IFC, podrobnosti prvku (typ, vrstvy, otvory) |
| 12-bcf | BCF 2.1 |
| 13-panely-nacitani-soubory | přepínání panelů, načítací obrazovka, otevření souboru |
| 14-index-vlastnosti | index vlastností pro hledání, barvení a porovnání |
| 15-hledani … 19-export-excel | hledání, barvení, popisky místností, porovnání verzí, Excel |
| 20–23 data | mapové služby, terén (LERC), 3D budovy (I3S), info o místě, panel Data, citace, ostrý detail |
| 24-nedavne-modely | nedávné modely v IndexedDB |
| 25-podkladove-modely | více modelů najednou |
| 26-start | spuštění aplikace |

## Důležité zásady
- **Souřadnice:** scéna je Y nahoru a posunutá k počátku (`COORDINATE_TO_ORIGIN`); převod do IFC a do mapy přes
  `sceneFromIfcMatrix` a georeferenci. Matice koordinace web-ifc platí až po načtení geometrie.
- **Velké modely:** logické meshe prvků se nekreslí, kreslí se sloučené bloky; prvek s jiným materiálem (výběr,
  porovnání) se kreslí samostatně. Kód, který mění viditelnost nebo materiál prvků, nemusí o blocích vědět –
  `bigSync()` před každým snímkem srovná stav.
- **Načítání:** během `loadIfc` je `S.loading`; index vlastností a vazby počkají na `S.loadWait`.
- **Soukromí:** model se nikam neposílá; ze zařízení odcházejí jen požadavky na mapové služby (výřez okolí).
- **Úložiště:** klíče `ifc-nahled-*` v localStorage, IndexedDB `ifc-nahled` (BCF) a `ifc-nahled-models`
  (nedávné modely). Názvy neměnit – jinak uživatelé přijdou o uložená data.

## Vydání nové verze
1. Upravit části v `src/parts/`, spustit `npm run build` a `python3 tests/run_tests.py`.
2. Zvýšit `VERSION` v `sw.js`, doplnit `CHANGELOG.md`.
3. Nahrát soubory do repozitáře; na iPadu aplikaci dvakrát zavřít a otevřít.

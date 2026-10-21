# Testy

Automatické testy projdou aplikaci v prohlížeči Chromium bez okna (Playwright) a kontrolují hlavní funkce:
ukázku a průvodce, výběr ťuknutím, dvojité ťuknutí a otáčení, měření s přichytáváním, strom s podrobnostmi prvků,
porovnání verzí, více modelů, barvení místností a hledání, mapové služby (ArcGIS, WMS 1.1.1 i 1.3.0, terén,
3D budovy, citace zdrojů, ostrý detail) a volitelně velký model.

## Spuštění

```bash
npm install && npm run build              # sestaví app.js
pip install -r tests/requirements.txt
python3 -m playwright install chromium    # jednou; nebo použij --chrome
python3 tests/run_tests.py                # běžná sada, zhruba 3–5 minut
python3 tests/run_tests.py --big          # navíc velký model (vygeneruje ~65 MB soubor)
python3 tests/run_tests.py -k měření,strom  # jen vybrané testy
```

Testy spustí vlastní lokální server s aplikací (port 8765) a napodobeninu mapových služeb (port 8780),
takže nepotřebují internet. Na konci vypíšou souhrn a při chybě vrátí kód 1.

## Obsah

| Soubor | Co to je |
|---|---|
| `run_tests.py` | všechny testy a spouštěč |
| `mock_services.py` | napodobenina ArcGIS (MapServer, ImageServer s terénem v LERC, SceneServer I3S) a WMS 1.1.1 / 1.3.0 |
| `models/` | malé smyšlené testovací modely (ukázkový pavilon ve dvou verzích, TZB s kontrolním hranolem, stěna se skladbou, překryvy) |
| `generators/` | skripty, které vyrobí velké modely do `tests/.cache/` (`mkbig.py` 6 500 prvků, `mkhuge.py` desítky až stovky MB, `mklayers.py` stěna se skladbou) |

Všechny modely jsou smyšlené, nejde o skutečné budovy.

## Když test selže

Výpis ukáže, která kontrola neprošla a s jakou hodnotou. Testy běží v prohlížeči bez grafické karty
(SwiftShader), takže kreslení je pomalé; časování je proto nastavené s rezervou.

# IFC Náhled

Offline prohlížeč IFC modelů pro iPad a další zařízení. Běží v prohlížeči (three.js + web-ifc) a modely zpracovává přímo v zařízení, nikam je neodesílá.

**Umí:**
- 3D zobrazení s dotykovým ovládáním: jeden prst otáčí, dva prsty posouvají a zoomují, klepnutí vybere prvek
- vlastnosti prvku: atributy, GlobalId, materiál, všechny Psety a Qsety včetně vlastností typu
- filtrování podle podlaží a kategorií IFC, skrytí a izolace prvků
- vodorovný řez a půdorys podlaží
- práci offline po prvním otevření

## Zveřejnění na GitHub Pages

1. Na GitHubu vytvoř nový repozitář, například `ifc-nahled`.
   - **Public** je zdarma.
   - **Private** vyžaduje pro Pages placený účet (GitHub Pro) a **web bude i tak veřejný**. Soukromý zůstane jen kód.
2. V repozitáři zvol **Add file → Upload files** a přetáhni tam **obsah** této složky, ne složku samotnou. Soubor `index.html` musí být v kořeni repozitáře. Potvrď tlačítkem **Commit changes**.
3. Otevři **Settings → Pages**, v části *Build and deployment* nastav **Source: Deploy from a branch**, **Branch: main** a složku **/ (root)**, a dej **Save**.
4. Za minutu nebo dvě bude aplikace na adrese `https://<tvoje-jmeno>.github.io/ifc-nahled/`. Přesná adresa se objeví nahoře na stránce Settings → Pages.

> Soubor `.nojekyll` je skrytý. Když ho při nahrávání přes web nevidíš, nevadí to, aplikace funguje i bez něj.

## Instalace na iPad

1. Otevři adresu aplikace v **Safari**.
2. Počkej, až se načte ukázkový pavilon. Tím se aplikace uloží pro offline použití.
3. Klepni na **Sdílet → Přidat na plochu**.
4. Na ploše se objeví ikona **IFC Náhled**. Aplikace se otevírá přes celou obrazovku a funguje i bez internetu.

Vlastní model otevřeš oranžovým tlačítkem vpravo nahoře. Nabídne se aplikace Soubory s iCloudem, OneDrivem, SharePointem a dalšími úložišti.

## Aktualizace

Když nahraješ nové verze souborů, otevři `sw.js` a zvyš číslo verze, například `ifc-nahled-v1` na `ifc-nahled-v2`. iPad si pak při dalším spuštění s internetem stáhne novou verzi. Po aktualizaci aplikaci jednou zavři a znovu otevři.

## Sestavení ze zdrojových kódů

Je potřeba jen při úpravách kódu. Zdrojový kód je v `src/main.js`.

```bash
npm install
npm run build        # vytvoří app.js a zkopíruje web-ifc.wasm
```

`src/make_sample.py` (IfcOpenShell) vygeneruje ukázkový model `sample.ifc`:

```bash
python src/make_sample.py sample.ifc
```

## Omezení

- Velké modely (stovky MB) mohou překročit paměť Safari. Pomůže vypnout hrany nebo skrýt část podlaží.
- Soubory `.ifczip` je potřeba nejdřív rozbalit.

## Licence knihoven

- three.js: MIT
- web-ifc: MPL-2.0
- IBM Plex: SIL Open Font License

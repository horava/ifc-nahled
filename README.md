# IFC prohlížečka

Offline prohlížeč IFC modelů pro iPad a další zařízení. Běží v prohlížeči (three.js + web-ifc) a modely zpracovává přímo v zařízení, nikam je neodesílá.

**Umí:**
- 3D zobrazení s dotykovým ovládáním: jeden prst otáčí, dva prsty posouvají a zoomují (zoom míří k prstům a projde i skrz řez nebo stěnu), klepnutí vybere prvek
- půdorys na rozdělené obrazovce (vedle 3D na šířku, pod ním na výšku) s přetahovatelným předělem; posun a zoom půdorysu, poloha a směr kamery, klepnutím se přesuneš na místo ve výšce očí; výběr podlaží v půdorysu zároveň udělá ve 3D vodorovný řez tímto podlažím
- otáčení kolem vybraného prvku (přepínač Kolem prvku), dvojité klepnutí nastaví střed otáčení na bod modelu
- vlastnosti prvku: atributy, GlobalId, materiál, všechny Psety a Qsety včetně vlastností typu
- vlastnosti projektu, pozemku (RefLatitude/RefLongitude, adresa), budovy a podlaží (Elevation, výška v Bpv): klepnutím na název ve Stromu nebo na podlaží v panelu Model, u podlaží a budovy i počet a seznam místností
- výběr ťuknutím dává přednost místnosti před podlahou nebo stěnou, se kterou splývá; další ťuknutí na stejné místo vybere prvek pod ní
- strom IFC (projekt → pozemek → budova → podlaží → místnosti a prvky), filtrování podle podlaží a kategorií, skrytí a izolace prvků
- **hledání** (záložka Hledat) v názvech, číslech místností, typech, materiálech, GlobalId a hodnotách všech sad vlastností, s **filtrem podle vlastnosti** (=, ≠, obsahuje, začíná na, >, <, je/není vyplněno); výsledky jde izolovat, zvýraznit nebo skrýt
- **barvení podle vlastnosti** (panel Model) s legendou nad modelem; ťuknutím na položku legendy zůstane vidět jen ta skupina; číselné hodnoty a podlaží dostanou postupnou škálu
- **porovnání dvou verzí modelu** (Model → Porovnat se starší verzí…): přidané, změněné (geometrie, vlastnosti, atributy) a odebrané prvky podle GlobalId, odebrané jako červení „duchové“, u změněného prvku tabulka před → po, export změn do CSV
- **export místností do Excelu** (.xlsx; panel Model, nebo jen místnosti podlaží či budovy z jejich vlastností): podlaží, číslo, název, plocha (z Qto nebo z geometrie), výška, objem, souřadnice těžiště a výška podlahy v mapovém systému, GlobalId a všechny vlastnosti místností; listy se souhrnem podle podlaží a podle účelu
- **popisky místností v půdorysu** (číslo, název, plocha z Qto_SpaceBaseQuantities nebo z geometrie) a uložení půdorysu jako obrázek PNG s měřítkem, severkou a legendou
- místnosti (IfcSpace) jako průhledné objemy, zapínají se v panelu Model
- vodorovný, příčný a podélný řez, půdorys podlaží; svislé řezy se samy zarovnají na natočení budovy a jdou ručně natáčet nebo zarovnat kolmo na vybraný prvek
- měření vzdáleností s přichytáváním k rohům
- georeference podle IfcMapConversion (IFC4/4.3) nebo ePSet_MapConversion (IFC2x3): mapové souřadnice bodů a prvků, kontroly georeference, sever mapy v půdorysu, export bodů do CSV
- BCF 2.1: záznamy k prvkům (pohled, řez, vybraný prvek, snímek), komentáře, export a import `.bcfzip`
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
4. Na ploše se objeví ikona **IFC prohlížečka**. Aplikace se otevírá přes celou obrazovku a funguje i bez internetu.

Vlastní model otevřeš oranžovým tlačítkem vpravo nahoře. Nabídne se aplikace Soubory s iCloudem, OneDrivem, SharePointem a dalšími úložišti.

## Aktualizace

Když nahraješ nové verze souborů, otevři `sw.js` a zvyš číslo verze, například `ifc-nahled-v1` na `ifc-nahled-v2`. iPad si pak při dalším spuštění s internetem stáhne novou verzi. Po aktualizaci aplikaci jednou zavři a znovu otevři.

## Sestavení ze zdrojových kódů

Je potřeba jen při úpravách kódu. Zdrojový kód je v `src/main.js`.

```bash
npm install
npm run build        # vytvoří app.js a zkopíruje web-ifc.wasm
```

`src/make_sample.py` (IfcOpenShell + pyproj) vygeneruje georeferencovaný ukázkový model `sample.ifc`:

```bash
python src/make_sample.py sample.ifc
```

## BCF

Záznamy se ukládají v prohlížeči na iPadu (IndexedDB) a jsou svázané s projektem v IFC (GlobalId IfcProject), takže se po znovuotevření stejného modelu objeví znovu. Export vytvoří soubor `.bcfzip` (BCF 2.1), který na iPadu nabídne panel Sdílet (Uložit do Souborů, Mail, Teams…). Import přijímá `.bcfzip` z jiných nástrojů, například BIMcollab, Solibri nebo Trimble Connect.

Pozor: smazáním dat Safari pro tento web se smažou i neexportované záznamy. Důležité záznamy průběžně exportuj.

## Georeference (záložka Geo)

Aplikace čte `IfcMapConversion` + `IfcProjectedCRS` (IFC4, IFC4.3 včetně `IfcMapConversionScaled`) a v IFC2x3 sady `ePSet_MapConversion` a `ePSet_ProjectedCRS`. Souřadnice počítá podle vztahu

```
E = Eastings + Scale · (x·cos θ − y·sin θ)
N = Northings + Scale · (x·sin θ + y·cos θ)
H = OrthogonalHeight + Scale · z          (θ z XAxisAbscissa / XAxisOrdinate)
```

s ohledem na jednotky projektu a `MapUnit`. Výpočet probíhá v dvojnásobné přesnosti, takže souřadnice S-JTSK jsou na milimetry.

- **Nástroj Souřadnice:** klepnutím do modelu se ukládají body (B1, B2…) s přichytáváním k rohům. Body jde zkopírovat (oddělené tabulátorem) nebo exportovat do CSV.
- **Vlastnosti prvku:** poloha středu a výšky spodní a horní hrany v mapových souřadnicích.
- **Formát pro S-JTSK:** E/N podle EPSG:5514 (záporné, jako v GIS), nebo Y/X kladné (geodetická konvence).
- **Kontroly:** souřadnicový systém, nesoulad jednotek (s možností opravy), znaménka a rozsah S-JTSK, shoda s IfcSite (RefLatitude/RefLongitude) a TrueNorth s konvergencí poledníků.
- **WGS84 a mapa:** pro EPSG:5514, 5513, 2065, 28992, 3857 a UTM se počítá zeměpisná poloha (proj4js, S-JTSK přes 7prvkovou Helmertovu transformaci, přesnost zhruba 1 m) a odkaz na Mapy.cz a Google Maps.
- **Půdorys** jde natočit severem mapy nahoru a na počítači ukazuje souřadnice pod kurzorem.

## Omezení

- Velké modely (stovky MB) mohou překročit paměť Safari. Pomůže vypnout hrany nebo skrýt část podlaží.
- Soubory `.ifczip` je potřeba nejdřív rozbalit.

## Licence

Vlastní kód aplikace je pod licencí **MIT**, viz [`LICENSE`](LICENSE). Software je poskytován „tak, jak je“, bez záruky.

Použité knihovny a písma si ponechávají své licence. Přehled je v [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) a plné texty ve složce [`licenses/`](licenses/):

- three.js: MIT
- web-ifc: MPL-2.0 (použitý beze změn, zdroj: https://github.com/ThatOpen/engine_web-ifc)
- fflate: MIT
- proj4js (+ mgrs, wkt-parser): MIT
- IBM Plex: SIL Open Font License 1.1

V aplikaci jsou licence k dispozici v panelu **Model → O aplikaci a licence**.

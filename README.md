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
- **barvení místností podle vlastnosti** (panel Model): výběr nabízí jen atributy a vlastnosti místností, obarví se místnosti a ostatní prvky zprůhlední; legenda nad modelem vypíše všechny hodnoty bez seskupování, ťuknutím na položku zůstanou vidět jen místnosti s touto hodnotou; čísla a podlaží dostanou postupnou škálu
- **porovnání dvou verzí modelu** (Model → Porovnat se starší verzí…): přidané, změněné (geometrie, vlastnosti, atributy) a odebrané prvky podle GlobalId, odebrané jako červení „duchové“, u změněného prvku tabulka před → po, export změn do CSV
- **export místností do Excelu** (.xlsx; panel Model, nebo jen místnosti podlaží či budovy z jejich vlastností): podlaží, číslo, název, plocha (z Qto nebo z geometrie), výška, objem, souřadnice těžiště a výška podlahy v mapovém systému, GlobalId a všechny vlastnosti místností; listy se souhrnem podle podlaží a podle účelu
- **popisky místností v půdorysu** (číslo, název, plocha z Qto_SpaceBaseQuantities nebo z geometrie) a uložení půdorysu jako obrázek PNG s měřítkem, severkou a legendou
- místnosti (IfcSpace) jako průhledné objemy, zapínají se v panelu Model
- vodorovný, příčný a podélný řez, půdorys podlaží; svislé řezy se samy zarovnají na natočení budovy a jdou ručně natáčet nebo zarovnat kolmo na vybraný prvek
- měření vzdáleností s přichytáváním k lomovým bodům a hranám (i sousedních prvků a rohů na obrysu budovy, zakryté body se nenabízejí); s myší nebo Apple Pencil se místo přichycení ukazuje už při najetí (čtverec = lomový bod, kosočtverec = hrana) včetně náhledu měření; pravoúhlý trojúhelník se svislou a vodorovnou vzdáleností jako v ArcGIS Scene Vieweru (jde vypnout); Esc zruší rozpracované měření
- georeference podle IfcMapConversion (IFC4/4.3) nebo ePSet_MapConversion (IFC2x3): mapové souřadnice bodů a prvků, kontroly georeference, sever mapy v půdorysu, export bodů do CSV
- **mapové podklady a data** (záložka Data, jen u georeferencovaného modelu): nabídka veřejných služeb ČÚZK (ortofoto, katastrální mapa, ZTM, ZABAGED, vrstevnice, RÚIAN parcely, stavební objekty a adresní místa, terén DMR 5G a povrch DMP 1G, 3D budovy Brna LoD2, digitální technická mapa DMVS – technická a dopravní infrastruktura) nebo vlastní adresa veřejné služby WMS (1.3.0 i 1.1.1) či ArcGIS Server (MapServer, FeatureServer, ImageServer, SceneServer s 3D objekty); podklad se položí pod model ve 3D i v půdorysu, vektory mají popisky (čísla parcel); „Info o místě“ ukáže atributy po ťuknutí do modelu nebo půdorysu. Služba musí povolovat CORS. Na server se posílá jen výřez okolí modelu. Při načteném terénu (DMR 5G nebo vlastní výškový ImageServer) se mapy a vektory pokládají na terén. U 3D budov ze SceneServeru se automaticky skryjí budovy, které leží v půdorysu načtených IFC modelů (hlavního i podkladových); jde to vypnout. Pořadí vrstev jde měnit šipkami.
- BCF 2.1: záznamy k prvkům (pohled, řez, vybraný prvek, snímek), komentáře, export a import `.bcfzip`
- **nedávné modely**: otevřené IFC se ukládají v zařízení (posledních 8), příště se otevřou jedním ťuknutím i bez internetu; poslední sestavu hlavního a podkladových modelů jde obnovit jedním tlačítkem
- **více modelů najednou**: k hlavnímu modelu jde přidat podkladové (např. TZB, statika), zarovnané podle georeference (IfcMapConversion obou modelů), jinak podle souřadnic IFC; lze je skrýt, zobrazit průhledně v barvě modelu, ťuknutím zobrazit vlastnosti prvku nebo kterýkoli udělat hlavním (strom, hledání, barvení a porovnání pracují s hlavním modelem)
- **průvodce při prvním spuštění** (7 kroků, jde přeskočit a spustit znovu) a **návod** pod otazníkem v horní liště: kapitoly podle funkcí, O aplikaci (verze, soukromí) a licence
- světlý a tmavý režim: výchozí podle nastavení zařízení, tlačítkem v horní liště jde přepnout a volba se pamatuje
- práci offline po prvním otevření

## Zveřejnění s přihlášením (Cloudflare Pages + Access)

Kód zůstane v soukromém repozitáři na GitHubu. Aplikaci hostuje Cloudflare Pages a Cloudflare Access ji otevře jen povoleným e‑mailům. Obojí je zdarma. IFC modely nikam neodcházejí ani tady, aplikace je zpracovává v zařízení.

1. **Repozitář na GitHubu** s obsahem této složky (soubor `index.html` v kořeni).
2. **Cloudflare Pages:** na dash.cloudflare.com otevři **Workers & Pages → Create application → Pages → Connect to Git**. Vyber GitHub a povol přístup jen k tomuto repozitáři.
   - **Project name:** určuje adresu `https://<název>.pages.dev`.
   - **Production branch:** `main`.
   - **Framework preset:** None.
   - **Build command:** `exit 0`.
   - **Build output directory:** `/`.
   - **Environment variables:** `SKIP_DEPENDENCY_INSTALL` = `1`. Bez ní by se zbytečně instalovaly balíčky z `package.json`.
   - Dej **Save and Deploy**.
3. **Cloudflare Access:** v části **Zero Trust** zvol **Access → Applications → Add an application → Self-hosted**.
   - Jako adresy přidej `<název>.pages.dev` a `*.<název>.pages.dev`. Druhá pokryje i náhledové verze.
   - **Session duration:** 1 měsíc.
   - **Policy:** *Allow*, *Include → Emails* a povolené e‑maily.
   - **Login method:** One-time PIN, tedy kód poslaný e‑mailem.
4. **Zkouška:** otevři adresu v anonymním okně. Musí se ukázat přihlášení Cloudflare.
5. **Repozitář přepni na soukromý:** Settings → General → Change visibility → Private. Když předtím běžel na GitHub Pages, v Settings → Pages ho vypni.

Když přihlášení vyprší a je síť, aplikace při otevření ukáže přihlášení Cloudflare. Bez sítě se otevře uložená verze.

## Zveřejnění na GitHub Pages (veřejně)

1. V **public** repozitáři s obsahem této složky otevři **Settings → Pages**.
2. Nastav **Source: Deploy from a branch**, **Branch: main** a složku **/ (root)**.
3. Za chvíli bude aplikace na `https://<tvoje-jmeno>.github.io/<repozitář>/`.

## Instalace na iPad

1. Otevři adresu aplikace v **Safari**. Pokud je chráněná přihlášením, přihlas se kódem z e‑mailu.
2. Počkej, až se načte ukázkový pavilon. Tím se aplikace uloží pro offline použití.
3. Klepni na **Sdílet → Přidat na plochu**.
4. Na ploše se objeví ikona **IFC prohlížečka**. Aplikace se otevírá přes celou obrazovku a funguje i bez internetu.
5. Aplikace na ploše má vlastní přihlášení, oddělené od Safari. Při prvním spuštění se proto může přihlášení objevit ještě jednou.

Vlastní model otevřeš oranžovým tlačítkem vpravo nahoře. Nabídne se aplikace Soubory s iCloudem, OneDrivem, SharePointem a dalšími úložišti.

## Aktualizace

Nové verze souborů nahraj do repozitáře. Cloudflare Pages je sám nasadí zhruba do minuty. Číslo verze v `sw.js` musí být vyšší než minule, například `ifc-nahled-v1` → `ifc-nahled-v2`. iPad si pak při dalším spuštění s internetem stáhne novou verzi. Po aktualizaci aplikaci jednou zavři a znovu otevři.

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
- lerc: Apache-2.0 (dekodér výškových rastrů)
- IBM Plex: SIL Open Font License 1.1

V aplikaci jsou licence k dispozici v panelu **Model → O aplikaci a licence**.

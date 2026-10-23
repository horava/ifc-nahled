# Změny

Číslo verze odpovídá `VERSION` v `sw.js` (`ifc-nahled-vNN`) a zobrazuje se v návodu v kapitole O aplikaci.

## v50
- Vlastnosti: vlastnosti, které prvku úplně chybí, ale ostatní prvky stejné třídy je mají (stejná sada, stejný název),
  se ukážou oranžově jako „chybí · vyplněno u N z M“. Sada, která prvku chybí celá, se přidá se štítkem „chybí“.
  Odpovídá tomu, co barvení a hledání hlásí jako nevyplněné. Počítá se z indexu vlastností (dopočítá se na pozadí).
- Testy: 17 (nově nevyplněné a chybějící vlastnosti).

## v49
- Vlastnosti: v Atributech jsou všechny přímé atributy entity v pořadí podle schématu, i nevyplněné (—), aby šlo
  zkontrolovat, co dodavatel nevyplnil (Name, Description, ObjectType, Tag, PredefinedType, LongName…). Délky
  (např. OverallWidth) s jednotkou projektu. Totéž u podkladových modelů. Prázdné vlastnosti v sadách se ukazovaly už dřív.

## v48
- Lokální počátek (0, 0, 0) v modelu: v záložce Geo tlačítka Ukázat v modelu a Zaměřit. Ve 3D osy x / y / z se stálou
  velikostí na obrazovce a popisek s mapovými souřadnicemi počátku (E/N nebo Y/X, H), v půdorysu osy x a y.
  Počátek mimo stavbu ukáže svou vzdálenost od modelu. Volba se pamatuje.

## v47
- Číslo verze v horní liště vedle názvu (ťuknutím se otevře O aplikaci, kde je i otisk sestavení).
  Číslo se při sestavení bere z `VERSION` v `sw.js`.

## v46 – oprava po aktualizaci, telefon
- Oprava: po aktualizaci se mohla načíst nová stránka se starým app.js z offline mezipaměti a aplikace spadla
  („Cannot set properties of null“). Stránka a app.js teď nesou otisk sestavení; když nesedí, aplikace smaže
  mezipaměť a jednou se načte znovu. Každé vydání musí mít nové VERSION v sw.js.
- Telefon na výšku: výběr prvku otevře spodní panel jen jako proužek (třída a název prvku), aby zbylo místo na model;
  vytáhnout ho jde za úchyt. Tlačítko panelu v horní liště ho otevře do půlky. Výška nastavená tažením se pamatuje.

## v45 – pohodlnější ovládání
- Tlačítka Celý a 3D sloučená: Celý drží směr pohledu, druhým stiskem (nebo po pohledu shora) přejde na výchozí 3D pohled.
- Zaměřit, Skrýt, Izolovat a Vše jsou v malé liště nad nástroji a objeví se, jen když dávají smysl (výběr, skryté prvky); křížek zruší výběr.
  Jsou v jedné řadě se štítkem řezu; na úzké obrazovce jen ikony. Při rozbaleném panelu řezu se schovají a panel vodorovného řezu
  se po výběru prvku sbalí na štítek.
- Zpět (první tlačítko lišty): vrátí skrytí, izolaci, skrytí podlaží a kategorií, zapnutí řezu a skoky pohledu (Celý, Shora, Zaměřit); ⌘Z / Ctrl+Z.
- Když se lišta nevejde, Shora, režim otáčení, Hrany a Souřadnice jsou pod Více. Režim otáčení už nesvítí jako zapnutý nástroj.
- Spodní panel na telefonu a na iPadu na výšku: úchyt, tři výšky (proužek, půlka, celá), tažení i ťuknutí, stažením se zavře. Lišta a akce jsou nad panelem, 3D pohled se posune nad panel a vybraný prvek se neschová pod něj.
- Hlášky menší a dole nad lištou; nápověda k opakovanému ťuknutí jen prvních pár použití.
- Na malé obrazovce z odznaku ukázky jen štítek; úspornější lišty na telefonu naležato.
- Oprava: přepnutí záložky panelu nebo zvýraznění ve stromu mohlo na telefonu posunout celou stránku.
- Testy: 15 (nově lišta a Zpět, spodní panel na telefonu); od v48 16 (lokální počátek).

## v44 – údržba
- Zdrojový kód rozdělený na 27 tematických částí v `src/parts/` (sestavení dává stejný `app.js`).
- Automatické testy v `tests/` (13 testů, napodobenina mapových služeb, testovací modely a generátory).
- Oprava: během načítání modelu se mohl začít stavět index vlastností z rozpracovaného modelu
  (barvení pak nenabízelo vlastnosti místností a porovnání hlásilo změny navíc). Index i vazby teď počkají na konec načítání.
- Přichytávání při měření spolehlivěji chytá rohy na obrysu modelu (dva kroužky paprsků kolem kurzoru).
- Dvojité ťuknutí toleruje pomalejší druhé ťuknutí (400 ms místo 320 ms).
- CHANGELOG, poznámky k architektuře a seznam nápadů do budoucna (`docs/`).

## v43
- Strom: prvek se rozbalí na typ, vrstvy materiálu s tloušťkou, otvory s výplní a prostupy; ve Vlastnostech tabulka Skladba materiálu; vlastnosti typu ze stromu.

## v42
- Otáčení kolem bodu pod prstem / kurzorem (výchozí), přepínač režimů Pod prstem – Kolem prvku – Kolem středu.

## v41
- Dvojité ťuknutí už v Safari nezvětšuje celou stránku.

## v40
- Ostré mapové podklady: po přiblížení se dočte výřez v rozlišení displeje (3D i půdorys), volba Popisky WMS map: Ostré / Větší písmo.

## v39
- Velké modely: čtení souboru po částech a jeho uvolnění po zpracování, průběh načítání, sloučené kreslení po podlažích a materiálech, instance opakovaných tvarů, u souborů nad 60 MB stínování po ploškách.
- Citace zdrojů mapových dat ve 3D, v záložce Data a v PNG půdorysu (ČÚZK, rok; DMVS; statutární město Brno; údaje z popisu vlastních služeb).

## v38
- Průvodce při prvním spuštění a návod pod otazníkem (kapitoly, O aplikaci, licence).

## v37
- Service worker: otevření aplikace bere čerstvou stránku a předá přesměrování na přihlášení (příprava na hosting s přihlášením); uložené kopie bez příznaku přesměrování (Safari).

## v36
- Měření: přichytávání k lomovým bodům a hranám i sousedních prvků, nabídka místa při najetí myší / Apple Pencil, náhled měření, pravoúhlý trojúhelník (svislá a vodorovná vzdálenost), Esc.

## v35
- Přepínač světlého a tmavého režimu v horní liště (výchozí podle zařízení).

## v34
- Barvy IFC v sRGB (dřív vybledlé).

## v33
- 3D budovy ze SceneServeru se skryjí v půdorysu načtených IFC modelů.

## do v32
- 3D prohlížení s dotykovým ovládáním, výběr ťuknutím s předností místností a procházením prvků pod prstem.
- Strom, vlastnosti (Psety, Qsety, typ, materiál), podlaží a kategorie, skrytí a izolace.
- Řezy (vodorovný, příčný, podélný), půdorys na rozdělené obrazovce s popisky místností a exportem PNG.
- Georeference (IfcMapConversion, ePSet_MapConversion), kontroly, odvození jednotky mapy, souřadnice bodů, CSV.
- Hledání a filtr podle vlastností, barvení místností s legendou, porovnání verzí, export místností do Excelu.
- BCF 2.1, nedávné modely v zařízení, více modelů najednou (zarovnání podle georeference).
- Záložka Data: ČÚZK, DMVS (WMS 1.3.0), RÚIAN, terén DMR 5G a DMP 1G (LERC) s pokládáním map na terén, 3D budovy Brna (I3S), informace o místě, pořadí vrstev.
- Offline režim (service worker), licence knihoven.

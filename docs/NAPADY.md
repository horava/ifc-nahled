# Nápady do šuplíku

Probrané a odložené rozšíření. U každého stručně, jak by se dělalo a na co si dát pozor.

## Kontrola podle IDS
- Záložka Kontrola (objeví se po spuštění), soubor `.ids` ze Souborů, uložení v zařízení.
- Výsledky: vyhovuje / nevyhovuje / netýká se po specifikacích, obarvení ve 3D, seznam chyb s důvodem,
  sekce IDS ve Vlastnostech, export do Excelu a do BCF.
- IDS 1.0: entita (+ PredefinedType), atribut, vlastnost, klasifikace, materiál, partOf; výčet, regulární výraz,
  rozsah, délka; povinné / volitelné / zakázané.
- Úskalí: regulární výrazy XSD vs. JavaScript, jednotky (IDS v SI, model v mm), rozdíly IFC2x3 / IFC4.
  Ověřit na oficiální testovací sadě buildingSMART.
- Návaznost: export IDS z evidence datových standardů (BIM DS).

## Transformace souřadnic za běhu
- WMS v jiném systému: obrázek natažený na síť s body přepočtenými přes proj4.
- Vektory a scény v jiném systému: přepočet vrcholů při načtení.
- Podkladové IFC v jiném systému: lokální afinní transformace z několika přepočtených bodů.
- Úskalí: S-JTSK ↔ ETRS89 dnes ~1 m (Helmert); pro přesnost opravná mřížka ČÚZK nebo vlícovací body.
  Výšky Bpv vs. elipsoid (~45 m) – kvazigeoid CR-2005 nebo ruční posun.

## Google fotorealistické 3D dlaždice
- 3DTilesRendererJS (Apache-2.0) nad three.js, klíč Google Map Tiles API (zadaný v aplikaci, omezený na adresu)
  nebo Cesium ion.
- Podmínky: logo a zdroje Google, žádné ukládání offline, nekombinovat s mapami jiných poskytovatelů
  (přepínat buď Google, nebo ČÚZK), vlastní IFC model přes dlaždice je povolený.
- Úskalí: výška (~45 m rozdíl), přesnost polohy ~1 m, budovu nejde skrýt jako objekt (jen vyříznout).

## Modely přímo z Dalux Boxu
- Dalux Build API (Box: oblasti, složky, soubory, verze), klíč `X-API-KEY` z firemního profilu, firemní licence,
  aktivuje Dalux. Klíč jen pro čtení a jen na potřebné projekty.
- Bez serveru by klíč musel být v zařízení; čistší je malý proxy server. Ověřit CORS u Daluxu.
- Dnes: sdílet soubor z aplikace Dalux do Souborů a otevřít v prohlížečce.

## Spojení modelů (IFC merge)
- Do prohlížečky nepatří (zápis platného IFC, slučování struktury, jednotek a kontextů, IFC2x3 vs. IFC4, paměť).
- Doporučení: desktopový nástroj nad IfcOpenShell (`ifcpatch` recept MergeProjects), např. ArcGIS `.pyt`.

## Hosting s přihlášením
- GitLab Pages (i zdarma s řízením přístupu „Only project members“, GitLab.com nebo FI MUNI) – potřeba `.gitlab-ci.yml`.
- Cloudflare Pages + Access (zdarma do 50 uživatelů).
- Service worker je připravený (v37). Nová adresa = nová data v prohlížeči (nedávné modely, vrstvy).

## Drobnosti
- Tlačítko Celý: zarovnat jen na právě viditelné prvky (izolace, jedno podlaží).
- Přejmenování aplikace (návrhy: Ifko, Stavoskop, Skrz).

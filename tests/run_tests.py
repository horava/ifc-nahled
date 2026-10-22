#!/usr/bin/env python3
"""Automatické testy IFC prohlížečky.

Spustí aplikaci z kořene repozitáře na lokálním serveru, napodobeninu mapových služeb a prohlížeč
Chromium (Playwright, bez okna) a projde hlavní funkce. Na konci vypíše souhrn a vrátí kód 1, když
něco selže.

    python3 tests/run_tests.py                 # běžná sada (~3–5 min)
    python3 tests/run_tests.py --big           # navíc velký model (vygeneruje se, ~65 MB)
    python3 tests/run_tests.py -k mereni       # jen testy, jejichž název obsahuje „mereni“
    python3 tests/run_tests.py --chrome /cesta/k/chrome

Před spuštěním je potřeba sestavit aplikaci (npm run build) a nainstalovat závislosti
z tests/requirements.txt (a jednou `python3 -m playwright install chromium`, pokud nepoužíváš --chrome).
"""
import argparse, functools, http.server, json, os, subprocess, sys, threading, time, traceback, urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / 'tests'
MODELS = TESTS / 'models'
CACHE = TESTS / '.cache'
APP_PORT, MOCK_PORT = 8765, 8780
APP = f'http://localhost:{APP_PORT}/index.html'
MOCK = f'http://localhost:{MOCK_PORT}'
TOUR_DONE = "try{localStorage.setItem('ifc-nahled-tour','done')}catch(e){}"
READY = '()=>window.__ifc && document.getElementById("loading").hidden && window.__ifc.elements && window.__ifc.elements.size>0'

TESTS_LIST = []


def test(name, big=False):
    def deco(fn):
        TESTS_LIST.append((name, fn, big))
        return fn
    return deco


class Fail(AssertionError):
    pass


def check(cond, msg):
    if not cond:
        raise Fail(msg)


# ---------- servery ----------
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def start_servers():
    app = http.server.ThreadingHTTPServer(('127.0.0.1', APP_PORT), QuietHandler)
    threading.Thread(target=app.serve_forever, daemon=True).start()
    sys.path.insert(0, str(TESTS))
    import mock_services  # noqa: E402
    threading.Thread(target=mock_services.serve, args=(MOCK_PORT,), daemon=True).start()
    time.sleep(0.5)
    return app


# ---------- prohlížeč ----------
class Ctx:
    def __init__(self, browser):
        self.browser = browser

    def page(self, device=None, tour_done=True, scale=None, viewport=(1366, 1024), touch=False, extra_init=''):
        opts = dict(device) if device else {'viewport': {'width': viewport[0], 'height': viewport[1]}}
        if scale:
            opts['device_scale_factor'] = scale
        if touch and not device:
            opts['has_touch'] = True
        ctx = self.browser.new_context(**opts)
        if tour_done or extra_init:
            ctx.add_init_script((TOUR_DONE if tour_done else '') + extra_init)
        pg = ctx.new_page()
        pg.errors = []
        pg.on('pageerror', lambda e: pg.errors.append('PAGE ' + str(e)))
        pg.on('console', lambda m: pg.errors.append(m.text[:200]) if m.type == 'error' and 'GL Driver' not in m.text
              and 'cuzk' not in m.text and 'ERR_TUNNEL' not in m.text and '404' not in m.text else None)
        return pg

    def app(self, **kw):
        pg = self.page(**kw)
        pg.goto(APP)
        pg.wait_for_function(READY, timeout=90000)
        return pg


def open_model(pg, path, wait_idx=False, timeout=300000):
    name = Path(path).name
    pg.set_input_files('#file-input', str(path))
    pg.wait_for_function(f'()=>document.getElementById("loading").hidden && window.__ifc.fileName=={json.dumps(name)}', timeout=timeout)
    if wait_idx:
        pg.wait_for_function('()=>window.__ifc.idx && window.__ifc.idx.ready', timeout=timeout)
    pg.wait_for_timeout(400)


def canvas_box(pg):
    return pg.locator('#viewport canvas').bounding_box()


def no_errors(pg):
    check(not pg.errors, f'chyby na stránce: {pg.errors[:3]}')


def mock_requests():
    return json.loads(urllib.request.urlopen(f'{MOCK}/debugreq2').read())


def generate(script, out, *args):
    out = CACHE / out
    if not out.exists():
        CACHE.mkdir(exist_ok=True)
        subprocess.run([sys.executable, str(TESTS / 'generators' / script), str(out), *map(str, args)], check=True)
    return out


DRAW = """()=>{const V=window.__ifcView;V.renderer.info.autoReset=false;V.renderer.info.reset();V.renderFrame();
  const i=V.renderer.info.render;const r=[i.calls,i.triangles];V.renderer.info.autoReset=true;return r}"""


# =====================================================================
#   TESTY
# =====================================================================
@test('start: ukázka, průvodce, návod, režim')
def t_start(C):
    pg = C.app(tour_done=False)
    check(pg.evaluate('()=>window.__ifc.elements.size') == 29, 'ukázkový pavilon má mít 29 prvků')
    pg.wait_for_selector('#tour:not([hidden])', timeout=5000)
    for _ in range(7):
        pg.click('#tour-next')
        pg.wait_for_timeout(150)
    check(pg.evaluate('()=>document.getElementById("tour").hidden'), 'průvodce se má po 7 krocích zavřít')
    check(pg.evaluate("()=>localStorage.getItem('ifc-nahled-tour')") == 'done', 'průvodce si má pamatovat dokončení')
    pg.reload(); pg.wait_for_function(READY, timeout=60000); pg.wait_for_timeout(800)
    check(pg.evaluate('()=>document.getElementById("tour").hidden'), 'průvodce se nemá spustit znovu')
    pg.click('#btn-help'); pg.wait_for_timeout(200)
    check(pg.locator('#help-nav button').count() >= 16, 'návod má mít kapitoly')
    pg.click('#help-nav button[data-sec="licenses"]'); pg.click('.lic >> nth=1'); pg.wait_for_timeout(500)
    check('Mozilla Public License' in pg.inner_text('#lic-text'), 'text licence web-ifc se má načíst')
    pg.keyboard.press('Escape')
    sys_dark = pg.evaluate("()=>matchMedia('(prefers-color-scheme: dark)').matches")
    pg.click('#btn-theme'); pg.wait_for_timeout(200)
    check(pg.evaluate("()=>document.documentElement.getAttribute('data-theme')") == ('light' if sys_dark else 'dark'), 'přepnutí režimu')
    pg.click('#btn-theme'); pg.wait_for_timeout(200)
    check(pg.evaluate("()=>document.documentElement.getAttribute('data-theme')") is None, 'návrat k režimu zařízení')
    no_errors(pg)


@test('výběr ťuknutím: místnosti a procházení pod prstem')
def t_pick(C):
    pg = C.app(device=C.pw.devices['iPad Pro 11 landscape'])
    pg.tap('.space-toggle'); pg.wait_for_timeout(300)
    pg.tap('button:has-text("Řez")'); pg.wait_for_timeout(300)
    pg.tap('#clip-chips .chip:has-text("1.NP")'); pg.wait_for_timeout(900)
    box = canvas_box(pg)
    sel = "()=>{const S=window.__ifc;const r=S.elements.get(S.selected);return r?r.cls:null}"
    counts = {}
    for i in range(7):
        for j in range(5):
            pg.touchscreen.tap(box['x'] + box['width'] * (0.3 + 0.4 * i / 6), box['y'] + box['height'] * (0.35 + 0.3 * j / 4))
            pg.wait_for_timeout(450)
            c = pg.evaluate(sel); counts[c] = counts.get(c, 0) + 1
            if c:
                pg.touchscreen.tap(box['x'] + box['width'] * 0.02, box['y'] + box['height'] * 0.04); pg.wait_for_timeout(450)
    check(counts.get('IfcSpace', 0) >= 10, f'ťuknutí v půdorysu mají vybírat místnosti: {counts}')
    seq = []
    for _ in range(3):
        pg.touchscreen.tap(box['x'] + box['width'] * 0.47, box['y'] + box['height'] * 0.5); pg.wait_for_timeout(450)
        seq.append(pg.evaluate(sel))
    check(seq[0] == 'IfcSpace' and seq[1] not in (None, 'IfcSpace'), f'opakované ťuknutí má vybrat prvek pod místností: {seq}')
    no_errors(pg)


@test('dvojité ťuknutí a otáčení kolem bodu pod prstem')
def t_double_tap_pivot(C):
    pg = C.app(device=C.pw.devices['iPad Pro 11 landscape'])
    box = canvas_box(pg)
    x, y = box['x'] + box['width'] * 0.45, box['y'] + box['height'] * 0.55
    cam0 = pg.evaluate('()=>window.__ifcView.camera.position.toArray()')
    # dvojité ťuknutí: Playwright mezi ťuknutími dotykem čeká na vykreslení (bez GPU pomalé), dvojklik je rychlý
    pg.mouse.dblclick(x, y)
    pg.wait_for_timeout(1200)
    r = pg.evaluate('()=>[visualViewport.scale, window.__ifc.selected, window.__ifcView.camera.position.toArray()]')
    check(r[0] == 1 and r[1] and r[2] != cam0, f'dvojité ťuknutí: bez zvětšení stránky, výběr a posun pohledu {r}')
    pg2 = C.app()
    check(pg2.eval_on_selector('#btn-orbit', 'e=>e.dataset.mode') == 'point', 'výchozí režim otáčení je bod pod kurzorem')
    b = canvas_box(pg2)
    x, y = b['x'] + b['width'] * 0.3, b['y'] + b['height'] * 0.62
    P = pg2.evaluate('([x,y])=>window.__ifcView.currentPivot(x,y).toArray()', [x, y])
    scr = "(p)=>{const V=window.__ifcView;const s=V.toScreen(new (V.camera.position.constructor)(...p));const r=V.renderer.domElement.getBoundingClientRect();return [Math.round(r.left+s.x),Math.round(r.top+s.y)]}"
    before = pg2.evaluate(scr, P)
    pg2.mouse.move(x, y); pg2.mouse.down()
    for i in range(10):
        pg2.mouse.move(x + i * 15, y + i * 4); pg2.wait_for_timeout(20)
    pg2.mouse.up(); pg2.wait_for_timeout(300)
    after = pg2.evaluate(scr, P)
    check(abs(before[0] - after[0]) <= 2 and abs(before[1] - after[1]) <= 2, f'bod pod kurzorem má zůstat na místě: {before} -> {after}')
    no_errors(pg); no_errors(pg2)


@test('měření: přichycení k lomovým bodům a pravoúhlý trojúhelník')
def t_measure(C):
    pg = C.app(touch=True)
    pg.click('#btn-measure'); pg.wait_for_timeout(200)
    grid = pg.evaluate("""()=>{const V=window.__ifcView;const out=[];for(let x=100;x<900;x+=9)for(let y=200;y<760;y+=9){
      const s=V.findSnap(x,y,'mouse');if(s&&s.kind==='vertex')out.push({x,y,py:s.p.y})}return out}""")
    check(len(grid) > 20, 'v modelu se mají najít lomové body')
    low, high = min(grid, key=lambda g: g['py']), max(grid, key=lambda g: g['py'])
    pg.mouse.move(high['x'] + 3, high['y'] + 3); pg.wait_for_timeout(200)
    check(pg.eval_on_selector('.snaphint', 'e=>[e.className,e.hidden]') == ['snaphint vertex', False], 'nabídka přichycení při najetí')
    pg.mouse.click(high['x'] + 3, high['y'] + 3); pg.wait_for_timeout(150)
    pg.mouse.click(low['x'] - 3, low['y'] + 3); pg.wait_for_timeout(200)
    labels = pg.eval_on_selector_all('.mlabel', 'e=>e.map(x=>[x.className,x.textContent,x.hidden])')
    check(len([l for l in labels if not l[2]]) == 3, f'přímá, svislá a vodorovná vzdálenost: {labels}')
    pg.click('#m-tri'); pg.wait_for_timeout(200)
    check(len([1 for l in pg.eval_on_selector_all('.mlabel', 'e=>e.map(x=>x.hidden)') if not l]) == 1, 'vypnutý trojúhelník skryje odvěsny')
    pg.click('#m-tri')
    pg.click('#m-done'); pg.click('#btn-coord'); pg.wait_for_timeout(200)
    pg.mouse.click(high['x'] + 3, high['y'] + 3); pg.wait_for_timeout(300)
    check('roh' in pg.inner_text('#coord-bar'), 'souřadnice: bod přichycený k rohu')
    no_errors(pg)


@test('strom: typ, vrstvy materiálu, otvory s výplní')
def t_tree_details(C):
    pg = C.app()
    open_model(pg, MODELS / 'layers.ifc')
    pg.click('.tab[data-tab="tree"]'); pg.wait_for_timeout(800)
    pg.locator('#panel-tree .tnode', has_text='1.NP').first.locator('.twist').click(); pg.wait_for_timeout(300)
    for name in ['Stěna 1', 'Stěna 2']:
        pg.locator('#panel-tree .tnode', has_text=name).first.locator('.twist').click(); pg.wait_for_timeout(300)
    rows = pg.eval_on_selector_all('#panel-tree .tdetail', 'e=>e.map(x=>x.innerText.replace(/\\n/g," | "))')
    check(any('Cihly plné - nosné · 300 mm' in r for r in rows), f'vrstva s tloušťkou: {rows}')
    check(any('BJA03N02D004 → Dveře D04' in r for r in rows), 'otvor s výplní')
    check(any('Prostup P12' in r for r in rows), 'prostup bez výplně')
    pg.locator('#panel-tree .tdetail', has_text='→').first.locator('.tlabel').click(); pg.wait_for_timeout(400)
    check(pg.evaluate("()=>{const S=window.__ifc;return S.api.GetLine(S.modelID,S.selected).Name.value}") == 'Dveře D04', 'ťuknutí na otvor vybere dveře')
    pg.click('.tab[data-tab="tree"]'); pg.wait_for_timeout(200)
    pg.locator('#panel-tree .tdetail', has_text='Typ').first.locator('.tlabel').click(); pg.wait_for_timeout(800)
    check('REI 90' in pg.inner_text('#panel-props'), 'vlastnosti typu (Pset_WallCommon)')
    no_errors(pg)


@test('porovnání dvou verzí')
def t_compare(C):
    pg = C.app()
    open_model(pg, MODELS / 'v2.ifc', wait_idx=True)
    pg.set_input_files('#cmp-input', str(MODELS / 'v1.ifc'))
    pg.wait_for_function('()=>window.__ifc.cmp', timeout=60000); pg.wait_for_timeout(800)
    c = pg.evaluate('()=>window.__ifc.cmp.counts')
    check(c.get('added') == 1 and c.get('changed') == 3 and c.get('removed') == 1, f'+1 ~3 −1: {c}')
    with pg.expect_download() as dl:
        pg.click('#panel-cmp button:has-text("Export CSV")')
    text = Path(dl.value.path()).read_text(encoding='utf-8-sig')
    check('Odebráno' in text and 'Okno O1' in text, 'export změn do CSV')
    no_errors(pg)


@test('více modelů: zarovnání podle georeference')
def t_federation(C):
    pg = C.app()
    open_model(pg, MODELS / 'v1.ifc')
    pg.click('.tab[data-tab="model"]'); pg.wait_for_timeout(200)
    pg.set_input_files('#ref-input', str(MODELS / 'tzb.ifc'))
    pg.wait_for_function('()=>window.__ifc.refs.length==1', timeout=60000); pg.wait_for_timeout(500)
    r = pg.evaluate("""()=>{const S=window.__ifc; const Box=S.bbox.constructor;
      const mainCol=[...S.elements].find(([id,r])=>S.api.GetLine(S.modelID,id).Name?.value==='Sloup S1 – 1.NP');
      const bm=new Box(); mainCol[1].meshes.forEach(m=>{m.geometry.computeBoundingBox(); bm.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld))});
      const R=S.refs[0]; R.group.updateMatrixWorld(true);
      const hid=[...R.ids].find(id=>S.api.GetLine(R.mid,id).Name?.value==='Kontrolní hranol');
      const br=new Box(); R.meshes.filter(m=>m.userData.id===hid).forEach(m=>{m.geometry.computeBoundingBox(); br.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld))});
      return {align:R.align, dist:bm.getCenter(bm.min.clone()).distanceTo(br.getCenter(br.min.clone()))}}""")
    check(r['align'] == 'geo' and r['dist'] < 1e-4, f'kontrolní hranol sedí na sloupu: {r}')
    no_errors(pg)


@test('barvení místností a hledání (generovaný model 2 200 místností)')
def t_coloring(C):
    big = generate('mkbig.py', 'bigA.ifc', 10)
    pg = C.app()
    open_model(pg, big, wait_idx=True)
    pg.click('.tab[data-tab="model"]'); pg.wait_for_timeout(300)
    try:
        pg.wait_for_function('()=>{const s=document.querySelector("#panel-model select.color-key");return s&&s.options.length>3}', timeout=60000)
    except Exception:
        raise Fail('výběr barvení se nenaplnil: ' + json.dumps(pg.evaluate('()=>[window.__ifc.fileName, !!(window.__ifc.idx&&window.__ifc.idx.ready), document.querySelector("#panel-model").innerText.slice(250,700), document.querySelector("#panel-model").hidden]'), ensure_ascii=False))
    opts = pg.eval_on_selector('#panel-model select.color-key', 'e=>[...e.options].map(o=>o.value)')
    key = next(o for o in opts if o.endswith('Ucel'))
    pg.select_option('#panel-model select.color-key', key); pg.wait_for_timeout(1500)
    items = pg.eval_on_selector_all('#lg-list .lg-item', 'e=>e.length')
    check(items == 11, f'legenda má vypsat všech 11 účelů: {items}')
    pg.click('#lg-list .lg-item >> nth=0'); pg.wait_for_timeout(800)
    iso = pg.evaluate('()=>window.__ifc.isolated && window.__ifc.isolated.size')
    check(iso and iso > 100, f'ťuknutí na položku legendy izoluje místnosti: {iso}')
    pg.click('#lg-close'); pg.wait_for_timeout(300)
    pg.click('.tab[data-tab="search"]'); pg.fill('#search-q', 'Kancelář'); pg.press('#search-q', 'Enter'); pg.wait_for_timeout(1500)
    check('prvk' in pg.inner_text('#panel-search'), 'hledání najde místnosti')
    no_errors(pg)


@test('data: ArcGIS mapa a vektory, WMS, citace zdrojů, PNG půdorysu')
def t_data(C):
    pg = C.app(extra_init="localStorage.removeItem('ifc-nahled-data-layers');")
    pg.click('.tab[data-tab="data"]'); pg.wait_for_timeout(300)

    def add(url, nth):
        pg.fill('#data-url', url); pg.click('.dl-url button:has-text("Načíst")'); pg.wait_for_timeout(900)
        pg.click(f'.dl-found .dl-cat >> nth={nth}'); pg.wait_for_timeout(2500)
    add(f'{MOCK}/arcgis/rest/services/TEST/MapServer', 0)
    add(f'{MOCK}/arcgis/rest/services/TEST/MapServer', 1)
    add(f'{MOCK}/wms', 0)
    layers = pg.evaluate('()=>window.__ifc.data.layers.map(l=>[l.name,l.state,l.features?l.features.length:null])')
    check(all(l[1] == 'ok' for l in layers) and len(layers) == 3, f'tři vrstvy načtené: {layers}')
    check(any(l[2] == 144 for l in layers), 'vektory parcel')
    pg.click('#btn-top'); pg.wait_for_timeout(1500)
    attr = pg.evaluate('()=>[document.getElementById("data-attr").textContent, window.__xss]')
    check('Testovací úřad' in attr[0] and 'Mřížkový institut' in attr[0] and attr[1] is None, f'citace zdrojů bez spuštění HTML z popisu služby: {attr}')
    pg.click('#btn-plan'); pg.wait_for_timeout(1200)
    with pg.expect_download() as dl:
        pg.click('#plan-save')
    check(Path(dl.value.path()).stat().st_size > 20000, 'PNG půdorysu')
    no_errors(pg)


@test('data: WMS 1.3.0 s informací o místě')
def t_wms13(C):
    pg = C.app(extra_init="localStorage.removeItem('ifc-nahled-data-layers');")
    pg.click('.tab[data-tab="data"]'); pg.wait_for_timeout(300)
    pg.fill('#data-url', f'{MOCK}/x/wms13?service=WMS'); pg.click('.dl-url button:has-text("Načíst")'); pg.wait_for_timeout(1000)
    pg.click('.dl-found .dl-cat >> nth=0'); pg.wait_for_timeout(2000)
    L = pg.evaluate('()=>window.__ifc.data.layers.map(l=>[l.state,l.src.version,l.src.infoFormat])')
    check(L == [['ok', '1.3.0', 'application/json']], f'WMS 1.3.0: {L}')
    pg.click('.dl-info-row button'); pg.wait_for_timeout(300)
    pg.click('#btn-top'); pg.wait_for_timeout(1200)
    b = canvas_box(pg)
    pg.mouse.click(b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.5); pg.wait_for_timeout(1500)
    check('vodovod' in json.dumps(pg.evaluate('()=>window.__ifc.data.infoRes'), ensure_ascii=False), 'GetFeatureInfo (JSON)')
    no_errors(pg)


@test('data: terén, 3D budovy a skrytí budov pod IFC')
def t_terrain_scene(C):
    pg = C.app(extra_init="localStorage.removeItem('ifc-nahled-data-layers');")
    pg.click('.tab[data-tab="data"]'); pg.wait_for_timeout(300)
    for url in [f'{MOCK}/arcgis/rest/services/DEM/ImageServer', f'{MOCK}/arcgis/rest/services/B/SceneServer']:
        pg.fill('#data-url', url); pg.click('.dl-url button:has-text("Načíst")'); pg.wait_for_timeout(900)
        pg.click('.dl-found .dl-cat >> nth=0'); pg.wait_for_timeout(2500)
    L = pg.evaluate('()=>window.__ifc.data.layers.map(l=>[l.src.type,l.state,l.hiddenCount])')
    check([l[1] for l in L] == ['ok', 'ok'], f'terén a scéna: {L}')
    hid = [l[2] for l in L if l[0] == 'i3s'][0]
    check(hid == 1, f'budova pod pavilonem se skryje: {hid}')
    pg.click('.dl-hide'); pg.wait_for_timeout(800)
    check(pg.evaluate('()=>window.__ifc.data.layers.find(l=>l.src.type=="i3s").hiddenCount') == 0, 'po vypnutí se zobrazí')
    no_errors(pg)


@test('data: ostrý detail mapy po přiblížení')
def t_sharp(C):
    pg = C.app(scale=2, extra_init="localStorage.removeItem('ifc-nahled-data-layers');localStorage.removeItem('ifc-nahled-data-sharp');")
    pg.click('.tab[data-tab="data"]'); pg.wait_for_timeout(300)
    pg.fill('#data-url', f'{MOCK}/wms'); pg.click('.dl-url button:has-text("Načíst")'); pg.wait_for_timeout(900)
    pg.click('.dl-found .dl-cat >> nth=0'); pg.wait_for_timeout(2500)
    pg.click('#btn-top'); pg.wait_for_timeout(2000)
    det = pg.evaluate('()=>window.__ifc.data.layers.map(l=>l.detail&&l.detail.key)')
    check(det[0] and det[0].endswith('|192'), f'detail v dvojnásobné hustotě: {det}')
    check(any('dpi=192' in r for r in mock_requests()), 'parametr DPI pro WMS')
    pg.select_option('select[title^="Když jsou popisky"]', '0'); pg.wait_for_timeout(1500)
    det = pg.evaluate('()=>window.__ifc.data.layers.map(l=>l.detail&&l.detail.key)')
    check(det[0] and det[0].endswith('|96'), f'větší písmo: {det}')
    no_errors(pg)


@test('lišta: Celý, akce u vybraného prvku a Zpět')
def t_toolbar_undo(C):
    pg = C.app()
    cam = "()=>{const V=window.__ifcView;const c=V.camera.position.clone();return c.toArray()}"
    dirj = "()=>{const V=window.__ifcView,S=window.__ifc;const t=V.controls.target;const d=V.camera.position.clone().sub(t).normalize();return d.toArray().map(v=>+v.toFixed(3))}"
    check(pg.locator('#btn-iso').count() == 0, 'tlačítko 3D je sloučené s Celý')
    check(pg.evaluate('()=>document.getElementById("actbar").hidden'), 'bez výběru a skrytí nejsou akce vidět')
    b = canvas_box(pg)
    x, y = b['x'] + b['width'] * 0.3, b['y'] + b['height'] * 0.8
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(8):
        pg.mouse.move(x + i * 20, y - i * 3); pg.wait_for_timeout(20)
    pg.mouse.up(); pg.wait_for_timeout(200)
    d0 = pg.evaluate(dirj)
    pg.click('#btn-fit'); pg.wait_for_timeout(700)
    d1 = pg.evaluate(dirj)
    check(max(abs(a - b) for a, b in zip(d0, d1)) < 0.01, f'Celý drží směr pohledu {d0} {d1}')
    pg.click('#btn-fit'); pg.wait_for_timeout(700)
    iso = [1, 0.8, 1.15]; n = sum(v * v for v in iso) ** 0.5; iso = [v / n for v in iso]
    d2 = pg.evaluate(dirj)
    check(max(abs(a - b) for a, b in zip(d2, iso)) < 0.01, f'druhý stisk Celý = výchozí 3D pohled {d2}')
    pg.click('#btn-top'); pg.wait_for_timeout(700)
    pg.click('#btn-fit'); pg.wait_for_timeout(700)
    d3 = pg.evaluate(dirj)
    check(max(abs(a - b) for a, b in zip(d3, iso)) < 0.01, f'Celý po pohledu shora = 3D pohled {d3}')
    pg.evaluate('()=>{while(window.__ifcView.undoStack.length)window.__ifcView.undoStack.pop()}')
    for fx, fy in [(0.5, 0.5), (0.45, 0.55), (0.55, 0.45), (0.4, 0.6)]:
        pg.mouse.click(b['x'] + b['width'] * fx, b['y'] + b['height'] * fy); pg.wait_for_timeout(400)
        if pg.evaluate('()=>window.__ifc.selected'):
            break
    check(pg.locator('#btn-hide').is_visible() and pg.locator('#btn-isolate').is_visible(), 'po výběru jsou vidět akce Skrýt a Izolovat')
    check(pg.locator('#btn-undo').is_disabled(), 'Zpět je aktivní, až když je co vracet')
    pg.click('#btn-hide'); pg.wait_for_timeout(300)
    check(pg.evaluate('()=>window.__ifc.hidden.size') == 1 and pg.locator('#btn-undo').is_enabled(), 'skrytí a nabídka Zpět')
    pg.click('#btn-undo'); pg.wait_for_timeout(300)
    check(pg.evaluate('()=>window.__ifc.hidden.size') == 0, 'Zpět vrátí skrytý prvek')
    pg.mouse.click(b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.5); pg.wait_for_timeout(400)
    if not pg.evaluate('()=>window.__ifc.selected'):
        pg.mouse.click(b['x'] + b['width'] * 0.45, b['y'] + b['height'] * 0.55); pg.wait_for_timeout(400)
    c0 = pg.evaluate(cam)
    pg.click('#btn-isolate'); pg.wait_for_timeout(800)
    check(pg.evaluate('()=>!!window.__ifc.isolated') and pg.evaluate(cam) != c0, 'izolace a zaměření')
    pg.click('#btn-undo'); pg.wait_for_timeout(800)
    c1 = pg.evaluate(cam)
    check(pg.evaluate('()=>window.__ifc.isolated') is None and max(abs(a - b) for a, b in zip(c0, c1)) < 1e-3,
          'izolaci i s posunem kamery vrátí jedno Zpět')
    pg.click('#btn-clip'); pg.wait_for_timeout(300)
    check(pg.evaluate('()=>window.__ifc.clipOn'), 'řez zapnutý')
    check(pg.evaluate('()=>window.__ifc.selected') and pg.locator('#clip-pop').is_visible() and not pg.locator('#actbar').is_visible(), 'při rozbaleném panelu řezu jsou akce schované')
    pg.mouse.click(b['x'] + 5, b['y'] + 5)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    check(not pg.evaluate('()=>window.__ifc.clipOn'), 'Ctrl+Z vypne řez')
    no_errors(pg)


@test('telefon: spodní panel, Více a pohled nad panelem')
def t_phone_sheet(C):
    pg = C.app(device=C.pw.devices['iPhone 13'])
    app_open = '()=>document.getElementById("app").classList.contains("sheet-open")'
    check(not pg.evaluate(app_open), 'na telefonu je panel na začátku zavřený')
    check(pg.locator('#btn-more').is_visible() and not pg.locator('.toolbar #btn-coord').count(), 'méně používané nástroje jsou pod Více')
    pg.tap('#btn-more'); pg.wait_for_timeout(200)
    check(pg.locator('#more-pop #btn-coord').is_visible(), 'Více ukáže Souřadnice')
    pg.tap('#more-pop #btn-edges'); pg.wait_for_timeout(400)
    check(pg.evaluate('()=>document.getElementById("more-pop").hidden') and not pg.evaluate('()=>window.__ifc.edges'), 'nástroj z Více funguje a nabídka se zavře')
    box = canvas_box(pg)
    for fx, fy in [(0.4, 0.55), (0.5, 0.5), (0.6, 0.45)]:
        pg.touchscreen.tap(box['x'] + box['width'] * fx, box['y'] + box['height'] * fy); pg.wait_for_timeout(900)
        if pg.evaluate('()=>window.__ifc.selected'):
            break
    check(pg.evaluate('()=>window.__ifc.selected') and pg.evaluate(app_open), 'výběr otevře spodní panel')
    geo = """()=>{const r=(s)=>document.querySelector(s).getBoundingClientRect();const V=window.__ifcView;
      return {cover:parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--sheet-cover'))||0,
        off:V.camera.view&&V.camera.view.enabled?V.camera.view.offsetY:0, tb:r('.toolbar').bottom, pt:r('.panel').top,
        scroll:document.scrollingElement.scrollTop}}"""
    g = pg.evaluate(geo)
    check(g['cover'] > 100 and abs(g['off'] - g['cover'] / 2) < 2, f'pohled se posune nad panel {g}')
    check(g['tb'] <= g['pt'] + 1 and g['scroll'] == 0, f'lišta je nad panelem a stránka se neposunula {g}')
    gb = pg.locator('#sheet-grab').bounding_box()
    gx, gy = gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2
    pg.mouse.move(gx, gy); pg.mouse.down()
    for i in range(1, 9):
        pg.mouse.move(gx, gy - i * 40); pg.wait_for_timeout(30)
    pg.mouse.up(); pg.wait_for_timeout(500)
    g = pg.evaluate(geo)
    check(g['pt'] < 140 and g['cover'] == 0 and g['off'] == 0, f'vytažení nahoru = celá výška {g}')
    gb = pg.locator('#sheet-grab').bounding_box()
    pg.mouse.click(gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2); pg.wait_for_timeout(500)
    g = pg.evaluate(geo)
    check(g['cover'] > 0 and g['cover'] < 200, f'ťuknutí na úchyt přepne na proužek {g}')
    gb = pg.locator('#sheet-grab').bounding_box()
    gx, gy = gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2
    pg.mouse.move(gx, gy); pg.mouse.down()
    for i in range(1, 6):
        pg.mouse.move(gx, gy + i * 30); pg.wait_for_timeout(30)
    pg.mouse.up(); pg.wait_for_timeout(500)
    check(not pg.evaluate(app_open) and pg.evaluate(geo)['off'] == 0, 'stažení dolů panel zavře')
    no_errors(pg)


@test('geo: lokální počátek ve 3D a v půdorysu')
def t_origin(C):
    pg = C.app()
    pg.click('[data-tab="geo"]'); pg.wait_for_timeout(300)
    pg.click('#panel-geo button:has-text("Ukázat v modelu")'); pg.wait_for_timeout(500)
    lab = pg.locator('.origin-label')
    check(lab.is_visible() and 'E -598' in lab.inner_text().replace('\u00a0', ' ').replace('\u202f', ' '), f'popisek počátku s E/N: {lab.inner_text()!r}')
    check(pg.locator('.origin-ax').count() == 3, 'tři popisky os')
    pg.click('#panel-geo button:has-text("Zaměřit")'); pg.wait_for_timeout(800)
    pos = pg.evaluate('()=>{const r=document.querySelector(".origin-label").getBoundingClientRect(),c=document.querySelector("#viewport canvas").getBoundingClientRect();return [r.left-c.left,r.top-c.top,c.width,c.height]}')
    check(0 < pos[0] < pos[2] and 0 < pos[1] < pos[3], f'po Zaměřit je počátek v pohledu {pos}')
    pg.click('#btn-plan'); pg.wait_for_timeout(1500)
    check('0, 0, 0' in pg.inner_html('#plan-svg'), 'počátek v půdorysu')
    pg.reload(); pg.wait_for_function(READY, timeout=60000); pg.wait_for_timeout(600)
    check(pg.locator('.origin-label').is_visible(), 'volba se pamatuje')
    no_errors(pg)


@test('velký model: sloučené kreslení a paměť', big=True)
def t_big(C):
    huge = generate('mkhuge.py', 'huge65.ifc', 8600)
    pg = C.app()
    open_model(pg, huge, timeout=600000)
    chunks = pg.evaluate('()=>[window.__ifc.bigChunks&&window.__ifc.bigChunks.length, window.__ifc.meshes.length]')
    check(chunks[0] and chunks[0] < 200, f'sloučené bloky: {chunks}')
    calls = pg.evaluate(DRAW)[0]
    check(calls < 300, f'počet kreslení na snímek: {calls}')
    b = canvas_box(pg)
    for fx, fy in [(0.5, 0.5), (0.45, 0.55), (0.55, 0.45), (0.4, 0.6)]:
        pg.mouse.click(b['x'] + b['width'] * fx, b['y'] + b['height'] * fy); pg.wait_for_timeout(400)
        if pg.evaluate('()=>window.__ifc.selected'):
            break
    check(pg.evaluate('()=>window.__ifc.selected'), 'výběr prvku ve velkém modelu')
    pg.click('#btn-isolate'); pg.wait_for_timeout(400)
    check(pg.evaluate(DRAW)[0] < 10, 'izolace kreslí jen vybraný prvek')
    no_errors(pg)


# =====================================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--big', action='store_true', help='spustit i test velkého modelu')
    ap.add_argument('-k', default='', help='jen testy obsahující tento text (víc oddělit čárkou)')
    ap.add_argument('--chrome', default=os.environ.get('CHROME'), help='cesta k Chrome/Chromium (jinak Playwright)')
    a = ap.parse_args()
    if not (ROOT / 'app.js').exists():
        sys.exit('Chybí app.js – nejdřív spusť npm run build.')
    start_servers()
    results = []
    with sync_playwright() as pw:
        args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']
        browser = pw.chromium.launch(executable_path=a.chrome, args=args) if a.chrome else pw.chromium.launch(args=args)
        C = Ctx(browser); C.pw = pw
        for name, fn, big in TESTS_LIST:
            if big and not a.big:
                continue
            if a.k and not any(k.strip().lower() in (name + fn.__name__).lower() for k in a.k.split(',')):
                continue
            t0 = time.time()
            try:
                fn(C)
                ok, msg = True, ''
            except Fail as e:
                ok, msg = False, str(e)
            except Exception as e:  # noqa: BLE001
                ok, msg = False, f'{type(e).__name__}: {str(e).splitlines()[0][:300]}'
                traceback.print_exc()
            finally:
                for ctx in list(browser.contexts):
                    ctx.close()
            results.append((name, ok, msg, time.time() - t0))
            print(f"{'OK  ' if ok else 'CHYBA'} {name} ({time.time() - t0:.1f} s){'' if ok else '  → ' + msg}", flush=True)
        browser.close()
    bad = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(bad)}/{len(results)} testů prošlo.')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

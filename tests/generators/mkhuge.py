# Syntetický velký IFC4 (stovky MB): unikátní geometrie (triangulace i faceted brep), hodně vlastností.
# Použití: python3 mkhuge.py out.ifc POCET_PRVKU
import sys, random, math, time
random.seed(7)
out, N = sys.argv[1], int(sys.argv[2])
t0 = time.time()
CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
def guid(): return random.choice('0123') + ''.join(random.choice(CH) for _ in range(21))
f = open(out, 'w', buffering=1 << 22)
nid = 0
def L(s):
    global nid
    nid += 1
    f.write(f'#{nid}={s};\n')
    return nid
f.write("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');\n"
        "FILE_NAME('huge.ifc','2026-10-20T00:00:00',(''),(''),'gen','gen','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
O = L('IFCCARTESIANPOINT((0.,0.,0.))')
AX = L(f'IFCAXIS2PLACEMENT3D(#{O},$,$)')
CTX = L(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#{AX},$)")
BODY = L(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#{CTX},$,.MODEL_VIEW.,$)")
U = L('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')
UA = L(f'IFCUNITASSIGNMENT((#{U}))')
PROJ = L(f"IFCPROJECT('{guid()}',$,'Velky model',$,$,$,$,(#{CTX}),#{UA})")
def lp(x, y, z, rel=None):
    p = L(f'IFCCARTESIANPOINT(({x:.3f},{y:.3f},{z:.3f}))')
    a = L(f'IFCAXIS2PLACEMENT3D(#{p},$,$)')
    return L(f"IFCLOCALPLACEMENT({'#%d' % rel if rel else '$'},#{a})")
SITEP = lp(0, 0, 0)
SITE = L(f"IFCSITE('{guid()}',$,'Areal',$,$,#{SITEP},$,$,.ELEMENT.,$,$,$,$,$)")
BP = lp(0, 0, 0, SITEP)
BLD = L(f"IFCBUILDING('{guid()}',$,'Budova',$,$,#{BP},$,$,.ELEMENT.,$,$,$)")
L(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{PROJ},(#{SITE}))")
L(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{SITE},(#{BLD}))")
NS = 10
storeys = []
for k in range(NS):
    sp = lp(0, 0, k * 3.5, BP)
    storeys.append((L(f"IFCBUILDINGSTOREY('{guid()}',$,'{k+1}.NP',$,$,#{sp},$,$,.ELEMENT.,{k*3.5:.2f})"), sp))
L(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{BLD},({','.join('#%d' % s for s, _ in storeys)}))")
styles = []
for c in [(0.75, 0.73, 0.70), (0.55, 0.6, 0.65), (0.8, 0.5, 0.3), (0.3, 0.5, 0.75), (0.6, 0.6, 0.6), (0.85, 0.85, 0.8)]:
    col = L(f'IFCCOLOURRGB($,{c[0]},{c[1]},{c[2]})')
    sh = L(f'IFCSURFACESTYLESHADING(#{col},$)')
    styles.append(L(f'IFCSURFACESTYLE($,.BOTH.,(#{sh}))'))
words = ['beton', 'ocel', 'sádrokarton', 'cihla', 'dřevo', 'sklo', 'izolace', 'omítka', 'keramika', 'hliník']
def esc(s): return s.replace("'", "''").encode('ascii', 'xmlcharrefreplace').decode()
def tri_cyl(lx, r, seg=16, rings=4):
    pts = []
    for i in range(rings):
        x = lx * i / (rings - 1)
        for s in range(seg):
            a = 2 * math.pi * s / seg
            pts.append(f'({x:.4f},{r*math.cos(a):.4f},{r*math.sin(a)+r:.4f})')
    idx = []
    for i in range(rings - 1):
        for s in range(seg):
            a = i * seg + s + 1; b = i * seg + (s + 1) % seg + 1; c = a + seg; d = b + seg
            idx.append(f'({a},{b},{d})'); idx.append(f'({a},{d},{c})')
    pl = L(f"IFCCARTESIANPOINTLIST3D(({','.join(pts)}))")
    return L(f"IFCTRIANGULATEDFACESET(#{pl},$,.F.,({','.join(idx)}),$)"), 'Tessellation'
def brep_box(lx, ly, lz, n=2):
    # krabice s plochami rozdělenými n×n (jako exporty z Revitu)
    pid = {}
    def P(x, y, z):
        k = (round(x, 4), round(y, 4), round(z, 4))
        if k not in pid: pid[k] = L(f'IFCCARTESIANPOINT(({k[0]:.4f},{k[1]:.4f},{k[2]:.4f}))')
        return pid[k]
    faces = []
    def quad(a, b, c, d):
        loop = L(f'IFCPOLYLOOP((#{a},#{b},#{c},#{d}))')
        bd = L(f'IFCFACEOUTERBOUND(#{loop},.T.)')
        faces.append(L(f'IFCFACE((#{bd}))'))
    for axis in range(3):
        for side in (0, 1):
            for i in range(n):
                for j in range(n):
                    u0, u1, v0, v1 = i / n, (i + 1) / n, j / n, (j + 1) / n
                    def pt(u, v):
                        c = [0, 0, 0]; c[axis] = side; c[(axis + 1) % 3] = u; c[(axis + 2) % 3] = v
                        return P(c[0] * lx, c[1] * ly, c[2] * lz)
                    quad(pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1))
    sh = L(f"IFCCLOSEDSHELL(({','.join('#%d' % x for x in faces)}))")
    return L(f'IFCFACETEDBREP(#{sh})'), 'Brep'
kinds = [('IFCWALL', 'STANDARD'), ('IFCSLAB', 'FLOOR'), ('IFCBEAM', 'BEAM'), ('IFCCOLUMN', 'COLUMN'), ('IFCPIPESEGMENT', 'RIGIDSEGMENT'), ('IFCDUCTSEGMENT', 'RIGIDSEGMENT'), ('IFCBUILDINGELEMENTPROXY', 'NOTDEFINED')]
contained = {s: [] for s, _ in storeys}
spaces = {s: [] for s, _ in storeys}
for e in range(N):
    sid, sp = storeys[e % NS]
    x, y = random.uniform(0, 300), random.uniform(0, 200)
    pl = lp(x, y, random.uniform(0, 3), sp)
    cls, pt = random.choice(kinds)
    if cls in ('IFCPIPESEGMENT', 'IFCDUCTSEGMENT', 'IFCBEAM'):
        item, rt = tri_cyl(random.uniform(1, 6), random.uniform(0.05, 0.3), seg=random.choice((12, 16, 24)))
    else:
        item, rt = brep_box(random.uniform(0.3, 6), random.uniform(0.2, 4), random.uniform(0.2, 3), n=random.choice((1, 2, 2, 3)))
    L(f'IFCSTYLEDITEM(#{item},(#{random.choice(styles)}),$)')
    rep = L(f"IFCSHAPEREPRESENTATION(#{BODY},'Body','{rt}',(#{item}))")
    pds = L(f'IFCPRODUCTDEFINITIONSHAPE($,$,(#{rep}))')
    el = L(f"{cls}('{guid()}',$,'{cls[3:].title()} {e}',$,'Typ {e % 400}',#{pl},#{pds},'T{e}',.{pt}.)")
    contained[sid].append(el)
    for ps in ('Pset_Common', 'Identity Data', 'Constraints'):
        props = []
        for q in range(8):
            v = esc(f'{random.choice(words)} {random.randint(0, 99999)} hodnota vlastnosti {q}')
            props.append(L(f"IFCPROPERTYSINGLEVALUE('{ps[:4]}Prop{q}',$,IFCLABEL('{v}'),$)"))
        pset = L(f"IFCPROPERTYSET('{guid()}',$,'{ps}',$,({','.join('#%d' % p for p in props)}))")
        L(f"IFCRELDEFINESBYPROPERTIES('{guid()}',$,$,$,(#{el}),#{pset})")
    if e % 20 == 0:
        sp_pl = lp(x, y, 0, sp)
        item, rt = brep_box(5, 4, 3, n=1)
        rep = L(f"IFCSHAPEREPRESENTATION(#{BODY},'Body','{rt}',(#{item}))")
        pds = L(f'IFCPRODUCTDEFINITIONSHAPE($,$,(#{rep}))')
        spc = L(f"IFCSPACE('{guid()}',$,'{e//20}',$,$,#{sp_pl},#{pds},'Mistnost {e//20}',.ELEMENT.,.INTERNAL.,$)")
        spaces[sid].append(spc)
for s, _ in storeys:
    L(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{guid()}',$,$,$,({','.join('#%d' % x for x in contained[s])}),#{s})")
    if spaces[s]: L(f"IFCRELAGGREGATES('{guid()}',$,$,$,#{s},({','.join('#%d' % x for x in spaces[s])}))")
f.write('ENDSEC;\nEND-ISO-10303-21;\n')
f.close()
import os
print('lines', nid, 'size MB', round(os.path.getsize(out) / 1e6, 1), 'time', round(time.time() - t0, 1))

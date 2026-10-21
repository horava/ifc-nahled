"""Napodobenina veřejných mapových služeb pro testy (port 8780):
ArcGIS MapServer (/arcgis/rest/services/TEST/MapServer, vrstva parcel s dotazem), ImageServer s terénem
v LERC (/arcgis/rest/services/DEM/ImageServer), SceneServer I3S (/arcgis/rest/services/B/SceneServer),
WMS 1.1.1 (/wms) a WMS 1.3.0 (/x/wms13). Souřadnice odpovídají georeferenci ukázkového pavilonu (S-JTSK).
Seznam přijatých požadavků vrací /debugreq2. Potřebuje: numpy, pillow, lerc."""
import http.server, json, io, math, urllib.parse as up
from PIL import Image, ImageDraw
def png(bbox, w, h, color):
    e0,n0,e1,n1 = bbox
    im = Image.new('RGBA', (w,h), (240,235,215,255) if color=='base' else (0,0,0,0))
    d = ImageDraw.Draw(im)
    step=10
    E=math.ceil(e0/step)*step
    while E<e1:
        x=(E-e0)/(e1-e0)*w; d.line([(x,0),(x,h)], fill=(120,120,120,255) if E%50 else (200,40,40,255), width=1 if E%50 else 3); E+=step
    N=math.ceil(n0/step)*step
    while N<n1:
        y=(n1-N)/(n1-n0)*h; d.line([(0,y),(w,y)], fill=(120,120,120,255) if N%50 else (40,40,200,255), width=1 if N%50 else 3); N+=step
    b=io.BytesIO(); im.save(b,'PNG'); return b.getvalue()
def feats(bbox):
    e0,n0,e1,n1=bbox; out=[]; s=20; k=0
    E=math.floor(e0/s)*s
    while E<e1:
        N=math.floor(n0/s)*s
        while N<n1:
            k+=1
            ring=[[E,N],[E,N+s],[E+s,N+s],[E+s,N],[E,N]]  # clockwise
            out.append({'attributes':{'objectid':k,'cisloparcely':f'{1000+k}/1','vymeraparcely':400},'geometry':{'rings':[ring]}})
            N+=s
        E+=s
    return out

import struct, numpy as np, lerc
E0,N0,H0=-598420.0,-1160640.0,231.5
def dem(E,N): return 229.0 + 0.03*(E-E0) + 1.5*math.sin((N-N0)/25.0)
def lerc_dem(bb,w,h):
    e0,n0,e1,n1=bb
    a=np.zeros((h,w),dtype=np.float32)
    for j in range(h):
        N=n1-(j+0.5)/h*(n1-n0)
        for i in range(w):
            E=e0+(i+0.5)/w*(e1-e0); a[j,i]=dem(E,N)
    r=lerc.encode(a,1,False,None,0.001,1)
    return bytes(r[2][:r[1]])
SCENE_NODES=[
  {'index':0,'obb':{'center':[E0,N0,240],'halfSize':[500,500,50],'quaternion':[0,0,0,1]},'children':[1,2,3]},
  {'index':1,'parentIndex':0,'lodThreshold':100,'obb':{'center':[E0-40,N0+30,dem(E0-40,N0+30)],'halfSize':[15,15,15],'quaternion':[0,0,0,1]},'mesh':{'material':{'definition':0},'geometry':{'definition':0,'resource':0,'vertexCount':72,'featureCount':2},'attribute':{'resource':0}}},
  {'index':2,'parentIndex':0,'lodThreshold':100,'obb':{'center':[E0+12.27,N0+6.44,dem(E0+12.27,N0+6.44)],'halfSize':[15,15,15],'quaternion':[0,0,0,1]},'mesh':{'material':{'definition':0},'geometry':{'definition':0,'resource':1,'vertexCount':72,'featureCount':2},'attribute':{'resource':1}}},
  {'index':3,'parentIndex':0,'lodThreshold':100,'obb':{'center':[E0+5000,N0+5000,250],'halfSize':[15,15,15],'quaternion':[0,0,0,1]},'mesh':{'material':{'definition':0},'geometry':{'definition':0,'resource':2,'vertexCount':36,'featureCount':1},'attribute':{'resource':2}}},
]
REQ=[]
def box_tris(x0,y0,z0,x1,y1,z1):
    P=[(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
    F=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return [P[i] for f in F for i in f]
def geom(res):
    n=SCENE_NODES[res+1]; c=n['obb']['center']
    feats=[(-12,-6,0,-2,6,12,(200,80,60,255)),(2,-6,0,12,6,18,(80,120,200,255))] if res<2 else [(-5,-5,0,5,5,10,(0,0,0,255))]
    pos=[];col=[];fr=[]
    for k,(a,b,z0,d,e,z1,cc) in enumerate(feats):
        t0=len(pos)//3
        for p in box_tris(a,b,z0,d,e,z1): pos.append(p); col.append(cc)
        fr.append((t0,len(pos)//3-1))
    vc=len(pos); fc=len(feats)
    out=struct.pack('<II',vc,fc)
    out+=b''.join(struct.pack('<fff',*p) for p in pos)
    out+=b''.join(struct.pack('<fff',0,0,1) for p in pos)
    out+=b''.join(struct.pack('<ff',0,0) for p in pos)
    out+=b''.join(struct.pack('<BBBB',*c) for c in col)
    out+=b''.join(struct.pack('<Q',1000+res*10+k) for k in range(fc))
    out+=b''.join(struct.pack('<II',*f) for f in fr)
    return out
def attr(res,key):
    names=[f'Budova {res}-A',f'Budova {res}-B']
    if key=='f_0':
        bs=[n.encode()+b'\x00' for n in names]
        return struct.pack('<II',len(bs),sum(len(b) for b in bs))+b''.join(struct.pack('<I',len(b)) for b in bs)+b''.join(bs)
    if key=='f_1':
        return struct.pack('<I',2)+b'\x00'*4+struct.pack('<dd',12.0,18.5)

class H(http.server.BaseHTTPRequestHandler):
    def send(self, body, ctype):
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(body)
    def log_message(self,*a): pass
    def do_GET(self):
        u=up.urlparse(self.path); q={k.lower():v[0] for k,v in up.parse_qs(u.query).items()}; p=u.path
        if '/ImageServer' in p:
            if p.endswith('/ImageServer'): return self.send(json.dumps({'name':'Test DEM','bandCount':1,'pixelType':'F32','pixelSizeX':2,'pixelSizeY':2}).encode(),'application/json')
            if p.endswith('/exportImage'):
                bb=[float(x) for x in q['bbox'].split(',')]; w,h=[int(x) for x in q['size'].split(',')]
                return self.send(lerc_dem(bb,w,h),'application/octet-stream')
        if p.endswith('/debugreq2'): return self.send(json.dumps(REQ).encode(),'application/json')
        if '/SceneServer' in p:
            REQ.append(p)
            if p.endswith('/layers/0'):
                info={'name':'Testovací budovy 3D','layerType':'3DObject','spatialReference':{'wkid':102067,'latestWkid':5514},
                  'store':{'profile':'meshpyramids','version':'1.9','indexCRS':'http://www.opengis.net/def/crs/EPSG/0/5514','vertexCRS':'http://www.opengis.net/def/crs/EPSG/0/5514'},
                  'nodePages':{'nodesPerPage':64,'lodSelectionMetricType':'maxScreenThresholdSQ'},
                  'geometryDefinitions':[{'geometryBuffers':[{'offset':8,'position':{'type':'Float32','component':3},'normal':{'type':'Float32','component':3},'uv0':{'type':'Float32','component':2},'color':{'type':'UInt8','component':4},'featureId':{'type':'UInt64','component':1,'binding':'per-feature'},'faceRange':{'type':'UInt32','component':2,'binding':'per-feature'}},{'compressedAttributes':{'encoding':'draco','attributes':['position']}}]}],
                  'fields':[{'name':'NAZEV','alias':'Název'},{'name':'VYSKA','alias':'Výška'}],
                  'attributeStorageInfo':[{'key':'f_0','name':'NAZEV','header':[{'property':'count','valueType':'UInt32'},{'property':'attributeValuesByteCount','valueType':'UInt32'}],'ordering':['attributeByteCounts','attributeValues'],'attributeByteCounts':{'valueType':'UInt32'},'attributeValues':{'valueType':'String'}},
                                          {'key':'f_1','name':'VYSKA','header':[{'property':'count','valueType':'UInt32'}],'ordering':['attributeValues'],'attributeValues':{'valueType':'Float64'}}]}
                return self.send(json.dumps(info).encode(),'application/json')
            if '/nodepages/' in p: return self.send(json.dumps({'nodes':SCENE_NODES}).encode(),'application/json')
            if '/geometries/0' in p:
                res=int(p.split('/nodes/')[1].split('/')[0]); return self.send(geom(res),'application/octet-stream')
            if '/attributes/' in p:
                res=int(p.split('/nodes/')[1].split('/')[0]); key=p.split('/attributes/')[1].split('/')[0]; return self.send(attr(res,key),'application/octet-stream')
            if p.endswith('/debugreq'): return self.send(json.dumps(REQ).encode(),'application/json')
        if p.endswith('/MapServer') : return self.send(json.dumps({'mapName':'Testovací mapa','copyrightText':'<b>© Testovací úřad</b><img src=x onerror=window.__xss=1>','capabilities':'Map,Query','layers':[{'id':0,'name':'Testovací parcely','subLayerIds':None}]}).encode(),'application/json')
        if p.endswith('/MapServer/0') : return self.send(json.dumps({'name':'Testovací parcely','geometryType':'esriGeometryPolygon','displayField':'cisloparcely','fields':[{'name':'objectid','alias':'objectid','type':'esriFieldTypeOID'},{'name':'cisloparcely','alias':'Číslo parcely','type':'esriFieldTypeString'},{'name':'vymeraparcely','alias':'Výměra parcely','type':'esriFieldTypeDouble'}]}).encode(),'application/json')
        if p.endswith('/export'):
            bb=[float(x) for x in q['bbox'].split(',')]; w,h=[int(x) for x in q['size'].split(',')]
            return self.send(png(bb,w,h,'base'),'image/png')
        if p.endswith('/query'):
            bb=[float(x) for x in q['geometry'].split(',')]
            return self.send(json.dumps({'features':feats(bb)}).encode(),'application/json')
        if p.endswith('/identify'):
            return self.send(json.dumps({'results':[{'layerName':'Testovací parcely','attributes':{'Číslo parcely':'999/9','Bod':q['geometry']}}]}).encode(),'application/json')
        if p.endswith('/wms13'):
            r=q.get('request','').lower(); ver=q.get('version','')
            if r=='getcapabilities':
                if ver and ver!='1.3.0':
                    return self.send(b'<?xml version="1.0"?><ServiceExceptionReport version="1.3.0"><ServiceException>Unsupported version</ServiceException></ServiceExceptionReport>','text/xml')
                x='<?xml version="1.0"?><WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Service><Title>DTM test</Title></Service><Capability><Request><GetMap><Format>image/png</Format><Format>image/jpeg</Format></GetMap><GetFeatureInfo><Format>text/html</Format><Format>application/json</Format></GetFeatureInfo></Request><Layer><Title>Root</Title><Attribution><Title>DTM kraje test</Title></Attribution><CRS>EPSG:5514</CRS><CRS>EPSG:3857</CRS><Layer queryable="1"><Name>vedeni</Name><Title>Vedení</Title></Layer><Layer queryable="1"><Name>objekty</Name><Title>Objekty</Title></Layer></Layer></Capability></WMS_Capabilities>'
                return self.send(x.encode(),'text/xml')
            if r=='getmap':
                if ver!='1.3.0' or 'crs' not in q: return self.send(b'<ServiceExceptionReport><ServiceException>bad</ServiceException></ServiceExceptionReport>','text/xml')
                bb=[float(x) for x in q['bbox'].split(',')]
                REQ.append('wms13 layers='+q.get('layers',''))
                return self.send(png(bb,int(q['width']),int(q['height']),'over'),'image/png')
            if r=='getfeatureinfo':
                return self.send(json.dumps({'type':'FeatureCollection','features':[{'id':'vedeni.17','properties':{'druh':'vodovod','DN':150,'i':q.get('i'),'j':q.get('j')}}]}).encode(),'application/json')
        if p.endswith('/wms'):
            r=q.get('request','').lower()
            if r=='getcapabilities':
                x='<?xml version="1.0"?><WMT_MS_Capabilities version="1.1.1"><Service><Title>Testovací WMS</Title><ContactInformation><ContactPersonPrimary><ContactOrganization>Mřížkový institut</ContactOrganization></ContactPersonPrimary></ContactInformation></Service><Capability><Layer><Title>Root</Title><SRS>EPSG:5514</SRS><Layer queryable="1"><Name>mrizka</Name><Title>Mřížka 10 m</Title></Layer></Layer></Capability></WMT_MS_Capabilities>'
                return self.send(x.encode(),'text/xml')
            if r=='getmap':
                bb=[float(x) for x in q['bbox'].split(',')]
                REQ.append(f"wms getmap {q['width']}x{q['height']} dpi={q.get('dpi')} fo={q.get('format_options')} w={bb[2]-bb[0]:.1f}")
                return self.send(png(bb,int(q['width']),int(q['height']),'over'),'image/png')
            if r=='getfeatureinfo':
                return self.send(f"Vrstva mrizka\nX={q.get('x')} Y={q.get('y')}".encode(),'text/plain')
        self.send_response(404); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
def serve(port=8780):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
    srv.serve_forever()

if __name__ == '__main__':
    serve()

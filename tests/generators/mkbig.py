import ifcopenshell, ifcopenshell.guid as G, random, sys, time
t=time.time()
random.seed(1)
f = ifcopenshell.file(schema='IFC4')
O = f.createIfcCartesianPoint((0.,0.,0.))
ax = f.createIfcAxis2Placement3D(O, None, None)
ctx = f.createIfcGeometricRepresentationContext(None,'Model',3,1e-5,ax,None)
body = f.createIfcGeometricRepresentationSubContext('Body','Model',None,None,None,None,ctx,None,'MODEL_VIEW',None)
u = f.createIfcSIUnit(None,'LENGTHUNIT',None,'METRE'); ua=f.createIfcUnitAssignment([u])
proj = f.createIfcProject(G.new(),None,'Velký test',None,None,None,None,[ctx],ua)
own=None
def lp(x,y,z, rel=None): return f.createIfcLocalPlacement(rel, f.createIfcAxis2Placement3D(f.createIfcCartesianPoint((float(x),float(y),float(z))),None,None))
site = f.createIfcSite(G.new(),None,'Areál',None,None,lp(0,0,0),None,None,'ELEMENT',None,None,None,None,None)
bld = f.createIfcBuilding(G.new(),None,'Budova A',None,None,lp(0,0,0),None,None,'ELEMENT',None,None,None)
f.createIfcRelAggregates(G.new(),None,None,None,proj,[site]); f.createIfcRelAggregates(G.new(),None,None,None,site,[bld])
def boxrep(lx,ly,lz):
    prof=f.createIfcRectangleProfileDef('AREA',None,f.createIfcAxis2Placement2D(f.createIfcCartesianPoint((lx/2,ly/2)),None),lx,ly)
    s=f.createIfcExtrudedAreaSolid(prof,ax,f.createIfcDirection((0.,0.,1.)),lz)
    return f.createIfcProductDefinitionShape(None,None,[f.createIfcShapeRepresentation(body,'Body','SweptSolid',[s])])
NS = int(sys.argv[2]) if len(sys.argv)>2 else 8
uses=['Kancelář','Učebna','Chodba','WC','Sklad','Laboratoř','Zasedací místnost','Technická místnost','Kuchyňka','Šatna','Archiv']
fr=['EI 30','EI 45','EI 60','REI 90','—']
storeys=[]
wallrep = boxrep(4.0,0.2,3.0); colrep=boxrep(0.4,0.4,3.0); doorrep=boxrep(0.9,0.1,2.1)
nel=0
for k in range(NS):
    st=f.createIfcBuildingStorey(G.new(),None,f'{k+1}.NP',None,None,lp(0,0,k*3.5),None,None,'ELEMENT',k*3.5)
    storeys.append(st)
    els=[]; spaces=[]
    for i in range(20):
        for j in range(12):
            x,y=i*4.2,j*6.0
            w=f.createIfcWall(G.new(),None,f'Stěna {k+1}-{i}-{j}',None,None,lp(x,y,0,st.ObjectPlacement),wallrep,f'W{k}{i:02}{j:02}','STANDARD')
            els.append(w)
            p=f.createIfcPropertySet(G.new(),None,'Pset_WallCommon',None,[f.createIfcPropertySingleValue('FireRating',None,f.createIfcLabel(random.choice(fr)),None),f.createIfcPropertySingleValue('IsExternal',None,f.createIfcBoolean(j in (0,11)),None),f.createIfcPropertySingleValue('ThermalTransmittance',None,f.createIfcThermalTransmittanceMeasure(round(random.uniform(0.15,1.2),2)),None)])
            f.createIfcRelDefinesByProperties(G.new(),None,None,None,[w],p)
            if j%3==0:
                d=f.createIfcDoor(G.new(),None,f'Dveře {k+1}.{i:02}{j:02}',None,None,lp(x+1,y-0.05,0,st.ObjectPlacement),doorrep,None,2.1,0.9,'DOOR',None,None)
                els.append(d)
                p=f.createIfcPropertySet(G.new(),None,'Pset_DoorCommon',None,[f.createIfcPropertySingleValue('FireRating',None,f.createIfcLabel(random.choice(fr)),None)])
                f.createIfcRelDefinesByProperties(G.new(),None,None,None,[d],p)
            if i%2==0 and j<11:
                c=f.createIfcColumn(G.new(),None,f'Sloup {k+1}-{i}-{j}',None,None,lp(x,y+3,0,st.ObjectPlacement),colrep,None,'COLUMN')
                els.append(c)
            if j<11:
                sp=f.createIfcSpace(G.new(),None,f'{k+1}.{i:02}{j:02}',None,random.choice(uses),lp(x+0.1,y+0.2,0,st.ObjectPlacement),boxrep(4.0,5.6,3.0),random.choice(uses),'ELEMENT','INTERNAL',None)
                spaces.append(sp)
                q=f.createIfcElementQuantity(G.new(),None,'Qto_SpaceBaseQuantities',None,None,[f.createIfcQuantityArea('NetFloorArea',None,None,22.4,None)])
                f.createIfcRelDefinesByProperties(G.new(),None,None,None,[sp],q)
                p=f.createIfcPropertySet(G.new(),None,'MU_Pasport',None,[f.createIfcPropertySingleValue('KodMistnosti',None,f.createIfcLabel(f'BHA01N{k+1:02}{i:02}{j:02}'),None),f.createIfcPropertySingleValue('Ucel',None,f.createIfcLabel(sp.LongName),None)])
                f.createIfcRelDefinesByProperties(G.new(),None,None,None,[sp],p)
    f.createIfcRelContainedInSpatialStructure(G.new(),None,None,None,els,st)
    f.createIfcRelAggregates(G.new(),None,None,None,st,spaces)
    nel+=len(els)+len(spaces)
f.createIfcRelAggregates(G.new(),None,None,None,bld,storeys)
f.write(sys.argv[1]); print('elements',nel, round(time.time()-t,1),'s')

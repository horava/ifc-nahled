# Testovací model: stěna s typem, vrstvami materiálu, otvorem s dveřmi a prostupem bez výplně
import ifcopenshell, ifcopenshell.api as A, numpy as np, sys
f = A.run('project.create_file', version='IFC4')
proj = A.run('root.create_entity', f, ifc_class='IfcProject', name='Skladby')
lu = A.run('unit.add_si_unit', f, unit_type='LENGTHUNIT'); A.run('unit.assign_unit', f, units=[lu])
ctx = A.run('context.add_context', f, context_type='Model')
body = A.run('context.add_context', f, context_type='Model', context_identifier='Body', target_view='MODEL_VIEW', parent=ctx)
site = A.run('root.create_entity', f, ifc_class='IfcSite', name='Areál')
bld = A.run('root.create_entity', f, ifc_class='IfcBuilding', name='Budova')
st = A.run('root.create_entity', f, ifc_class='IfcBuildingStorey', name='1.NP')
A.run('aggregate.assign_object', f, relating_object=proj, products=[site])
A.run('aggregate.assign_object', f, relating_object=site, products=[bld])
A.run('aggregate.assign_object', f, relating_object=bld, products=[st])
# materiály a skladba
om = A.run('material.add_material', f, name='Omítka - vnitřní')
ci = A.run('material.add_material', f, name='Cihly plné - nosné')
lset = A.run('material.add_material_set', f, name='Z2 skladba', set_type='IfcMaterialLayerSet')
for m, t in [(om, 0.015), (ci, 0.3), (om, 0.015)]:
    l = A.run('material.add_layer', f, layer_set=lset, material=m); l.LayerThickness = t
wtype = A.run('root.create_entity', f, ifc_class='IfcWallType', name='Z2 - stěna obvodová')
A.run('material.assign_material', f, products=[wtype], material=lset)
pt = A.run('pset.add_pset', f, product=wtype, name='Pset_WallCommon'); A.run('pset.edit_pset', f, pset=pt, properties={'IsExternal': True, 'FireRating': 'REI 90'})
walls = []
for i in range(2):
    w = A.run('root.create_entity', f, ifc_class='IfcWall', name=f'Stěna {i+1}')
    A.run('type.assign_type', f, related_objects=[w], relating_type=wtype)
    rep = A.run('geometry.add_wall_representation', f, context=body, length=6.0, height=3.0, thickness=0.33)
    A.run('geometry.assign_representation', f, product=w, representation=rep)
    M = np.eye(4); M[1, 3] = i * 5.0
    A.run('geometry.edit_object_placement', f, product=w, matrix=M)
    A.run('spatial.assign_container', f, relating_structure=st, products=[w])
    walls.append(w)
# vrstvy na stěně jako usage (typické pro export) – assign_material na typ už usage vytvoří u stěn
# otvor s dveřmi ve stěně 1, prostup bez výplně ve stěně 2
op = A.run('root.create_entity', f, ifc_class='IfcOpeningElement', name='BJA03N02D004')
orep = A.run('geometry.add_wall_representation', f, context=body, length=0.9, height=2.1, thickness=0.5)
A.run('geometry.assign_representation', f, product=op, representation=orep)
M = np.eye(4); M[0, 3] = 2.0; M[1, 3] = -0.08; A.run('geometry.edit_object_placement', f, product=op, matrix=M)
A.run('feature.add_feature', f, feature=op, element=walls[0])
door = A.run('root.create_entity', f, ifc_class='IfcDoor', name='Dveře D04')
drep = A.run('geometry.add_wall_representation', f, context=body, length=0.9, height=2.1, thickness=0.05)
A.run('geometry.assign_representation', f, product=door, representation=drep)
M = np.eye(4); M[0, 3] = 2.0; M[1, 3] = 0.14; A.run('geometry.edit_object_placement', f, product=door, matrix=M)
A.run('spatial.assign_container', f, relating_structure=st, products=[door])
A.run('feature.add_filling', f, opening=op, element=door)
op2 = A.run('root.create_entity', f, ifc_class='IfcOpeningElement', name='Prostup P12')
orep2 = A.run('geometry.add_wall_representation', f, context=body, length=0.3, height=0.3, thickness=0.5)
A.run('geometry.assign_representation', f, product=op2, representation=orep2)
M = np.eye(4); M[0, 3] = 4.0; M[1, 3] = 4.92; M[2, 3] = 2.2; A.run('geometry.edit_object_placement', f, product=op2, matrix=M)
A.run('feature.add_feature', f, feature=op2, element=walls[1])
f.write(sys.argv[1])
print('ok', [ (r.is_a()) for r in f.by_type('IfcRelAssociatesMaterial')], [m.is_a() for m in f.by_type('IfcMaterialLayerSetUsage')])

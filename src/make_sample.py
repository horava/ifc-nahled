"""Generate a small sample IFC4 building for the viewer demo."""
import sys
import numpy as np
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.guid

out = sys.argv[1]
f = api.run("project.create_file", version="IFC4")
project = api.run("root.create_entity", f, ifc_class="IfcProject", name="Ukázkový projekt")
api.run("unit.assign_unit", f, length={"is_metric": True, "raw": "METERS"})
ctx = api.run("context.add_context", f, context_type="Model")
body = api.run("context.add_context", f, context_type="Model", context_identifier="Body",
               target_view="MODEL_VIEW", parent=ctx)

site = api.run("root.create_entity", f, ifc_class="IfcSite", name="Pozemek")
bld = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="Ukázkový pavilon")
api.run("aggregate.assign_object", f, relating_object=project, products=[site])
api.run("aggregate.assign_object", f, relating_object=site, products=[bld])

H = 3.2          # storey height
W, D = 14.0, 9.0  # footprint
T = 0.3          # wall thickness
storeys = []
for i, (name, elev) in enumerate([("1.NP", 0.0), ("2.NP", H)]):
    s = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name=name)
    s.Elevation = elev
    api.run("aggregate.assign_object", f, relating_object=bld, products=[s])
    storeys.append((s, elev))


def place(el, x, y, z, rot=0.0):
    m = np.eye(4)
    c, s_ = np.cos(rot), np.sin(rot)
    m[0][0], m[0][1], m[1][0], m[1][1] = c, -s_, s_, c
    m[0][3], m[1][3], m[2][3] = x, y, z
    api.run("geometry.edit_object_placement", f, product=el, matrix=m)


def box(el, lx, ly, lz):
    """Axis-aligned box from local origin (x,y in plan, z up)."""
    prof = f.createIfcRectangleProfileDef("AREA", None,
        f.createIfcAxis2Placement2D(f.createIfcCartesianPoint((lx / 2, ly / 2)), None), lx, ly)
    solid = f.createIfcExtrudedAreaSolid(prof,
        f.createIfcAxis2Placement3D(f.createIfcCartesianPoint((0.0, 0.0, 0.0)), None, None),
        f.createIfcDirection((0.0, 0.0, 1.0)), lz)
    rep = f.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])
    api.run("geometry.assign_representation", f, product=el, representation=rep)


def pset(el, name, props):
    p = api.run("pset.add_pset", f, product=el, name=name)
    api.run("pset.edit_pset", f, pset=p, properties=props)


def style(name, rgb, transparency=0.0):
    st = api.run("style.add_style", f, name=name)
    api.run("style.add_surface_style", f, style=st, ifc_class="IfcSurfaceStyleShading",
            attributes={"SurfaceColour": {"Name": None, "Red": rgb[0], "Green": rgb[1], "Blue": rgb[2]},
                        "Transparency": transparency})
    return st


def paint(el, st):
    for rep in el.Representation.Representations:
        api.run("style.assign_representation_styles", f, shape_representation=rep, styles=[st])


s_wall = style("Omítka", (0.92, 0.90, 0.86))
s_slab = style("Beton", (0.70, 0.71, 0.70))
s_glass = style("Sklo", (0.55, 0.75, 0.88), 0.55)
s_door = style("Dřevo", (0.55, 0.38, 0.24))
s_col = style("Ocel", (0.35, 0.40, 0.45))
s_roof = style("Krytina", (0.38, 0.30, 0.28))

counter = {"wall": 0}
for s, z in storeys:
    sn = s.Name
    # slab
    slab = api.run("root.create_entity", f, ifc_class="IfcSlab", name=f"Strop {sn}", predefined_type="FLOOR")
    api.run("spatial.assign_container", f, relating_structure=s, products=[slab])
    place(slab, 0, 0, z - 0.25)
    box(slab, W, D, 0.25)
    paint(slab, s_slab)
    pset(slab, "Pset_SlabCommon", {"IsExternal": False, "LoadBearing": True, "FireRating": "REI 60"})
    pset(slab, "MU_Pasport", {"KodPodlazi": sn, "Material": "železobeton C25/30"})
    # 4 walls
    walls = [("S", 0, 0, W, T), ("J", 0, D - T, W, T), ("Z", 0, T, T, D - 2 * T), ("V", W - T, T, T, D - 2 * T)]
    for side, x, y, lx, ly in walls:
        counter["wall"] += 1
        w = api.run("root.create_entity", f, ifc_class="IfcWall", name=f"Obvodová stěna {side} – {sn}",
                    predefined_type="STANDARD")
        api.run("spatial.assign_container", f, relating_structure=s, products=[w])
        place(w, x, y, z)
        box(w, lx, ly, H - 0.25)
        paint(w, s_wall)
        pset(w, "Pset_WallCommon", {"IsExternal": True, "LoadBearing": True, "FireRating": "REI 90",
                                     "ThermalTransmittance": 0.18, "Reference": "SO-300"})
        pset(w, "MU_Pasport", {"KodPodlazi": sn, "Material": "keramické zdivo + ETICS",
                                "Tloustka_mm": int(T * 1000)})
    # inner wall
    iw = api.run("root.create_entity", f, ifc_class="IfcWall", name=f"Vnitřní příčka – {sn}", predefined_type="PARTITIONING")
    api.run("spatial.assign_container", f, relating_structure=s, products=[iw])
    place(iw, 8.5, T, z)
    box(iw, 0.15, D - 2 * T, H - 0.25)
    paint(iw, s_wall)
    pset(iw, "Pset_WallCommon", {"IsExternal": False, "LoadBearing": False, "AcousticRating": "Rw 47 dB"})
    # windows on south facade (in front of wall surface to stay visible)
    for k, wx in enumerate([1.5, 4.5, 10.0]):
        win = api.run("root.create_entity", f, ifc_class="IfcWindow", name=f"Okno O{k + 1} – {sn}")
        win.OverallWidth, win.OverallHeight = 1.8, 1.5
        api.run("spatial.assign_container", f, relating_structure=s, products=[win])
        place(win, wx, -0.06, z + 0.9)
        box(win, 1.8, 0.08, 1.5)
        paint(win, s_glass)
        pset(win, "Pset_WindowCommon", {"IsExternal": True, "ThermalTransmittance": 0.9, "GlazingAreaFraction": 0.8})
    # columns inside
    for k, (cx, cy) in enumerate([(4.5, 4.35), (11.5, 4.35)]):
        col = api.run("root.create_entity", f, ifc_class="IfcColumn", name=f"Sloup S{k + 1} – {sn}")
        api.run("spatial.assign_container", f, relating_structure=s, products=[col])
        place(col, cx, cy, z)
        box(col, 0.3, 0.3, H - 0.25)
        paint(col, s_col)
        pset(col, "Pset_ColumnCommon", {"LoadBearing": True, "IsExternal": False, "FireRating": "R 60"})

# door on ground floor, north facade
s0 = storeys[0][0]
door = api.run("root.create_entity", f, ifc_class="IfcDoor", name="Vstupní dveře D1")
door.OverallWidth, door.OverallHeight = 1.2, 2.2
api.run("spatial.assign_container", f, relating_structure=s0, products=[door])
place(door, 6.4, -0.06, 0)
box(door, 1.2, 0.08, 2.2)
paint(door, s_door)
pset(door, "Pset_DoorCommon", {"IsExternal": True, "FireRating": "EI 30", "SecurityRating": "RC2"})

# stair as simple block
st = api.run("root.create_entity", f, ifc_class="IfcStair", name="Schodiště SCH1")
api.run("spatial.assign_container", f, relating_structure=s0, products=[st])
place(st, 9.2, 1.0, 0)
box(st, 1.2, 4.0, 1.6)
paint(st, s_slab)

# roof
roof = api.run("root.create_entity", f, ifc_class="IfcSlab", name="Střecha", predefined_type="ROOF")
api.run("spatial.assign_container", f, relating_structure=storeys[1][0], products=[roof])
place(roof, -0.4, -0.4, 2 * H - 0.25)
box(roof, W + 0.8, D + 0.8, 0.35)
paint(roof, s_roof)
pset(roof, "Pset_SlabCommon", {"IsExternal": True, "ThermalTransmittance": 0.15})

f.write(out)
print("ok", len(f.by_type("IfcProduct")))

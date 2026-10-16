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


import os
GLOBAL_ROT = np.radians(float(os.environ.get("ROT_DEG", "0")))  # natočení celé budovy (pro testy)


def place(el, x, y, z, rot=0.0):
    m = np.eye(4)
    c, s_ = np.cos(rot), np.sin(rot)
    m[0][0], m[0][1], m[1][0], m[1][1] = c, -s_, s_, c
    m[0][3], m[1][3], m[2][3] = x, y, z
    g = np.eye(4)
    gc, gs = np.cos(GLOBAL_ROT), np.sin(GLOBAL_ROT)
    g[0][0], g[0][1], g[1][0], g[1][1] = gc, -gs, gs, gc
    api.run("geometry.edit_object_placement", f, product=el, matrix=g @ m)


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
    # rooms (IfcSpace), aggregated to the storey
    lvl = "1" if z == 0 else "2"
    for k, (rx, rw, long_name) in enumerate([(T, 8.5 - T, "Kancelář"), (8.65, W - T - 8.65, "Zasedací místnost")]):
        sp = api.run("root.create_entity", f, ifc_class="IfcSpace", name=f"{lvl}.0{k + 1}", predefined_type="INTERNAL")
        sp.LongName = long_name
        api.run("aggregate.assign_object", f, relating_object=s, products=[sp])
        place(sp, rx, T, z)
        box(sp, rw, D - 2 * T, H - 0.25)
        pset(sp, "Pset_SpaceCommon", {"IsExternal": False, "Reference": f"{lvl}.0{k + 1}"})
        qto = api.run("pset.add_qto", f, product=sp, name="Qto_SpaceBaseQuantities")
        api.run("pset.edit_qto", f, qto=qto, properties={"NetFloorArea": round(rw * (D - 2 * T), 2), "Height": H - 0.25})
        pset(sp, "MU_Pasport", {"KodPodlazi": sn, "KodMistnosti": f"{lvl}.0{k + 1}", "Ucel": long_name})
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

# ---- georeference: IfcMapConversion → S-JTSK (EPSG:5514), výšky Bpv ----
GEO = os.environ.get("GEO", "mapconv")  # mapconv | pset | none
if GEO != "none":
    import math
    from pyproj import Transformer
    E0, N0, H0 = -598420.0, -1160640.0, 231.5      # Brno, S-JTSK / Bpv
    theta = math.radians(18.0)                      # natočení osy x projektu vůči ose E mapy
    to_wgs = Transformer.from_crs(5514, 4326, always_xy=True)
    to_map = Transformer.from_crs(4326, 5514, always_xy=True)
    lon, lat = to_wgs.transform(E0, N0)
    # konvergence poledníků je vlastnost zobrazení: počítáme v zeměpisných souřadnicích S-JTSK (Bessel), bez transformace datumu
    to_geo = Transformer.from_crs(5514, 4156, always_xy=True)
    from_geo = Transformer.from_crs(4156, 5514, always_xy=True)
    glon, glat = to_geo.transform(E0, N0)
    qe, qn = from_geo.transform(glon, glat + 0.0005)
    vx, vy = qe - E0, qn - N0
    L = math.hypot(vx, vy); vx, vy = vx / L, vy / L
    # skutečný sever v lokálních souřadnicích (R(-theta) · v)
    tnx = vx * math.cos(theta) + vy * math.sin(theta)
    tny = -vx * math.sin(theta) + vy * math.cos(theta)
    ctx.TrueNorth = f.createIfcDirection((tnx, tny))

    def dms(deg):
        sign = -1 if deg < 0 else 1
        deg = abs(deg)
        d = int(deg); m = int((deg - d) * 60); sec = (deg - d - m / 60) * 3600
        s_ = int(sec); mic = int(round((sec - s_) * 1e6))
        return [sign * d, sign * m, sign * s_, sign * mic]
    site.RefLatitude = dms(lat)
    site.RefLongitude = dms(lon)
    site.RefElevation = H0
    metre = [u for u in f.by_type("IfcSIUnit") if u.UnitType == "LENGTHUNIT"][0]
    if GEO == "mapconv":
        crs = f.createIfcProjectedCRS("EPSG:5514", "S-JTSK / Krovak East North", "S-JTSK", "Bpv", None, None, metre)
        f.createIfcMapConversion(ctx, crs, E0, N0, H0, math.cos(theta), math.sin(theta), 1.0)
    else:  # IFC2x3 styl: ePSet_MapConversion / ePSet_ProjectedCRS na IfcProject
        pset(project, "ePSet_MapConversion", {"Eastings": E0, "Northings": N0, "OrthogonalHeight": H0,
                                               "XAxisAbscissa": math.cos(theta), "XAxisOrdinate": math.sin(theta), "Scale": 1.0})
        pset(project, "ePSet_ProjectedCRS", {"Name": "EPSG:5514", "Description": "S-JTSK / Krovak East North",
                                              "GeodeticDatum": "S-JTSK", "VerticalDatum": "Bpv"})

f.write(out)
print("ok", len(f.by_type("IfcProduct")))

"""
Calibration model generator for DesignCAD.
Produces binary STL files for test types not available via open-licensed GitHub repos.

Generated models:
  flow-rate.stl          — 30×30×3 mm flat cube  (Ellis EM top-surface method)
  first-layer.stl        — 120×120×0.3 mm patch   (single-layer first-layer calibration)
  temperature-tower.stl  — 9-floor U-bridge + three overhang fins (30°/45°/60°) per floor
  retraction.stl         — two tapered cone posts on base  (stringing / retraction test)
  max-volumetric-speed.stl — tall open-top tube  (vase-mode MVS ramp test)

Also converts the ASCII Klipper input-shaper STL to binary for faster loading.
"""

import math
import struct
import pathlib

OUT = pathlib.Path(__file__).parent


# ── STL helpers ───────────────────────────────────────────────────────────────

def _cross(a, b):
    return (
        a[1]*b[2] - a[2]*b[1],
        a[2]*b[0] - a[0]*b[2],
        a[0]*b[1] - a[1]*b[0],
    )

def _sub(a, b):
    return (a[0]-b[0], a[1]-b[1], a[2]-b[2])

def _norm(v):
    mag = math.sqrt(v[0]**2 + v[1]**2 + v[2]**2)
    return (v[0]/mag, v[1]/mag, v[2]/mag) if mag > 1e-12 else (0., 0., 1.)

def facet(v0, v1, v2):
    """Triangle with auto-computed outward normal (CCW winding = outward)."""
    return (_norm(_cross(_sub(v1, v0), _sub(v2, v0))), v0, v1, v2)

def write_stl(path, tris, name="calibration"):
    hdr = name.encode("ascii")[:80].ljust(80, b"\0")
    with open(path, "wb") as f:
        f.write(hdr)
        f.write(struct.pack("<I", len(tris)))
        for n, v0, v1, v2 in tris:
            f.write(struct.pack("<fff", *n))
            f.write(struct.pack("<fff", *v0))
            f.write(struct.pack("<fff", *v1))
            f.write(struct.pack("<fff", *v2))
            f.write(struct.pack("<H", 0))


# ── Primitive builders ────────────────────────────────────────────────────────

def box(x0, y0, z0, x1, y1, z1):
    """12 triangles for a solid axis-aligned box (CCW winding per face)."""
    return [
        # -Z  (normal down)
        facet((x0,y0,z0), (x1,y1,z0), (x1,y0,z0)),
        facet((x0,y0,z0), (x0,y1,z0), (x1,y1,z0)),
        # +Z  (normal up)
        facet((x0,y0,z1), (x1,y0,z1), (x1,y1,z1)),
        facet((x0,y0,z1), (x1,y1,z1), (x0,y1,z1)),
        # -Y  (normal front)
        facet((x0,y0,z0), (x1,y0,z0), (x1,y0,z1)),
        facet((x0,y0,z0), (x1,y0,z1), (x0,y0,z1)),
        # +Y  (normal back)
        facet((x0,y1,z0), (x1,y1,z1), (x1,y1,z0)),
        facet((x0,y1,z0), (x0,y1,z1), (x1,y1,z1)),
        # -X  (normal left)
        facet((x0,y0,z0), (x0,y0,z1), (x0,y1,z1)),
        facet((x0,y0,z0), (x0,y1,z1), (x0,y1,z0)),
        # +X  (normal right)
        facet((x1,y0,z0), (x1,y1,z1), (x1,y0,z1)),
        facet((x1,y0,z0), (x1,y1,z0), (x1,y1,z1)),
    ]

def frustum(cx, cy, z0, z1, r0, r1, sides=16):
    """
    Solid truncated cone (frustum).
    r0 = bottom radius, r1 = top radius.
    Vertices go CCW when viewed from above for correct outward normals.
    """
    def pb(i): return (cx + r0*math.cos(2*math.pi*i/sides),
                       cy + r0*math.sin(2*math.pi*i/sides), z0)
    def pt(i): return (cx + r1*math.cos(2*math.pi*i/sides),
                       cy + r1*math.sin(2*math.pi*i/sides), z1)

    tris = []
    cb = (cx, cy, z0)
    ct = (cx, cy, z1)
    for i in range(sides):
        j = (i + 1) % sides
        # Side walls — outward normal: CCW when viewed from outside
        tris.append(facet(pb(i), pt(i),  pt(j)))
        tris.append(facet(pb(i), pt(j),  pb(j)))
        # Bottom cap — normal points -Z: CCW when viewed from below
        tris.append(facet(cb,    pb(j),  pb(i)))
        # Top cap — normal points +Z: CCW when viewed from above
        tris.append(facet(ct,    pt(i),  pt(j)))
    return tris


# ── Overhang fin (triangular prism on +Y face of back wall) ──────────────────
#
# angle_from_horiz: 30° = easy, 45° = moderate, 60° = challenging.
# The fin starts at z_start (partway up a floor) and reaches z_top,
# overhanging outward in +Y by  (z_top − z_start) × tan(angle).

def overhang_fin(x0, x1, y_wall, angle_deg, z_start, z_top):
    """
    Triangular prism overhang fin anchored at y=y_wall.
    Extends tan(angle_deg°) × height mm outward in +Y at z=z_top.
    """
    ext = math.tan(math.radians(angle_deg)) * (z_top - z_start)
    y_tip = y_wall + ext

    # Six vertices
    BL  = (x0, y_wall, z_start)   # bottom-left  attach
    BR  = (x1, y_wall, z_start)   # bottom-right attach
    TL  = (x0, y_wall, z_top)     # top-left  (back edge, vertical)
    TR  = (x1, y_wall, z_top)     # top-right
    OL  = (x0, y_tip,  z_top)     # overhang tip left
    OR_ = (x1, y_tip,  z_top)     # overhang tip right

    return [
        # Left end cap  (-X normal) — CCW from -X: BL→OL→TL
        facet(BL, OL,  TL),
        # Right end cap (+X normal) — CCW from +X: BR→TR→OR
        facet(BR, TR,  OR_),
        # Vertical back face (-Y normal) — CCW from -Y: BL→TR→TL, BL→BR→TR
        facet(BL, TR,  TL),
        facet(BL, BR,  TR),
        # Top flat face (+Z normal) — CCW from +Z: TL→OL→OR→TR
        facet(TL, OL,  OR_),
        facet(TL, OR_, TR),
        # Sloped underface (the overhang printability surface):
        # normal points downward-outward; CCW when viewed from outside-below
        facet(BL, OR_, OL),
        facet(BL, BR,  OR_),
    ]


# ── 1. Flow rate — 30×30×3 mm flat cube (Ellis EM top-surface method) ─────────

def gen_flow_rate():
    tris = box(0, 0, 0, 30, 30, 3)
    write_stl(OUT / "flow-rate.stl", tris,
              "Ellis EM Cube 30x30x3mm - top surface extrusion multiplier")
    print(f"  flow-rate.stl            {len(tris):>4} tris   30×30×3 mm")


# ── 2. First layer — 120×120×0.3 mm flat patch ────────────────────────────────

def gen_first_layer():
    tris = box(0, 0, 0, 120, 120, 0.3)
    write_stl(OUT / "first-layer.stl", tris,
              "First Layer Patch 120x120x0.3mm - Z offset calibration")
    print(f"  first-layer.stl          {len(tris):>4} tris   120×120×0.3 mm")


# ── 3. Temperature tower — 9-floor U-bridge + 30°/45°/60° fins every floor ───
#
# Floor layout (top view):
#   [LEFT ARM 5mm][  bridge gap 20mm  ][RIGHT ARM 5mm]
#                 [    back wall 30mm               ]
#                 [30°fin][45°fin][60°fin] ← on +Y face
#
# Slicing note: insert a temperature-change script every 10 mm of Z height.

def gen_temperature_tower():
    FLOORS    = 9
    FLOOR_H   = 10.0
    ARM_W     = 5.0      # left/right arm width
    ARM_DEPTH = 15.0     # arm depth from front (bridge gap depth)
    BACK_D    = 5.0      # back wall depth
    TOWER_W   = 30.0     # total width
    Y_WALL    = ARM_DEPTH + BACK_D   # = 20 mm  (outer Y of back wall)

    # Fin config: (x_start, x_end, overhang_angle_from_horizontal)
    FIN_CONFIGS = [
        (0.0,        TOWER_W/3,   30.0),   # gentle — left third
        (TOWER_W/3,  2*TOWER_W/3, 45.0),   # moderate — centre
        (2*TOWER_W/3, TOWER_W,    60.0),   # challenging — right third
    ]
    FIN_START_FRAC = 0.5   # fins start halfway up each floor

    tris = []
    for f in range(FLOORS):
        z0 = f * FLOOR_H
        z1 = z0 + FLOOR_H
        z_fin_start = z0 + FLOOR_H * FIN_START_FRAC

        # Left arm
        tris.extend(box(0,             0, z0, ARM_W,            ARM_DEPTH, z1))
        # Right arm
        tris.extend(box(TOWER_W-ARM_W, 0, z0, TOWER_W,          ARM_DEPTH, z1))
        # Back wall
        tris.extend(box(0, ARM_DEPTH,  z0, TOWER_W, Y_WALL,     z1))

        # Three overhang fins — every floor, graduated angles
        for (fx0, fx1, angle) in FIN_CONFIGS:
            tris.extend(overhang_fin(fx0, fx1, Y_WALL, angle, z_fin_start, z1))

    write_stl(OUT / "temperature-tower.stl", tris,
              "Temp Tower 9-floor 30x20mm 90mm - 30/45/60 overhang fins per floor")
    total_h = FLOORS * FLOOR_H
    print(f"  temperature-tower.stl    {len(tris):>4} tris   30×20×{total_h:.0f} mm  "
          f"({FLOORS} floors × {FLOOR_H:.0f} mm, fins 30°/45°/60° every floor)")


# ── 4. Retraction — two tapered cone posts on a base ─────────────────────────
#
# Frustum cones (wide base → sharp tip) make stringing much more visible than
# blunt cylinders: the string always originates from the narrowest point.
# Base: 60×10×1 mm.  Posts: r_base=3 mm → r_tip=0.4 mm, 35 mm tall, 40 mm apart.

def gen_retraction():
    SIDES   = 20
    BW, BD, BH = 60.0, 10.0, 1.0   # base dims
    R_BASE  = 3.0
    R_TIP   = 0.4
    POST_H  = 35.0
    CY      = BD / 2.0
    X_LEFT  = 10.0
    X_RIGHT = 50.0

    tris = []
    tris.extend(box(0, 0, 0, BW, BD, BH))
    for cx in (X_LEFT, X_RIGHT):
        tris.extend(frustum(cx, CY, BH, BH + POST_H, R_BASE, R_TIP, SIDES))

    write_stl(OUT / "retraction.stl", tris,
              "Retraction Stringing Test - two cone posts 60mm base r3-r0.4 35mm")
    print(f"  retraction.stl           {len(tris):>4} tris   60x10 mm base, "
          f"cones r{R_BASE}-r{R_TIP} {POST_H:.0f}mm")


# ── 5. Max volumetric speed — tall hollow square tube (vase-mode ramp) ────────
#
# Print in vase/spiralise mode.  Ramp external perimeter speed from ~30 mm/s
# to ~150 mm/s over the 80 mm height; under-extrusion marks the MVS limit.

def gen_max_volumetric_speed():
    OW, OH  = 40.0, 40.0   # outer footprint
    WALL    = 1.2
    HEIGHT  = 80.0
    BASE_H  = 0.4          # solid base (2 layers)

    tris = []
    tris.extend(box(0, 0, 0, OW, OH, BASE_H))        # base plate
    tris.extend(box(0,       0,      BASE_H, WALL,      OH,    HEIGHT))  # left wall
    tris.extend(box(OW-WALL, 0,      BASE_H, OW,        OH,    HEIGHT))  # right wall
    tris.extend(box(WALL,    0,      BASE_H, OW-WALL,   WALL,  HEIGHT))  # front wall
    tris.extend(box(WALL,    OH-WALL,BASE_H, OW-WALL,   OH,    HEIGHT))  # back wall

    write_stl(OUT / "max-volumetric-speed.stl", tris,
              "Max Volumetric Speed Tube 40x40x80mm vase-mode ramp test")
    print(f"  max-volumetric-speed.stl {len(tris):>4} tris   40×40×{HEIGHT:.0f} mm tube")


# ── 6. Convert ASCII input-shaper STL → binary (5× smaller, faster preview) ──

def convert_ascii_to_binary(src: pathlib.Path, dst: pathlib.Path, name: str):
    """Parse ASCII STL and write binary STL."""
    tris = []
    with open(src, "r", errors="replace") as f:
        lines = f.readlines()

    i = 0
    n = (0., 0., 1.)
    verts = []
    while i < len(lines):
        tok = lines[i].strip().split()
        if not tok:
            i += 1
            continue
        if tok[0] == "facet" and tok[1] == "normal":
            n = (float(tok[2]), float(tok[3]), float(tok[4]))
            verts = []
        elif tok[0] == "vertex":
            verts.append((float(tok[1]), float(tok[2]), float(tok[3])))
        elif tok[0] == "endfacet":
            if len(verts) == 3:
                tris.append((n, verts[0], verts[1], verts[2]))
            verts = []
        i += 1

    write_stl(dst, tris, name)
    src_kb = src.stat().st_size // 1024
    dst_kb = dst.stat().st_size // 1024
    print(f"  {dst.name:32s} {len(tris):>4} tris   {src_kb} KB → {dst_kb} KB  (binary)")


# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Generating calibration STL files…")
    gen_flow_rate()
    gen_first_layer()
    gen_temperature_tower()
    gen_retraction()
    gen_max_volumetric_speed()

    print("\nConverting ASCII STL files to binary…")
    src = OUT / "input-shaper.stl"
    tmp = OUT / "input-shaper-ascii-backup.stl"
    if src.exists():
        # Back up original, write binary in place
        src.rename(tmp)
        convert_ascii_to_binary(
            tmp, src,
            "Klipper ringing_tower.stl - Klipper3d/klipper GPL-3.0"
        )
        tmp.unlink()

    print("\nDone.")

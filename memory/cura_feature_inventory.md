---
name: Cura 5.12.0 Feature Inventory
description: Complete inventory of UltiMaker Cura 5.12.0 features, settings, plugins, and workflows used as the reference target for DesignCAD slicer parity
type: reference
---

Reference installation: `C:\Program Files\UltiMaker Cura 5.12.0`
Master settings file: `resources/definitions/fdmprinter.def.json` (~416 settings across 17 categories)

---

## Setting Categories (17 total)

### 1. Machine Settings (~70 settings)
Build volume (width/depth/height), heated bed/chamber, extruder count/offsets/prime positions, G-code flavor, custom start/end G-code, nozzle diameter/tip/head distance, build plate shape (rectangular/elliptic), speed limits (X/Y/Z/E axes), acceleration (X/Y/Z/E/default), jerk (XY/Z/E), steps per mm, temperature sensors, build volume fan.

### 2. Material (~41 settings)
Print/initial/final temperatures, bed temp, thermal conductivity, cool-down speed, flow/extrusion settings, adhesion tendency, surface energy, shrinkage compensation, density, diameter, temperature-dependent behavior.

### 3. Quality (4 settings)
- Layer height (global + initial layer)
- Line width (global + initial layer)

### 4. Speed (19 settings)
Print speed (global + per-feature), travel speed/acceleration, initial layer speed, skirt/brim speed, Z-hop speed, number of slower layers, flow equalization, acceleration control, travel acceleration.

### 5. Walls/Shell (25 settings)
Wall extruder, wall thickness/line count, outer wall specs, inner wall settings, wall transition (length/angle/distribution), alternate wall directions, minimum wall line width, wall ordering, outer wall inset and wipe distance.

### 6. Top/Bottom (29 settings)
Top/bottom thickness/extruder, surface skin layers (top+bottom), top/bottom patterns, line directions, connect polygons, monotonic ordering, small area handling, bridge settings (density/fan/flow/lines), surface skin pattern variations.

### 7. Infill (29 settings)
Extruder selection, density (0–100%), patterns (grid, honeycomb, lightning, cubic, tetrahedral, octagon, triangles, trihexagon, cross, quarter cubic, etc.), line directions/multiplier, overlap %, connection options, cubic subdivision, sparse density, extra wall count, randomization.

### 8. Build Plate Adhesion (44 settings)
Type (None/Skirt/Brim/Raft), skirt (height/distance/line count), brim (width/distance/location/line count), raft (thickness/speed/layers), prime blob, extruder priming positions, brim-replaces-support.

### 9. Support (58 settings)
Enable/disable, extruder selection, structure type (Tree/Linear/Grid), branch diameter/angle, trunk diameter, placement (Everywhere/Touching Buildplate), support wall config, support base, infill patterns/density, Z seam, support ceiling/floor, max overhang angle, support offset, tree-specific settings (branch angle/density).

### 10. Travel (23 settings)
Enable retraction, retraction distance/speed, retraction at layer change, extra prime amount, minimum travel distance, max retraction count, combing mode (Off/All/Not in Skin/Infill), comb distance, avoid printed parts/supports while traveling, retract before outer wall, wipe settings.

### 11. Cooling (13 settings)
Enable print cooling, fan speed control (initial/regular/max), fan speed at height/layer, build volume fan, min layer time, min speed during slow layers, lift head during cooling, small layer temp adjustment, cooling during extruder switch.

### 12. Dual Extrusion (28 settings)
Prime tower (enable/type/sizing/position/base), wipe inactive nozzle, prime tower ooze shield, temp offset for secondary extruder, ooze protection, tool change settings, nozzle offset mapping.

### 13. Mesh Fixes (16 settings)
Union overlapping volumes, remove all holes, extensive stitching, keep disconnected faces, merged mesh overlap compensation, remove mesh intersection, alternate mesh removal, remove empty first layers, maximum resolution, max travel resolution, max deviation, fluid motion.

### 14. Special Modes / Black Magic (15 settings)
Print Sequence (All at once / One at a time), Infill Mesh, Cutting Mesh, Mold (angle/roof), Support Mesh, Anti-Overhang Mesh, Surface Mode (normal/surface/both), Spiralize Outer Contour (vase mode), mesh processing rank.

### 15. Experimental (87 settings)
Slicing tolerance, infill travel optimization, flow temperature graph, draft shield (height/distance/limitation), make overhang printable, support chunks/breaking, cross fill density variations, fuzzy skin, model angle/overhang handling, skin removal optimization, print head position limits, and 60+ more.

### 16. Print Process Reporting (7 settings)
Flow warning/limit, print temperature warning/limit, build volume temperature warning/limit.

### 17. Command Line (5 settings)
Center object, mesh positioning (X/Y/Z), mesh rotation matrix.

---

## Major UI Features & Workflows

**Three Workstages:**
1. Prepare — model loading, positioning, setting configuration
2. Preview — layer-by-layer visualization
3. Monitor — live print monitoring

**Key UI Components:**
- 3D viewport with model manipulation (rotate/scale/translate)
- Collapsible settings sidebar
- Object selector + multi-object management
- Extruder selector
- Profile management and switching
- Per-object / per-mesh settings override
- Quick settings access

---

## File Formats

**Input:** STL, 3MF, AMF, X3D, OBJ, Image (2D→3D), UFP, GCode, GCode.gz, Cura profiles, legacy profiles
**Output:** GCode, GCode.gz, 3MF, UFP, Makerbot, Cura profiles

---

## Notable Built-in Plugins (40+)

- **Processing:** PerObjectSettingsTool, PaintTool (paint settings on surfaces), SupportEraser, PostProcessingPlugin (G-code scripts)
- **Views:** SolidView, PreviewStage, SimulationView (filament color), XRayView
- **File I/O:** TrimeshReader, 3MFReader/Writer, GCodeReader/Writer, ImageReader, UFPReader/Writer, AMFReader
- **Hardware:** USB Printing, UM3NetworkPrinting, RemovableDriveOutputDevice, FirmwareUpdater
- **Quality:** ModelChecker, SliceInfoPlugin
- **Cloud:** CuraDrive (cloud backup), DigitalLibrary, Marketplace
- **Backend:** CuraEngineBackend (the actual slicing engine — separate CuraEngine binary)

---

## Advanced Features (Key Differentiators vs Basic Slicers)

- **Mesh Modifiers** (per-object): Infill Mesh, Cutting Mesh, Mold, Support Mesh, Anti-Overhang Mesh
- **Tree Support** — branch-based support with configurable angles and diameters
- **Adaptive Layers** — variable layer height based on model geometry
- **Bridge Printing** — special settings for horizontal spans
- **Fuzzy Skin** — random surface texture
- **Draft Shield** — heated enclosure simulation
- **Combing** — intelligent non-print travel (avoids crossing perimeters/skin)
- **Ironing** — top surface smoothing pass
- **Spiralize (Vase Mode)** — single continuous wall spiral
- **Surface Mode** — print shell only without infill
- **One-at-a-Time** — sequential single-object printing
- **Multi-Extrusion** — prime tower, wipe shield, per-extruder temps
- **Pressure Advance / Linear Advance** — via PostProcessingPlugin

---

## Infill Patterns (Full List)
Grid, Lines, Triangles, Cubic, Gyroid, Honeycomb, Lightning, Concentric, Cross, Cross 3D, Quarter Cubic, Octet, Tri-Hexagon, Zigzag, Tetrahedral, Cubic Subdivision (16 total)

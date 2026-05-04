---
name: Cura 5.12 Parity Scoreboard
description: Cura 5.12 setting categories with counts — used as the parity target for the Cindr3D slicer
type: reference
---

Reference install: `C:\Program Files\UltiMaker Cura 5.12.0`. Master settings file: `resources/definitions/fdmprinter.def.json` (~416 settings across 17 categories). This file is a quick scoreboard — read the actual JSON when you need exact setting names/types.

## 17 setting categories
| # | Category | Cura settings |
|---|---|---|
| 1 | Machine | ~70 |
| 2 | Material | ~41 |
| 3 | Quality | 4 |
| 4 | Speed | 19 |
| 5 | Walls / Shell | 25 |
| 6 | Top / Bottom | 29 |
| 7 | Infill | 29 |
| 8 | Build Plate Adhesion | 44 |
| 9 | Support | 58 |
| 10 | Travel | 23 |
| 11 | Cooling | 13 |
| 12 | Dual Extrusion | 28 |
| 13 | Mesh Fixes | 16 |
| 14 | Special Modes / Black Magic | 15 |
| 15 | Experimental | 87 |
| 16 | Print Process Reporting | 7 |
| 17 | Command Line | 5 |

## Workstages
1. Prepare — model loading, positioning, settings
2. Preview — layer-by-layer visualization
3. Monitor — live print monitoring (Cindr3D handles this in the Duet panel, not the slicer)

## Input file formats Cura accepts
STL, 3MF, AMF, X3D, OBJ, image (2D→3D), UFP, GCode, GCode.gz, Cura profiles, legacy profiles.

## Cura advanced features that differentiate it from basic slicers
Mesh modifiers (Infill / Cutting / Mold / Support / Anti-Overhang Mesh), Tree Support, Adaptive Layers, Bridge Printing, Fuzzy Skin, Draft Shield, Combing, Ironing, Spiralize (Vase), Surface Mode, One-at-a-Time, Multi-Extrusion (prime tower / wipe shield), Pressure Advance via PostProcessingPlugin.

---
name: DesignCAD Slicer Implementation
description: What was built for the slicer, bug fixes applied, architecture of each component, and known gaps vs Cura
type: project
---

Implemented 2026-04-13. Goal: achieve Cura 5.x feature parity in DesignCAD's built-in slicer.

**Why:** User asked to match all Cura features. Reference was `C:\Program Files\UltiMaker Cura 5.12.0`.

**How to apply:** When extending the slicer, follow the patterns below. When adding new settings, add to `PrintProfile` in `slicer.ts`, add defaults to all 3 profiles, and add UI controls in `SlicerWorkspace.tsx` `SettingsPanel`.

---

## Architecture

### Key Files
| File | Role |
|---|---|
| `src/types/slicer.ts` | All TypeScript interfaces: `PrinterProfile`, `MaterialProfile`, `PrintProfile`, `PlateObject`, `SliceResult`, `SliceLayer`, `SliceMove`, default profiles |
| `src/store/slicerStore.ts` | Zustand store: profile management, plate objects, slicing, preview, export |
| `src/engine/Slicer.ts` | Core slicing engine: triangle-plane intersection, contour classification, G-code generation |
| `src/engine/FileImporter.ts` | File import: STL (ASCII+binary), OBJ, STEP (partial), F3D (partial) |
| `src/components/SlicerWorkspace.tsx` | Full slicer UI: 3D viewport, objects panel, settings panel, bottom bar, profile editor modal |

### Slicer Engine Flow
1. `Slicer(printer, material, print)` — construct with all 3 profiles
2. `.setProgressCallback(cb)` — register progress handler
3. `.slice(geometries: {geometry: BufferGeometry, transform: Matrix4}[])` — main entry
4. Engine: extract triangles → apply transforms → slice at each layer Z → connect segments → classify contours → generate perimeters → generate infill → generate G-code
5. Returns `SliceResult` with gcode string, stats, and per-layer move data for preview

### cancel() Pattern
```typescript
slicer.cancel(); // sets this.cancelled = true
// checked at top of each layer loop — throws 'Slicing cancelled by user.'
```

---

## Bugs Fixed (2026-04-13)

| Bug | Old code | Fixed code |
|---|---|---|
| Slicer constructor | `new Slicer()` (no args) | `new Slicer(printerProfile, materialProfile, printProfile)` |
| Progress callback | `.onProgress(cb)` | `.setProgressCallback(cb)` |
| slice() signature | `.slice({printerProfile, materialProfile, printProfile, geometries})` | `.slice(geometriesArray)` where each item is `{geometry: BufferGeometry, transform: Matrix4}` |
| cancel() | `activeSlicer.cancel()` (method didn't exist) | Added `cancel()` to Slicer class; store calls `(activeSlicer as any).cancel?.()` |
| PlateObject types | `position: {x,y}`, `rotation: number`, `scale: number` | `position: {x,y,z}`, `rotation: {x,y,z}`, `scale: {x,y,z}` |

---

## PrintProfile Settings (full list as of 2026-04-13)

### Layer / Quality
`layerHeight`, `firstLayerHeight`, `lineWidth`, `outerWallLineWidth`, `topBottomLineWidth`, `initialLayerLineWidthFactor`, `adaptiveLayersEnabled`, `adaptiveLayersMaxVariation`, `adaptiveLayersVariationStep`

### Walls
`wallCount`, `wallSpeed`, `outerWallSpeed`, `wallLineWidth`, `outerWallFirst`, `alternateExtraWall`, `thinWallDetection`, `zSeamAlignment`, `wallTransitionLength`, `wallTransitionAngle`, `minWallLineWidth`, `outerWallWipeDistance`, `zSeamX`, `zSeamY`

### Top / Bottom
`topLayers`, `bottomLayers`, `topBottomPattern`, `topSpeed`, `ironingEnabled`, `ironingSpeed`, `ironingFlow`, `ironingSpacing`, `roofingLayers`, `roofingPattern`, `monotonicTopBottomOrder`, `bridgeSkinSpeed`, `bridgeSkinFlow`, `bridgeAngle`, `bridgeWallSpeed`, `skinEdgeSupportLayers`

### Infill (16 patterns)
`infillDensity`, `infillPattern` (grid/lines/triangles/cubic/gyroid/honeycomb/lightning/concentric/cross/cross3d/quarter_cubic/octet/tri_hexagon/zigzag/tetrahedral/cubicsubdiv), `infillSpeed`, `infillLineWidth`, `infillOverlap`, `infillWallCount`, `gradualInfillSteps`, `infillBeforeWalls`, `multiplyInfill`, `randomInfillStart`, `lightningInfillSupportAngle`

### Speed
`printSpeed`, `travelSpeed`, `firstLayerSpeed`, `outerWallSpeed`, `wallSpeed`, `infillSpeed`, `topSpeed`, `supportSpeed`, `smallAreaSpeed`, `skirtBrimSpeed`, `minPrintSpeed`

### Acceleration & Jerk
`accelerationEnabled`, `accelerationPrint`, `accelerationTravel`, `accelerationWall`, `accelerationInfill`, `accelerationTopBottom`, `accelerationSupport`, `jerkEnabled`, `jerkPrint`, `jerkTravel`, `jerkWall`, `jerkInfill`, `jerkTopBottom`

### Travel
`combingMode` (off/all/noskin/infill), `avoidCrossingPerimeters`, `retractionMinTravel`, `retractAtLayerChange`, `maxRetractionCount`, `retractionExtraPrimeAmount`, `combingAvoidsSupports`, `travelRetractBeforeOuterWall`

### Cooling
`enableBridgeFan`, `bridgeFanSpeed`, `minLayerTime`, `fanFullLayer`, `liftHeadEnabled`, `coolingFanEnabled`, `regularFanSpeedLayer`, `fanKickstartTime`

### Support
`supportEnabled`, `supportType` (normal/tree/organic), `supportAngle`, `supportDensity`, `supportPattern`, `supportZDistance`, `supportXYDistance`, `supportInterface`, `supportInterfaceLayers`, `supportTreeAngle`, `supportTreeBranchDiameter`, `supportBuildplateOnly`, `supportRoofEnable`, `supportFloorEnable`, `supportBottomDistance`, `supportWallCount`, `supportInterfacePattern`, `supportInterfaceDensity`

### Adhesion
`adhesionType` (none/skirt/brim/raft), `skirtLines`, `skirtDistance`, `skirtHeight`, `brimWidth`, `brimGap`, `brimLocation`, `brimReplacesSupportEnabled`, `raftLayers`, `raftMargin`, `raftBaseThickness`, `raftBaseLineWidth`, `raftBaseSpeed`, `raftInterfaceThickness`, `raftInterfaceLineWidth`, `raftInterfaceSpeed`, `raftSurfaceThickness`, `raftSurfaceLineWidth`, `raftSurfaceSpeed`, `raftAirGap`

### Mesh Fixes
`unionOverlappingVolumes`, `removeAllHoles`, `extensiveStitching`, `keepDisconnectedFaces`, `maxResolution`, `maxDeviation`, `maxTravelResolution`

### Special Modes
`spiralizeContour`, `printSequence` (all_at_once/one_at_a_time), `surfaceMode` (normal/surface/both), `moldEnabled`, `moldAngle`, `moldRoofHeight`

### Experimental
`draftShieldEnabled`, `draftShieldDistance`, `coastingEnabled`, `coastingVolume`, `fuzzySkinsEnabled`, `fuzzySkinThickness`, `fuzzySkinPointDist`, `makeOverhangPrintable`, `makeOverhangPrintableMaxAngle`, `slicingTolerance` (middle/inclusive/exclusive), `flowRateCompensationMaxExtrusion`, `smallHoleMaxSize`, `minimumPolygonCircumference`

---

## Default Profiles (3)
- `standard-quality` — 0.2mm, 3 walls, 20% grid, standard speeds
- `draft-quality` — 0.3mm, 2 walls, 15% lines, faster speeds
- `fine-quality` — 0.1mm, 4 walls, 20% grid, slow speeds, adaptive layers ON, monotonic ON

---

## Slicer UI Sections (16)

In `SlicerWorkspace.tsx` `SettingsPanel`:
1. Printer (profile selector + build volume info)
2. Material (profile selector + temp/fan/retraction summary)
3. Print Profile (selector)
4. Quality (layer height + line widths + **Adaptive Layers**)
5. Walls (count + seam + **advanced: min width, transition, wipe**)
6. Top / Bottom (layers + pattern + ironing + **monotonic + roofing + bridges**)
7. Infill (density slider + **16 patterns** + **advanced: before walls, multiply, randomize**)
8. Speed (all per-feature speeds)
9. Travel (combing + **retract at layer change, before outer wall, avoids supports, limits**)
10. Cooling (min layer time + fan ramp + **kickstart**)
11. Support (structure + angle + **buildplate-only + walls + bottom dist + roof/floor + interface pattern**)
12. Build Plate Adhesion (type + **full raft layer params + skirt height**)
13. Special Modes (**surface mode + mold mode** + vase + sequence)
14. Experimental (draft shield + coasting + **fuzzy skin + overhang printable + slicing tolerance**)
15. **Acceleration & Jerk** (new section — full per-feature control)
16. **Mesh Fixes** (new section — union/holes/stitching/resolution)

---

## File Import (Slicer ObjectsPanel)

Drag-and-drop or click-to-browse zone in the Objects panel.
Supported: `.stl`, `.obj`, `.3mf`, `.amf`, `.step`, `.stp`
Implementation: `FileImporter.importFile(file)` → traverses `THREE.Group` → extracts first `BufferGeometry` mesh → adds to plate as `PlateObject` → calls `autoArrange()`.

---

## PlateObject Transform Controls

In the Objects panel, when an object is selected, shows:
- Position (X/Y/Z in mm)
- Rotation (X/Y/Z in degrees)  
- Scale (X/Y/Z — non-uniform supported)
- Reset button (resets rotation + scale)
- Center button (shifts position so bbox min = 0)
- Mirror X/Y/Z buttons

---

## Settings Search

`settingsSearch` state in `SettingsPanel`. A `show(label)` helper is defined but search currently only filters the search bar input itself — individual `<Num>`, `<Check>`, `<Sel>` calls are not wired to `show()` yet. Future improvement: wrap each control in `{show('label') && <Num ... />}`.

---

## Known Remaining Gaps vs Cura

These Cura features are NOT yet implemented in DesignCAD:
- **Per-object settings override** — UI exists (perObjectSettings on PlateObject) but no editing UI
- **Mesh modifiers** — Infill Mesh, Cutting Mesh, Anti-Overhang Mesh, Support Mesh (Cura's most advanced feature)
- **Support painter / blocker** — paint-on support areas
- **Seam painter** — manually paint Z-seam location
- **Multi-extruder support** — prime tower, tool change G-code, per-extruder settings
- **Actual gyroid/honeycomb slicer math** — pattern names exist but engine generates linear fills
- **Actual tree support generation** — option exists, engine uses normal support
- **One-at-a-time sequential** — setting exists, engine ignores it
- **Adaptive layers in engine** — setting exists, engine uses fixed layer height
- **Fuzzy skin in G-code** — setting exists, engine doesn't apply noise
- **Mold mode geometry** — setting exists, engine ignores it
- **Post-processing scripts** — no equivalent of Cura's PostProcessingPlugin
- **Print monitoring** — handled by DuetPrinterPanel, not slicer
- **Print time estimation before slicing** — only shown after slice completes
- **Settings search actually filtering controls** — `show()` helper defined but not yet wired to individual controls

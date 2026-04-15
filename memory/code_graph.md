---
name: DesignCAD Code Graph
description: Map of every important file, what it does, and what it depends on — read this BEFORE launching Explore agents to find files
type: project
---

A flat lookup table for the codebase. **Read this first** when you need to know "where is X" or "what file owns Y" — it removes the need for an Explore pass for almost every "where lives" question. Update when files move or major new modules are added.

**How to apply:** When planning a change, look up the relevant component / store / engine method here, then go straight to the file. Only fall back to a fresh Explore agent if the question is about NEW code that isn't in this map.

---

## Component folders (since the 2026-04 reorganization)

```
src/components/
├── viewport/   — 3D canvas, gizmos, sketch interaction, measure, plane selector, extrude tool
├── toolbar/    — Fusion 360-style ribbon toolbar (single huge file)
├── panels/     — Browser tree, parameters, tool panel, timeline, status bar
├── dialogs/    — Modal dialogs (Export, Extrude legacy, Feature dialogs)
├── slicer/     — Slicer workspace + G-code preview
└── printer/    — All Duet/printer files (13 files)
```

`App.tsx` lives at `src/App.tsx` (NOT in components/) — imported by `main.tsx`.

## Key files by responsibility

### State (Zustand stores)
- `src/store/cadStore.ts` — design state. Persists to IndexedDB `dzign3d-cad`. Has sketches, features, parameters, tool state, extrude, revolve, measure, form state. Form state: `formBodies: FormCage[]`, `activeFormBodyId`, `formSelection`. Actions: `addFormBody`, `removeFormBody`, `setActiveFormBody`, `setFormSelection`, `deleteFormElements` (D167).
- `src/store/slicerStore.ts` — slicer state (plate, profiles, slicing). IndexedDB persistence pattern is the reference template — see `idbStorage` adapter and `serializeGeom`/`deserializeGeom`.
- `src/store/printerStore.ts` — Duet3D connection (localStorage `dzign3d-duet-config`).
- `src/store/themeStore.ts` — theme tokens (localStorage `dzign3d-theme`).
- `src/store/componentStore.ts` — assembly tree (NOT yet persisted).

### Geometry engine
- `src/engine/GeometryEngine.ts` — single source of truth for sketch + extrude geometry. Key statics:
  - `getPlaneAxes(plane)` — t1/t2 for named planes (XY/XZ/YZ)
  - `computePlaneAxesFromNormal(normal)` — t1/t2 for arbitrary normal
  - `getSketchAxes(sketch)` — handles named AND custom planes (PREFER this over `getPlaneAxes` when you have the full Sketch)
  - `getPlaneRotation(plane)` — Euler rotation for named-plane meshes
  - `getSketchExtrudeNormal(sketch)` — world extrude direction
  - `getSketchProfileCentroid(sketch)` — world centroid of profile
  - `createSketchProfileMesh(sketch, material)` — flat profile mesh for picking
  - `createSketchGeometry(sketch)` — line-art group for the sketch
  - `extrudeSketch(sketch, distance)` — extrudes; routes to `extrudeCustomPlaneSketch` for `'custom'`
  - `revolveSketch(sketch, angle, axis)`
  - `entitiesToShape(entities, proj)` — 2D `THREE.Shape` builder, takes a projection function
  - Module-level shared materials: `SKETCH_MATERIAL`, `CONSTRUCTION_MATERIAL`, `CENTERLINE_MATERIAL`, `EXTRUDE_MATERIAL` — **NEVER dispose these**.
- `src/engine/SubdivisionEngine.ts` — Catmull-Clark subdivision kernel (D139). Key statics:
  - `subdivide(cage, levels)` → smooth `THREE.BufferGeometry` (N rounds of CC)
  - `cageWireframe(cage)` → LineSegments-compatible geometry for control cage display
  - `catmullClarkStep(mesh)` — one CC step: face points, edge points, updated vertices, quad split
  - `createBoxCageData(w, h, d, idPrefix?)` — generates a 6-quad box control cage
  - Internal `CCMesh` type: `{ positions: Float32Array, vertexCount, faces: number[][] }`
- `src/engine/Slicer.ts`, `GCodeGenerator.ts`, `FileImporter.ts`, `STLExporter.ts` — slicer / IO.

### Viewport (`src/components/viewport/`)
- `Viewport.tsx` (~215 lines) — orchestrator; imports scene and interaction components. Previously the giant file but split in 2026-04. Also imports `LoftPanel` (added by other agent) and `FormBodies`.
- `FormInteraction.tsx` — Form workspace tool interactions (D140, D152–D167). Returns null from R3F; handles keyboard Delete (D167), canvas click for form-box placement (D140) via `SubdivisionEngine.createBoxCageData` + `addFormBody`, and form-edit/form-delete stubs. Status messages for all 28 form tools.
  - `SceneTheme`, `WorldAxes`, `GroundPlaneGrid`, `SketchPlaneGrid`
  - `SketchGeometry`, `SketchRenderer` — render committed sketches; key includes `entities.length` to force remount
  - `ExtrudeItem`, `RevolveItem`, `ExtrudedBodies` — render features; tag meshes `userData.pickable = true`
  - `ImportedModels` — tags imported meshes pickable
  - `FormBodies` (`scene/FormBodies.tsx`) — renders FormCage bodies: smooth Catmull-Clark mesh (orange, semi-transparent) + cage wireframe. Geometries rebuilt via `useMemo` on cage change, disposed via `useEffect`. Uses per-instance materials (NOT shared module-level). Active body gets brighter highlight. Only mounts when form tools active or bodies exist.
  - `SketchPlaneIndicator` — translucent plane behind the active sketch
  - `SketchPlaneSelector` — origin-plane selector + face raycasting (face-based sketches)
  - `SketchInteraction` — sketch tool click/preview/keyboard handlers; calls `getSketchPlane()`, uses `GeometryEngine.getSketchAxes(activeSketch)`
  - `MeasureInteraction` — measure tool 3D component
  - `ShiftMiddlePan`, `CameraController` — camera control
  - The export default `Viewport` — the Canvas + all child renders
  - Module-level constant `FACE_RING_POSITIONS` — pre-built unit-circle for face highlight
- `ViewCube.tsx` — orientation cube overlay (separate Canvas)
- `CanvasControls.tsx` — bottom-right control bar (grid, snap toggles)
- `SketchPalette.tsx` — Fusion 360-style sketch options floating panel
- `MeasurePanel.tsx` — measure results floating panel
- `ExtrudeTool.tsx` — 3D extrude picker + drag gizmo + live preview. Renders when `activeTool === 'extrude'`. `SketchProfile`, `ExtrudePreview`, `ExtrudeGizmo` sub-components.
- `ExtrudePanel.tsx` — extrude side panel (form). Renders when `activeTool === 'extrude' && extrudeSelectedSketchId !== null`.

### Toolbar
- `src/components/toolbar/Toolbar.tsx` (~1200 lines) — the entire ribbon UI. `RibbonSection`, `ToolButton`, `FlyoutMenuItem`. The ribbon SKETCH section has flyouts for sketch tool variants. Sketch CREATE menu items live in `sketchCreateMenuItems`. The Extrude button calls `handleExtrude()` → `startExtrudeTool()`. Each handler in here typically just calls a store action.

### Panels
- `panels/ComponentTree.tsx` — browser tree (assembly + origin + sketches folder). **Has the rule-of-hooks gotcha** — `editSketch` hook must be called BEFORE any early return. Double-click a sketch row to edit.
- `panels/ParametersPanel.tsx`, `panels/Timeline.tsx`, `panels/StatusBar.tsx`, `panels/ToolPanel.tsx` — secondary panels.

### Dialogs
- `dialogs/FeatureDialogs.tsx` — Shell, LinearPattern, CircularPattern, Mirror, Combine, Hole, ConstructionPlane, Joint dialogs. NO ExtrudeDialog rendered here.
- `dialogs/ExtrudeDialog.tsx` — **legacy / unused**. The current Extrude flow uses `viewport/ExtrudePanel.tsx` and `viewport/ExtrudeTool.tsx`, NOT this file. Safe to ignore unless explicitly asked about it.
- `dialogs/ExportDialog.tsx` — STL/OBJ/STEP export.

### Types
- `src/types/cad.ts` — `Tool` (includes 28 form-* values), `ViewMode`, `SketchPlane`, `Sketch`, `SketchEntity`, `Feature` (FeatureType includes 'form'), `Parameter`, `BooleanOperation`. Also: `FormCage`, `FormVertex`, `FormEdge`, `FormFace`, `FormSelection`, `FormElementType`.
- `src/types/slicer.ts`, `src/types/duet.ts`.

### Utilities
- `src/utils/expressionEval.ts` — parameter expression evaluator.
- `src/utils/theme.ts` — theme token references.

### Services
- `src/services/DuetService.ts`, `OctoPrintService.ts` — printer API clients.

### Project root
- `src/App.tsx` — workspace switching, top-level layout. Imports from new subdirs (`./components/viewport/Viewport`, etc.).
- `src/main.tsx` — React mount.
- `vite.config.ts` — Vite 8 with rolldown.

---

## Common "where do I look?" lookups

| Question | Answer |
|---|---|
| Where is the click handler for sketch tools? | `Viewport.tsx` → `SketchInteraction` component, the `useEffect` registering canvas click listeners |
| Where do I add a new sketch tool? | `cad.ts` `Tool` union + `Toolbar.tsx` ribbon + `Viewport.tsx` `SketchInteraction.handleClick` switch + `useFrame` preview switch |
| Where does the extrude flow start? | `Toolbar.tsx` `handleExtrude` → `cadStore.ts` `startExtrudeTool` |
| Where is the persisted-state schema? | `cadStore.ts` `partialize` (what's saved) + `onRehydrateStorage` (what's restored, including mesh rebuild) |
| Where is the plane-axes math? | `GeometryEngine.ts` `getPlaneAxes` / `getSketchAxes` / `computePlaneAxesFromNormal` |
| Where is the face-raycast for sketch-on-face? | `Viewport.tsx` → `SketchPlaneSelector` component → the `useEffect` with pointermove listeners |
| Where does grid render for active sketch? | `Viewport.tsx` → `SketchPlaneGrid` (handles XY/XZ/YZ + `'custom'` via quaternion) |
| Where is the sketch persistence serialization? | `cadStore.ts` → `serializeSketch` / `deserializeSketch` / `serializeFeature` / `rebuildFeatureMesh` helpers near the top |
| Where do I add a new ribbon button? | `Toolbar.tsx` — find the right `RibbonSection` for the active tab |
| Where does Form body placement happen? | `FormInteraction.tsx` `handleCanvasClick` — `form-box` case calls `SubdivisionEngine.createBoxCageData` + `addFormBody` |
| Where does Form body rendering happen? | `scene/FormBodies.tsx` — reads `formBodies` store, calls `SubdivisionEngine.subdivide(cage, level)` per body |
| Where is the Catmull-Clark kernel? | `src/engine/SubdivisionEngine.ts` — `SubdivisionEngine.subdivide`, `.cageWireframe`, `.catmullClarkStep`, `.createBoxCageData` |
| Where is the Form cage state? | `cadStore.ts` — `formBodies[]`, `activeFormBodyId`, `formSelection`, `addFormBody`, `deleteFormElements` |

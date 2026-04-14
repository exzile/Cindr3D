---
name: DesignCAD Project Architecture
description: Core stack, workspace structure, and key file locations for DesignCAD
type: project
---

DesignCAD is a web-based CAD/slicer/printer-control application built with React 19, TypeScript, Vite, and Three.js. The goal is Fusion 360 feature parity for the UI/UX.

**Why:** User is building a Fusion 360-style CAD tool with integrated 3D slicer and Duet3D printer control.

**How to apply:** Reference these locations when editing or extending any feature.

## Stack
- React 19 + TypeScript, Vite 8 dev server (default port 5173)
- Three.js via `@react-three/fiber` + `@react-three/drei`
- State: Zustand 5.0.12
- Bundler: Vite 8 with rolldown (requires `import type` for interfaces)
- VS 2026 .esproj project with Microsoft.VisualStudio.JavaScript.Sdk/1.0.4338480

## Workspaces (rendered in App.tsx)
- **Design workspace** — `src/components/Viewport.tsx` — 3D canvas with Fusion 360 ribbon toolbar, side panels, sketch tools
- **Slicer workspace** — `src/components/SlicerWorkspace.tsx` — full Cura-style slicer UI with 10 collapsible setting categories
- **Printer panel** — `src/components/DuetPrinterPanel.tsx` — right-side overlay with 6 tabs (Dashboard, Console, Job, Files, Macros, Height Map)
- Workspace switching: `cadStore.workspaceMode` ('design' | 'prepare'), DESIGN/PREPARE dropdown in toolbar

## Key Stores
- `src/store/cadStore.ts` — design state: shapes, tools, sketch plane selection, parameters, camera, workspace settings, grid/snap, visual style
- `src/store/slicerStore.ts` — slicer state: print profiles, material profiles, slicing
- `src/store/printerStore.ts` — Duet3D connection state, machine model, G-code send
- `src/store/themeStore.ts` — light/dark theme with 50+ color tokens, applies CSS custom properties + data-theme attribute to `:root`
- `src/store/componentStore.ts` — assembly component tree hierarchy

## Key Components
- `src/components/Toolbar.tsx` — Fusion 360 ribbon UI: workspace selector, tabbed sections (SOLID/SURFACE/MESH/etc), flyout dropdown menus via React portals
- `src/components/ViewCube.tsx` — 3D orientation cube with clickable faces/edges/corners, axis triad, navigation controls (home, orbit arrows, zoom-fit)
- `src/components/CanvasControls.tsx` — Bottom-right viewport control bar: display settings, grid/snap toggles
- `src/components/ComponentTree.tsx` — Browser panel with component hierarchy, Origin tree (O/X/Y/Z/XY/XZ/YZ), Sketches folder
- `src/components/SketchPalette.tsx` — Fusion 360-style floating sketch options panel (linetype, snap, grid, constraints visibility, etc.)
- `src/components/ToolPanel.tsx` — Draggable floating panel for active sketch tool with instructions and fields

## Sketch Workflow (Fusion 360 style)
1. User clicks Sketch button → enters `sketchPlaneSelecting` mode
2. Three semi-transparent planes (XY/XZ/YZ) appear at origin for selection
3. User clicks a plane → `startSketch(plane)` is called
4. Camera auto-orients to face the selected plane
5. Ribbon switches to SKETCH tab, SketchPalette and ToolPanel appear
6. Browser shows Sketches folder with active sketch highlighted
7. Finish/Cancel buttons in ribbon and palette

## Slicer Feature Parity (as of 2026-04-13)
Implemented Cura 5.x parity across 16 setting sections with ~136 controls:
- File import: STL/OBJ/3MF/AMF/STEP drag-drop or click into slicer ObjectsPanel
- Model transforms: per-object position/rotation/scale/mirror in the objects panel
- Settings search bar in SettingsPanel
- Full Cura setting categories: Quality (+ Adaptive Layers), Walls, Top/Bottom (+ Bridges), Infill (16 patterns), Speed, Travel, Cooling, Support (+ Roof/Floor), Adhesion (+ full Raft layers), Special Modes (+ Mold + Surface Mode), Experimental (+ Fuzzy Skin + Overhang), Acceleration & Jerk, Mesh Fixes
- Bugs fixed: Slicer constructor args, setProgressCallback, slice() geometry format, cancel() method added

## Three.js / R3F Patterns (learned through session)

### Geometry lifecycle — avoid memory leaks
```tsx
function SketchGeometry({ sketch }: { sketch: Sketch }) {
  const group = useMemo(() => GeometryEngine.createSketchGeometry(sketch), [sketch]);
  useEffect(() => {
    return () => {
      group.traverse((obj) => {
        if ((obj as THREE.Line).isLine) (obj as THREE.Line).geometry.dispose();
      });
    };
  }, [group]);
  return <primitive object={group} />;
}
```
- Never dispose shared module-level materials (SKETCH_MATERIAL, EXTRUDE_MATERIAL in GeometryEngine)
- Force remount on entity count change: include `entities.length` in key → `key={`active-${id}-e${entities.length}`}`
- Preview geometry (useFrame): clear group children + dispose geometry each frame before rebuilding
- Stable refs for hot paths: `useRef(new THREE.Vector3())` — no per-frame GC

### Rules of Hooks
Never call hooks after a conditional return. All `useCADStore(...)` calls must precede any `if (!x) return null`.

### R3F / Three.js version
- Three.js r170+ deprecated `THREE.Clock` — R3F 9.5.0 caused warning; fixed in **R3F 9.6.0** (current)
- `<Grid infiniteGrid>` (drei) broken for non-horizontal planes — use `THREE.GridHelper` instead

### GridHelper orientation for sketch planes
```tsx
// XZ (front, Z-normal): group rotation [-PI/2, 0, 0]
// YZ (side, X-normal):  group rotation [0, 0, PI/2]
// XY (floor, Y-normal): group rotation [0, 0, 0] (default)
```

### Sketch plane coordinate system
| Plane | Normal | THREE.Plane | t1 | t2 | Points have |
|---|---|---|---|---|---|
| 'XZ' (front, default) | Z | `(0,0,1)` z=0 | X (1,0,0) | Y (0,1,0) | z=0 |
| 'XY' (floor) | Y | `(0,1,0)` y=0 | X (1,0,0) | Z (0,0,1) | y=0 |
| 'YZ' (side) | X | `(1,0,0)` x=0 | Y (0,1,0) | Z (0,0,1) | x=0 |

Single source of truth: `GeometryEngine.getPlaneAxes(plane)` (public static) — used in both engine and Viewport.tsx.

## Key Utility Files
- `src/utils/theme.ts` — single source of truth for color tokens (CSS var references)
- `src/utils/expressionEval.ts` — parameter expression evaluator (`evaluateExpression`, `resolveParameters`)
- `src/engine/Slicer.ts` — Full slicing engine: triangle intersection, contour connection, polygon offsetting, 8 infill patterns, support generation, G-code output
- `src/engine/GeometryEngine.ts` — sketch geometry creation for Three.js rendering
- `src/services/DuetService.ts` — Duet3D API client (standalone `/rr_*` and SBC `/machine/*` modes)

## Important Types
- `src/types/cad.ts` — `Tool`, `ViewMode`, `SketchPlane` ('XY'|'XZ'|'YZ'|'custom'), `Sketch`, `SketchEntity`, `Feature`, `Parameter`
- `src/types/slicer.ts` — `PrintProfile` with 40+ Cura-style settings fields
- `src/types/duet.ts` — Comprehensive Duet3D object model types

## Build & Project Files
- `DesignCAD.slnx` — VS 2026 solution file (.slnx format)
- `DesignCAD.esproj` — JavaScript project, SDK version 1.0.4338480
- `.vscode/launch.json` — Edge/Chrome debug launch configs for F5
- `.claude/launch.json` — Preview server config (npx vite --port 5174)
- `vite.config.ts` — Vite 8 config

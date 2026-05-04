---
name: Cindr3D Code Graph
description: Where the durable architectural anchors live — read before exploring. Granular file paths shifted in the 2026-04 refactor; use Glob for live locations.
type: project
---

**Read this first** for "where is X" questions, then run a targeted `Glob`/`Grep` for the live file. The 2026-04 refactor moved many monoliths into shim+subdir form, so granular file paths shift; the architectural anchors below stay stable.

## Workspace layout (stable anchors)

- `src/components/` — `viewport/`, `toolbar/`, `panels/`, `dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`, `slicer/`, `printer/`
- `src/engine/` — `geometryEngine/{core,operations}/` (real code; `engine/GeometryEngine.ts` is a 2-line shim), `slicer/{geometry,pipeline,gcode}/` (real code; `engine/Slicer.ts` was removed, `engine/slicer/Slicer.ts` is a tiny `SlicePipeline` subclass), `SubdivisionEngine.ts` (Catmull-Clark for Form workspace)
- `src/store/` — Zustand stores: `cadStore`, `slicerStore`, `componentStore`, `printerStore`, `themeStore`. Each big store is now a shim that composes per-area slices/actions in a `<store>/` subdir. **Never put new logic in the shim.**
- `src/types/` — fragmented `*.types.ts` files per concern (cad, slicer, duet, picker, settings, sketch-commit, etc.). `cad.ts` and `slicer.ts` are re-exports.
- `src/services/` — `DuetService.ts` façade + `duet/` per-concern modules; `OctoPrintService.ts`. See `auto-memory/duet_service_architecture.md`.
- `src/workers/SlicerWorker.ts` — slicer off-main-thread. Warms WASM modules at boot.
- `src/utils/expressionEval.ts` — parameter expression evaluator.

## Where to add common things

| Need | Where |
|---|---|
| New sketch tool | `types/cad.ts` `Tool` union → `toolbar/Toolbar.tsx` ribbon → `viewport/interaction/sketchInteraction/commitHandlers/<family>.ts` (chain-of-responsibility, see `auto-memory/sketch_interaction_pipeline.md`) |
| New ribbon button | `toolbar/Toolbar.tsx` + per-tab `Ribbon*Tab.tsx` (split files in 2026-04) |
| New dialog | `components/dialogs/<category>/<Name>Dialog.tsx` matching the existing categories |
| New slicer setting | Type in `types/slicer/`, UI in `components/slicer/printProfileSettings/`, engine in `engine/slicer/pipeline/` (and update `slicer_gaps.md` if engine still stubs it) |
| New geometry op | `engine/geometryEngine/core/{mesh,sketch,solid,surface}/` or `operations/meshOps/` — never in the `GeometryEngine.ts` shim |
| New store action | `store/<name>/{slices,actions}/` — never in the store shim |
| New WASM op | See `auto-memory/wasm_patterns.md` |

## Plane-axis math (single source of truth)

`GeometryEngine.getSketchAxes(sketch)` for `t1`/`t2` — handles named planes (XY/XZ/YZ) AND custom. Use this over `getPlaneAxes(plane)` when you have the full Sketch. Raw `p.x, p.y` is wrong on non-XY planes (recurring bug — see `gotchas.md`).

## Persistence schemas

- `cadStore` → IndexedDB `cindr3d-cad`. Schema in `store/cad/persistence.ts` (`partialize` + `onRehydrateStorage`). Mesh rebuild on load. Coordinates with componentStore hydration to avoid double-add on refresh.
- `slicerStore` → IndexedDB. Reference template for `idbStorage` adapter + `serializeGeom`/`deserializeGeom`.
- `printerStore` → localStorage `cindr3d-duet-config`.
- `themeStore` → localStorage `cindr3d-theme`.

## Cross-references

Detailed pipeline docs live under auto-memory at `~/.claude/projects/C--Users-joeyp-source-repos-exzile-Cindr3D/memory/`:
- `project_designcad.md` — fuller architectural snapshot (shim+subdir, store slices, material singletons, persistence caches)
- `extrude_pipeline.md`, `slicer_engine.md`, `arachne_subsystem.md`, `sketch_interaction_pipeline.md`, `duet_service_architecture.md`
- `r3f_critical_patterns.md` — recurring R3F bug catalog
- `wasm_patterns.md` — emsdk adapter gotchas

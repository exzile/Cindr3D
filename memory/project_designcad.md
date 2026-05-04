---
name: Cindr3D Project Overview
description: Non-obvious architecture invariants — shim+subdir pattern, store slices, material singletons, plane-aware math, persistence caches
type: project
originSessionId: 768c4a3e-fc4c-4a2b-ba31-60db44f6dc31
---
Cindr3D (Cindr3D) — Fusion 360-parity CAD in the browser. Work tracked in `TaskLists.txt`. Tests via `npm run test:run`.

## Shim+subdir pattern (post-2026-04 refactor)

Many former monoliths are now 2-30 line re-export shims. **Add new code to the submodule, never to the shim.** Examples: `engine/GeometryEngine.ts`, `engine/Slicer.ts`, `store/{cad,slicer,component,printer}Store.ts`, `App.tsx`, `types/cad.ts`. Real code lives under `engine/geometryEngine/{core,operations}/`, `engine/slicer/{pipeline,geometry,gcode}/`, `store/<name>/{slices,actions}/`, `app/`, `types/<area>.types.ts`. Use `Glob` to find the current locations — they keep evolving.

## Store layout

`useCADStore` is composed of 9 slices in `store/cad/slices/*Slice.ts`; several slices further split into per-area `<slice>/<area>Actions.ts` files (e.g. `extrudeRevolve/extrudeCommitActions.ts`). State types in `state/{coreState,modelingState,analysisState,workflowState}.ts`. Persistence in `persistConfig.ts` + `persistence.ts`. Same pattern for `componentStore`/`printerStore`/`slicerStore` — each has `actions/` + `storeApi.ts` + `persistence.ts`.

## Material singletons — NEVER dispose

Live in 4 places: `viewport/scene/bodyMaterial.ts`, `engine/geometryEngine/materials.ts`, `viewport/extrude/materials.ts`, `store/cad/persistence.ts`. Tag with `userData.shared = true` (use `tagShared()` helper from `geometryEngine/materials.ts`). Disposers must skip these.

## Plane-aware math (recurring bug — fixed 3+ times)

Always `getSketchAxes(sketch)` → `t1`/`t2` dot products. Raw `p.x, p.y` only works on XY plane; breaks silently on XZ/YZ/custom.

## 2D boolean ops

`polygon-clipping` (npm) for 2D planar arrangement; Clipper2 WASM is faster fast-path with polygon-clipping fallback. `computeAtomicRegions(shapes)` in `core/sketch/profileGeometry.ts` splits closed 2D shapes into atomic regions.

## Persistence caches

`store/cad/persistence.ts` exports `serializeFeature`/`deserializeFeature` with two `WeakMap`s: per-geometry mesh-data cache + per-Feature serialized cache. `cadStore.onRehydrateStorage` waits for `componentStore.persist.onFinishHydration` to prevent double-add on refresh.

## Cross-references

Extrude pipeline → `extrude_pipeline.md`. Slicer → `slicer_engine.md`. Arachne (incl. WASM) → `arachne_subsystem.md`. R3F bug patterns → `r3f_critical_patterns.md`.

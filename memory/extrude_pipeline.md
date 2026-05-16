---
name: Extrude Pipeline Architecture
description: Profile flat list + atomic regions, smallest-wins picker, csgIntersect overlap rule, disconnected-body splitting, selection pulse
type: project
originSessionId: 768c4a3e-fc4c-4a2b-ba31-60db44f6dc31
---
Files spread across `engine/geometryEngine/core/{sketch,solid,mesh}/`, `components/viewport/{tools,extrude,scene,panels}/`, and `store/cad/slices/extrudeRevolve/` — use Glob if exact paths matter.

## Profile flat list

`sketchToProfileShapesFlat(sketch)` returns original closed shapes from `entitiesToShapes({nestHoles: false})` PLUS atomic regions from `computeAtomicRegions` (planar arrangement via Clipper2 / polygon-clipping fallback).

**Dedup signature:** outer-ring area + centroid only. A "rectangle-with-holes" atomic region matches the original rectangle → deduped to original. Intentional: `createProfileSketch`'s containment fallback re-nests the inner shapes as holes.

## Picker — `viewport/tools/ExtrudeTool.tsx`

Plain smallest-wins (was cycle-up; user preferred simpler). Normal click → toggles smallest profile under cursor. Alt+click → largest (original containing shape). `meshArea` returns `NaN` for degenerate bboxes — picker skips. Click-vs-drag: pointerdown position in closure; click >5px away → skip.

## Preview rendering

Solid `MeshStandardMaterial` `FrontSide` (user rejected glass-effect MeshPhysical+DoubleSide+transparent). Silhouette edges via `buildExtrudeFeatureEdges` — top/bottom cap outlines + sharp-corner verticals **directly from sketch curves**. Do NOT use `EdgesGeometry(mesh.geometry)` — CSG-subtracted caps have noisy near-coplanar triangulation that breaks edge extraction.

**Two-sides direction special case:** `buildExtrudeFeatureMesh` bakes a CSG-union into world-space identity transform. Two-sides edge path uses `EdgesGeometry` and MUST NOT copy `m.position/quaternion/scale` (they're identity).

## Profile overlays — SketchProfile

ONE animated material per component, cloned at mount. `useFrame` mutates `color`/`opacity` in place per-state — do NOT re-memo material on state change (would re-trigger mesh memo and re-triangulate every hover). `hidden` prop forces opacity 0 while keeping mesh in scene for raycast picking.

## commitExtrude (in `extrudeCommitActions.ts`)

Multi-profile flow: first profile `new-body` creates Body N. 2nd+ profiles with user-selected `new-body` auto-switch to `join`, then run TRUE volumetric overlap test:
1. Bbox pre-filter
2. `csgIntersect(proposedGeomW, existingGeomW)` — **>6 vertices** (more than one triangle) = volumetric overlap → stays `join` (one body)
3. **≤6 vertices** = corner/edge kiss → promoted back to `new-body` (separate body)

## Disconnected pieces → multiple bodies

When extrude geometry has multiple connected components: commit-time `splitByConnectedComponents` → `componentStore.addBody` calls store extras as `feature.params.extraBodyIds`. Render-time splits again with same deterministic centroid sort. When parts > ids (later CSG cut splits a body): fallback to primary bodyId.

## Revolve

`engine/geometryEngine/core/solid/revolve.ts` — `resolveRevolveSweep(angleDeg, angle2Deg, dir) → {phiStart, sweep}` is the SINGLE source of truth for direction modes (one-side 0/a, symmetric −a/2÷a, two-sides −a2÷(a+a2), radians). `revolveSketch`/`revolveFaceBoundary` take an optional trailing `phiStart` (default 0 ⇒ one-side output byte-identical to pre-2026-05; lathe `phiStart` / rotated start+end caps). Exposed via `GeometryEngine.resolveRevolveSweep` + optional `phiStart` on both wrappers; `RevolveDirection` re-exported from `GeometryEngine`. Three callers MUST use the resolver so preview==commit==export: `ExtrudedBodies.RevolveItem` (committed body, reads `feature.params.{direction,angle2}`), `viewport/tools/RevolveTool` (live preview — sketch AND face mode; sketch centerline axis derived from the sketch `centerline` entity, mirroring `commitRevolve` in `extrudeRevolve/revolveActions.ts`), `dialogs/ExportDialog` (STL). RevolveTool runs all hooks before its `activeTool!=='revolve'` early return (hooks-after-return = crash, see gotchas).

**KNOWN GAP (not yet done, intentionally unbundled to avoid a monolithic CSG change):** revolve `operation` join/cut/intersect is a no-op — a committed revolve always renders as its own standalone body via `RevolveItem` and never enters the extrude CSG boolean pipeline. Panel/commit still store `operation`. Next increment: route revolve geometry through the same boolean walk extrude uses.

## Selection highlight (BodyMesh)

When `bodyId === selectedBodyId`, clones material once, animates `emissiveIntensity` at 3 Hz via `useFrame`. Clone disposed on selection change/unmount. Key format `${fId}::${bodyId ?? 'x'}::${i}` — `i` always included so split-part meshes sharing fallback bodyId don't collide in React keys.

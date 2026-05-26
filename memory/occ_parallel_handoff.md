# OCC parallel handoff plan

This file is the Codex-side handoff for the OpenCASCADE migration. OCC-1 through OCC-10 are now complete. See TaskLists.txt for current status.

## Current state (2026-05-24)

All OCC phases complete. The remaining non-OCC CSG usage is for geometry building (extrusion hole subtraction, snap-fit, lip-groove, shell-solid, pipe geometry) — not for boolean commit paths. Join/cut/intersect for extrude, revolve, and sweep all use OCC when targets have `brepBodyId`.

## OCC boolean commit path summary

- `extrudeCommitActions.ts`: new-body uses `occExtrudeWithInstance`; join/cut uses `performOccBooleanWithInstance` against the most recent OCC target. Non-OCC solid targets are rejected instead of rerouting through mesh CSG. Tool body wrapped in `try/finally { disposeBRepBody(toolBody) }` for deterministic C++ cleanup.
- `revolveActions.ts`: new-body uses `occRevolveWithInstance`; sketch-mode join/cut uses OCC boolean (tool body disposed via inner try/finally); face-mode stays on CSG (no OCC tool body).
- `featureCreationSlice.ts` (sweep): new-body uses `occSweepFromPathWireWithInstance` with taperAngle; join/cut via `placeToolFeatureAsync` which now uses OCC boolean when both tool+target have `brepBodyId`.
- `bodyBoolean.ts` (`placeToolFeatureAsync`): OCC boolean path for loft/sweep/pipe/boundary-fill when both meshes have `brepBodyId`; otherwise the operation fails with an OCC-backed target/tool message. Uses existing registry bodies (no temp tool body to dispose).

## Remaining cleanup gates

- OCC-9.3 (delete edgeTopology.ts): blocked — 14 dependents still use mesh edge extraction.
- OCC-9.4 (drop manifold-3d / three-bvh-csg): partially unblocked for CAD booleans, but still blocked for slicer/preview geometry helpers that intentionally use mesh CSG.
- Face-mode revolve boolean: stays on CSG; no OCC tool body is available from face boundary only.

## Historical note

GitNexus notes gathered for this pass:

- `commitExtrude` in `src/store/cad/slices/extrudeRevolve/extrudeCommitActions.ts` fans into profile selection, `GeometryEngine.extrudeSketch`, thin/surface extrudes, CSG workers, bounding-box join checks, and connected-component splitting.
- `addPrimitive` in `src/store/cad/slices/featureManagement/featureCoreActions.ts` is store-local and currently only calls `GeometryEngine.coilGeometry` for coil primitives.
- `extrudeSketch` in `src/engine/geometryEngine/core/solid/extrusion.ts` depends on `entitiesToShapes`, `getRightHandedFrame`, `extrudeCustomPlaneSketch`, and `buildExtrudeGeomHolesAware`.
- `csgSubtract` is small at the public surface, but callers include preview, shelling, profile-hole generation, lip/groove, plate hollowing, fillet cutter generation, and the CSG worker.

No existing function/class/method was edited in this handoff pass, so no symbol impact edit gate was required.

## Branch queue after OCC-1.4

Use one branch per task so the long-running OCC work can merge cleanly.

| Task | Branch | Owner fit | Depends on | Primary files |
| --- | --- | --- | --- | --- |
| OCC-2 prep tests | `codex/occ-contract-tests` | Codex | OCC-1.4 | `src/test/occ*.test.ts` |
| OCC-3.1 box | `codex/occ-box-primitive` | Codex | OCC-2.3 preferred, OCC-1.4 minimum | `src/engine/occ/ops/box.ts` |
| OCC-3.2 cylinder | `codex/occ-cylinder-primitive` | Codex | OCC-2.3 preferred, OCC-1.4 minimum | `src/engine/occ/ops/cylinder.ts` |
| OCC-3.3 extrude | `codex/occ-sketch-extrude` | Codex | OCC-2.3 | `src/engine/occ/ops/extrude.ts`, `sketchToWire.ts` |
| OCC-3.4 revolve | `codex/occ-revolve` | Codex | OCC-3.3 `sketchToWire` | `src/engine/occ/ops/revolve.ts` |
| OCC-3.5 sweep | `codex/occ-sweep` | Codex | OCC-3.3 `sketchToWire` | `src/engine/occ/ops/sweep.ts` |
| OCC-3.6 shell | `codex/occ-shell` | Codex | OCC-2.3, OCC-4 optional | `src/engine/occ/ops/shell.ts` |
| OCC-4.1 subtract | `codex/occ-subtract` | Codex | OCC-2.3 | `src/engine/occ/ops/subtract.ts` |
| OCC-4.2 union | `codex/occ-union` | Codex | OCC-2.3 | `src/engine/occ/ops/union.ts` |
| OCC-4.3 intersect | `codex/occ-intersect` | Codex | OCC-2.3 | `src/engine/occ/ops/intersect.ts` |
| OCC-8.1 face picker | `codex/occ-face-picker` | Codex | OCC-2.3 | viewport picker + tessellation face IDs |
| OCC-8.2 edge picker | `codex/occ-edge-picker` | Codex | OCC-2.4 | viewport picker + edge polylines |
| OCC-8.3 sketch picker | `codex/occ-sketch-plane-picker` | Codex | OCC-8.1 | sketch plane from BRep face |

## OCC-2 contract to hold steady

OCC-2 should provide these stable seams before Codex starts wiring features:

```ts
export interface BRepBody {
  shape: OccHandle<unknown>;
  faceIds: Map<number, OccHandle<unknown>>;
  edgeIds: Map<number, OccHandle<unknown>>;
  vertexIds: Map<number, OccHandle<unknown>>;
  _tessellation?: BRepTessellation;
}

export interface BRepTessellation {
  positions: Float32Array;
  normals: Float32Array;
  faceIds: Uint32Array;
  edgePolylines: Map<number, Float32Array>;
}
```

Recommended additions for app integration:

- `revision`: monotonic integer that changes whenever a new OCC shape replaces the body.
- `sourceFeatureId`: original feature id for timeline/debug correlation.
- `bbox`: derived world-space bounds for lazy tessellation and hit-testing.
- `dispose()`: frees shape, topology handles, and cached tessellation buffers.

The body owns exact topology. Meshes are derived display data and should not become the source of truth now that OCC is the source of truth.

## Integration map

Primitive bodies:

1. Dialog/MCP create a primitive through `addPrimitive`.
2. Feature params store the analytic dimensions and transform.
3. Current render path is `PrimitiveBodies.tsx` with `THREE.BoxGeometry` / `THREE.CylinderGeometry`.
4. OCC path should create `BRepBody` from the same params, tessellate once, and render the derived `BufferGeometry`.
5. Legacy edge-cut rendering was removed; OCC edge rendering is now the only path.

Extrude:

1. `ExtrudeTool` and `ExtrudePanel` select sketch profiles and commit through store state.
2. `commitExtrude` resolves selected profile ids, directions, distance, thin/surface modes, target body participation, and stored feature params.
3. Current geometry is generated by `GeometryEngine.extrudeSketch`, `extrudeThinSketch`, `extrudeSketchSurface`, and CSG worker paths.
4. OCC path should consume the same selected profile index data, convert the chosen `SketchProfile` to wires, make a face with holes, and prism it.
5. For `cut`, `join`, and `intersect`, OCC extrude should produce a tool body and then call OCC-4 booleans.

Revolve:

1. `RevolveTool` and panel state select a sketch/face boundary plus axis.
2. Current path calls `GeometryEngine.revolveSketch` or `revolveFaceBoundary`.
3. OCC path should share `sketchToWire` with extrude, make a face, then call `BRepPrimAPI_MakeRevol`.
4. 360-degree operations must weld closed topology at the BRep level, not by merging tessellated vertices.

Booleans:

1. Public OCC boolean operations should return `BRepBody | null`.
2. OCC boolean callers should return diagnostics on failure; do not add feature-flag or edge-operation fallbacks back to mesh CSG.
3. ID propagation must be owned by each boolean operation via OCC history APIs, not by tessellation.
4. Generated faces from tool bodies should receive fresh ids, with provenance kept in debug metadata where possible.

Selection:

1. Face picks should resolve from `BRepTessellation.faceIds`, one id per triangle.
2. Edge picks should use `edgePolylines`; do not infer analytic edges from triangle boundaries.
3. Sketch-plane picks should build a plane from BRep face geometry when the face is planar.

## Test harness added by Codex

The new tests are intentionally guarded:

- `src/test/occFoundation.todo.test.ts` skips until OCC-1 loader/handle/spike files exist.
- `src/test/occTaskContracts.todo.test.ts` skips each operation until its file exists.
- `src/test/occSupport.test.ts` runs now and covers the shared support helpers below.

## Support functionality added by Codex

These files are ready for Claude/OCC branches to use without taking a dependency on tessellation or booleans yet:

- `src/engine/occ/brepBody.ts`
  - `BRepBody` and `BRepTessellation` contracts.
  - `createBRepBody()` for consistent body ids/revisions.
  - `disposeBRepBody()` to release shape/topology handles, display mesh, and cached tessellation.
  - `invalidateBRepTessellation()` to clear derived display data and bump revision.
- `src/engine/occ/featureFlag.ts` was removed with the legacy `isOccPipelineEnabled()` / `setOccPipelineEnabled()` helpers.
  - OCC is now the only supported edge-modification pipeline.
- `src/engine/occ/heap.ts`
  - `alignByteCount()` for 8-byte-safe heap layouts.
  - `mallocAligned()` for idempotent allocation cleanup.
- `src/engine/occ/topologyIds.ts`
  - `createBRepIdAllocator()` for deterministic face/edge/vertex ids.
  - `assignTopologyIds()` for pointer-based handle maps.
  - `maxTopologyId()` for deriving the next allocator start after importing existing topology.
- `src/engine/occ/bodyRegistry.ts`
  - `BRepBodyRegistry` for feature-to-body lookup and deterministic disposal.
- `src/engine/occ/disposeScope.ts`
  - `OccDisposeScope` and `withOccDisposeScope()` for temporary OCC allocations.
  - Use this inside operations so failure paths free C++ heap objects while released body-owned handles survive.
- `src/engine/occ/plane.ts`
  - `createOccPlaneFrame()` and `createOccPlaneFrameFromSketch()` for sketch profile work.
  - `planePointToWorld()` / `worldPointToPlane()` for sketch wire conversion.
- `src/engine/occ/result.ts`
  - `OccOperationResult`, `occOk()`, `occErr()`, and `occMessage()` for operation diagnostics without throwing through UI code.
- `src/engine/occ/tessellate.ts`
  - `tessellate(oc, body, opts)` for synchronous BRep display tessellation.
  - `tessellateAsync(body, opts)` for callers that only have the singleton loader.
  - `tessellationToGeometry()` and `computeAdaptiveLinearDeflection()` for `BodyMesh`.
- `src/engine/occ/transform.ts`
  - `matrix4ToOccTrsfValues()` and `transformOccShape()` shared by primitive/revolve/sweep operations.
- `src/engine/occ/ops/box.ts`
  - `occBox()` / `occBoxWithInstance()` for OCC-3.1.
- `src/engine/occ/ops/cylinder.ts`
  - `occCylinder()` / `occCylinderWithInstance()` for OCC-3.2.
- `src/engine/occ/ops/subtract.ts`
  - `occSubtract()` / `occSubtractWithInstance()` for OCC-4.1.
- `src/engine/occ/ops/union.ts`
  - `occUnion()` / `occUnionWithInstance()` for OCC-4.2.
- `src/engine/occ/ops/intersect.ts`
  - `occIntersect()` / `occIntersectWithInstance()` for OCC-4.3.
- `src/engine/occ/ops/booleanCore.ts`
  - Shared boolean runner that applies non-destructive mode, optional fuzzy/parallel settings, and routes through Claude's `booleanBase` ID propagation.
- `src/engine/occ/ops/fillet.ts`
  - `occFillet()` / `occFilletWithInstance()` from Claude's OCC-5.1 implementation; Codex lint/type aligned it with the shared contracts.
- `src/engine/occ/ops/chamfer.ts`
  - `occChamfer()` / `occChamferWithInstance()` from Claude's OCC-5.2 implementation; Codex lint/type aligned it with the shared contracts.
- `src/engine/occ/ops/extrude.ts`, `revolve.ts`, `sweep.ts`, `shell.ts`
  - Claude implementations are exported and covered by the guarded operation contract.
  - Codex tightened transient OCC progress/vector wrapper cleanup after the first validation pass.
- `src/engine/occ/ops/sketchToWire.ts`
  - `normalizeClosedLoop2D()`, `signedArea2D()`, and `orientLoop2D()` support OCC-6.2/OCC-6.3.
  - Closed loops now reject degenerate regions before OCC wire creation.
  - Hole loops are oriented opposite the outer loop before face construction.
- `src/engine/occ/geomSurface.ts`
  - `sketchPlaneFromFace()` and `sketchPlaneFromRawFace()` support OCC-6.4.
  - Codex tightened cleanup so wrapped faces and `TopLoc_Location` allocations are released on early returns.
- `src/engine/occ/picking.ts`
  - Tessellation metadata helpers for attaching `BRepTessellation` to meshes.
  - Face-id lookup by raycast triangle index.
  - Face highlight and edge line geometry builders for OCC-8 picker migration.
- `src/hooks/useBodyMesh.ts`
  - OCC-7.1 hook now uses `tessellateAsync()` and returns cached geometry directly instead of setting state synchronously in an effect.
- `src/components/viewport/scene/BodyMesh.tsx`
  - Standalone OCC mesh bridge now attaches tessellation/body metadata for exact face/edge pickers and disposes the latest swapped geometry on unmount.
- `src/engine/occ/featureEvaluator.ts`
  - Standalone OCC-7.2 evaluator cache supports registered feature evaluators, upstream revision tracking, invalidation, and registry-miss rebuilds.
- `src/engine/occ/occSnapshot.ts`
  - OCC-7.3 STEP snapshot helpers have no-loader safety coverage so capture is empty and restore does not clear live registry bodies before OCC is available.
- `src/engine/occ/stepIO.ts`
  - STEP reader/writer cleanup is covered for wrapped shape, writer, reader, temp FS unlink, and progress range disposal paths.
- `src/components/viewport/scene/OccFacePicker.tsx`
  - OCC-gated face picker hook that resolves exact BRep `faceId` values from tessellation.
- `src/components/viewport/scene/OccEdgePicker.tsx`
  - OCC-gated edge picker hook and edge overlay component backed by `edgePolylines`.
- `src/engine/occ/index.ts`
  - Barrel export for the OCC support surface.

Once Claude lands OCC-1.4, run:

```powershell
$env:VITE_RUN_OCC_CONTRACTS='true'
npx vitest run src/test/occFoundation.todo.test.ts src/test/occTaskContracts.todo.test.ts
```

The suite skips by default so in-progress OCC files do not break unrelated branches. Expected first failures with `VITE_RUN_OCC_CONTRACTS=true` are useful contract failures, not repo breakage. Fix the implementation or adjust the test only if the accepted API changed in TaskLists.

## Acceptance checklist for Codex OCC branches

- Run GitNexus impact on every existing symbol before editing it.
- Do not add new `useOccPipeline` branches; use OCC directly for edge-modification work.
- Preserve existing feature params and persistence shape unless an OCC task explicitly changes it.
- Add focused tests next to the guarded contracts before opening a PR.
- Verify `npm run typecheck`, focused Vitest, and `git diff --check`.
- Run `npx gitnexus detect-changes --repo Cindr3D` before committing.

---
name: Slicer Engine Architecture
description: Slicer invariants — pipeline contracts, two-emission-site rule, calcExtrusion-as-method, layer-height contract, scarf seam duality, layerMaterialCache pre-pass + per-region top-skin splitting
type: project
originSessionId: 768c4a3e-fc4c-4a2b-ba31-60db44f6dc31
---
`engine/slicer/` has three subdirs: `geometry/`, `pipeline/` (with `pipeline/execution/{steps,base}/`), `gcode/`. Top-level `Slicer.ts` is a tiny `SlicePipeline` subclass.

## Mesh prep contract

`extractTriangles` orchestrates `weldTriangleVertices` (1µm grid quantise) → `repairTriangleNormals` (BFS over shared-edge neighbours, then top-centroid sanity flip). Repair depends on welding first. Silent on clean meshes.

## Walls — `pipeline/perimeters.ts`

`generatePerimetersEx` returns `GeneratedPerimeters = { walls, lineWidths, outerCount, innermostHoles }` — **don't break this contract**. `wallSets[0]` is outermost outer wall (seam/flow/scarf/fluidMotion/coasting all key off `wallIdx 0`). Outer rings emit first, then holes.

**Two emission sites — any wall change must touch BOTH:** `groupOuterWalls` pre-pass (all contours' outers first) AND main inline path. Grouped pass lives in `execution/steps/emitGroupedAndContourWalls.ts`.

**Arachne-lite** (`thinWallDetection`): when next offset fails, binary-search `[nominal, next]` for largest valid offset and widen `lineWidth`. Sub-nominal centerline branch handles features <1×lineWidth. **Full Arachne** is separate — see `arachne_subsystem.md`.

## Layer-height contract

`const layerH = li === 0 ? layerZs[0] : layerZs[li] - layerZs[li-1]`. **Never use `pp.layerHeight`** for per-layer math — adaptive layers produce variable spacing. Adaptive penalty `2·|nz|·√(1−nz²)` peaks at 45°.

## calcExtrusion is a METHOD, not a free function

`gcode/emitter.ts` `Emitter` class holds `currentLayerFlow` + `flowCompFactor` as fields. Always call `emitter.calculateExtrusion(distance, lineWidth, layerHeight)`. The flow save/override/restore pattern mutates the emitter field.

## Layer-material cache pre-pass

`run.layerMaterialCache: PCMultiPolygon[]` — populated by a sequential pre-pass in `runSlicePipeline.ts` before the main emit loop. Each entry is the fully-transformed material polygon for that layer (including modifier meshes, horizontal expansion, mold mode, shrinkage compensation, elephant-foot). Replaces the old `prevLayerMaterial` field (removed).

**Cache reads** in `prepareLayerState.ts`:
- `previousLayerMaterial = run.layerMaterialCache[li - 1] ?? []` (bridge detection)
- `nextLayerMaterial = run.layerMaterialCache[li + 1]` (top-skin detection)

**Multi-layer top-skin thickening** (`layerTopology.ts`): `topSkinRegion = ∪_{k=0..topLayers-1} (cache[N+k] − cache[N+k+1])` intersected with `currentLayerMaterial`. Controlled by `pp.topLayers` (default 4 in Orca profile). Falls back to single-layer comparison when cache is absent.

**Per-region splitting** (`emitContourInfill.ts`): when `layerMaterialCache` is populated and `topSkinRegion` is non-empty, each infill region is split into `solidPart = intersect(region, topSkinRegion)` and `sparsePart = difference(region, topSkinRegion)`. Solid parts emit as skin, sparse parts as infill. Falls back to layer-wide solid promotion when cache is absent (parallel-worker safety net).

Workers don't receive the cache (`layerMaterialCache: []` in `serializeGeometryRun`). Progress: 0-30% pre-pass, 30-80% emit loop.

## Bridge detection

`bridgeMP = polygon-clipping.difference(currentLayerMaterial, prevLayerMaterial)` = regions over void. Skin scanlines whose midpoint falls in `bridgeMP` get `type: 'bridge'`, `bridgeSkinSpeed`, `bridgeSkinFlow`. Fan flips to `bridgeFanSpeed` on entry, restores on exit/layer end.

## Slicing performance stop point (2026-04-27)

Prepare-path benchmark used during the tuning pass: 200 layers, 135,248 tris. It started around 53s and is currently about 3.0s on the user's machine with 6 layer workers.

Landed changes: native libArachne inner-contour infill regions, per-run Arachne perimeter cache, worker-side contour wall precompute/hydration, interleaved layer batches, extracted mesh/model-bbox cache for repeated unchanged slices, and a large-mesh worker cap of 6. `runSlicePipeline.ts` owns batching/worker-count policy; `SlicerLayerWorker.ts` owns worker Arachne warmup/precompute; `prepareSliceRun.ts` owns mesh extraction cache.

Do not reintroduce these failed experiments without new evidence: topology precompute in workers, skipping triangle prefiltering for interleaved batches, or raising the large-mesh cap to 7. All were measured as neutral or slower on the benchmark.

## Z-seam — `geometry/seams.ts`

`findSeamPosition(contour, pp, layerIndex, nozzleX?, nozzleY?)`. `shortest` mode picks vertex closest to nozzle. Modes: `random`, `aligned`/`back`, `user_specified`, `sharpest_corner` (hide/expose/smart_hide), `shortest`.

## Scarf seam duality

Active when `scarfSeamLength > 0 && layerZ ≥ scarfSeamStartHeight`. Ramps `segLW` 0 → `wallLineWidth` over first `scarfSeamLength` mm. **Logic in BOTH grouped outer-wall pass AND main outer-wall pass** — any scarf change must touch both.

## TaskLists.txt notation

`[x]` wired · `[s]` storage-only (types+UI, engine deferred) · `[ ]` not started · `[.]` in progress · `[skip]` intentional no-op.

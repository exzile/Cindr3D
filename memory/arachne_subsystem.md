---
name: Arachne Variable-Width Walls
description: Pure-JS Arachne pipeline + WASM (post-9.2/9.4) — flap-topology limit, perf cliff, libArachne integration, diagnostic patterns, what doesn't work
type: project
---
Variable-width wall generator at `src/engine/slicer/pipeline/arachne/`, gated on `printProfile.wallGenerator: 'classic' | 'arachne'`, backend selected by `arachneBackend: 'js' | 'wasm'`.

## Pipeline (drop-in replacement for `generatePerimetersEx`)

`generatePerimetersArachne(outer, holes, wallCount, lineWidth, outerWallInset, profile, deps)` returns `GeneratedPerimeters`. Internal stages: `voronoi` → `trapezoidation` → `beadStrategy` (with transition zones tapering to zero over `3×lineWidth`) → `pathExtraction` (spatial-hash endpoint stitch, trims sub-min-width tails). `arachne/index.ts` orchestrates, plus `computeArachneInfillGeometry`.

## WASM status (post-2026-04-26)

Phases 1, 2A, 2C, 2D, 4A all landed. WASM modules in `wasm/dist/` (voronoi 50KB, clipper2 76KB, arachne 178KB). Toolchain in `wasm/.toolchain/` (gitignored) — `wasm/Dockerfile` canonical, `build.ps1` no-Docker fallback. Bundle budget enforced: `scripts/check-wasm-budget.mjs` (500KB gzip) + `verify-wasm-build.mjs` in CI.

WASM Voronoi is 9× faster than JS on 640-edge synthetic (`voronoiBench.test.ts`, gated `ARACHNE_BENCH=1`).

Adapters live at `engine/slicer/pipeline/arachne/{voronoiWasm,arachneWasm,backend}.ts` and `engine/slicer/geometry/{clipper2Wasm,clipper2Boolean}.ts`. Warm-ups in `SlicerWorker.ts` + `profileGeometry.ts`. polygon-clipping kept as fallback safety net — don't drop yet.

## Post-optimization status (2026-04-27)

Native libArachne inner contours are exposed through `arachneWasm.ts` and used by `computeArachneInfillGeometry` before falling back to stroke subtraction. This fixed the blue first-layer infill/skin overreach into walls and removed the expensive JS fallback for normal WASM output.

Contour walls are now precomputed in `SlicerLayerWorker.ts`, serialized as `PrecomputedContourWall`, hydrated in `runSlicePipeline.ts`, and consumed by `emitGroupedAndContourWalls.ts`. Keep grouped-wall and inline-wall behavior identical; the worker precompute is a transport/cache optimization, not a second wall algorithm.

`SlicePipelineGeometry` keeps a bounded Arachne perimeter cache for repeated contour/profile contexts. It is intentionally per-run and profile-sensitive; do not make it global unless geometry/profile invalidation is proven airtight.

## Pure-JS perf cliff (still relevant for js backend)

`ARACHNE_MAX_EDGES = 400` falls back to classic above. JS Voronoi at N=2000 takes minutes/layer (verified empirically). Cura/Orca avoid this via `boost::polygon::voronoi` Fortune sweep (`O(N log N)`) — that's the WASM path.

## Flap topology limit (pure-JS only — libArachne fixes this)

JS path's junction graph traversal isn't topology-aware. Real libArachne walks a half-edge graph and picks which 2-of-N junction fragments belong to the same wall ring. JS leaves fragments orphaned → fragmented walls in dense/non-convex polygons.

## Open

9.3A.1 (`breakthroughHole` libArachne assertion via Clipper compatibility shim — replace with proper Clipper2 boolean), 9.3A.2 (`acuteCorner` zero-WASM-paths fallback), 9.3B (user STL e2e validation), 9.3C (flip default to wasm + remove cap), 9.X.5 (WASM emits ~22× more vertices than JS — audit during 9.3B; libArachne likely prunes externally).

## Diagnostic patterns

- Capture slice result main-thread: monkey-patch `window.Worker` constructor before any worker, listen for `complete` message, stash `event.data.result` on `window.__lastSliceResult`. Then read `.layers[N].moves`.
- `globalThis.__arachneDebug = true` in worker DevTools console enables per-region timing logs.

## Tried and didn't work pre-WASM (don't repeat)

RDP simplification (any tolerance) — shrinks polygon area 1-43% via cumulative inward bias. Aggressive inner-wall simplification — topology mismatch with infill region. `tryCollapseThinParallelogramToGapFill` post-processor — flap walls are sub-paths of merged loop, not separate paths. Outer-contour morphological closing at `wallCount × wallLineWidth × 0.6` — +11% filament with spike artifacts. Raising `ARACHNE_MAX_EDGES` to 3000 — minutes/layer.

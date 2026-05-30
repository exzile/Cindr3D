---
name: WASM Adapter Patterns
description: Recurring gotchas when writing TS adapters over emsdk-built WASM modules — node-env loading, heap alignment, capacity ABI, single-instance state.
type: feedback
---
# WASM adapter patterns (post-2026-04-25, ARACHNE-9 Phase 1 + 9.4A)

Patterns to apply by default whenever writing or reviewing a TS adapter under `src/engine/.../*Wasm.ts` that loads a module from `wasm/dist/*.js`. Each item burned a debug cycle on this codebase.

## Loading

- **Don't use `new Function('return import(...)')` to read fs in node** — Vite/Vitest's static-analysis throws "A dynamic import callback was not specified." Use plain `await import('node:fs/promises')` etc. Vitest's node env handles it natively. Codex's first cuts of `voronoiWasm.ts` and `clipper2Wasm.ts` both made this mistake; fix is the same.
- **emsdk needs `ENVIRONMENT=web,worker,node`** (not just `web,worker`). Without `node`, jsdom-based tests can't load the .wasm: emsdk falls back to `fetch(import.meta.url)` against jsdom's `http://localhost`, which then ENOENTs through the node-fs path resolver.
- **Even with `node`, pass `wasmBinary: ArrayBuffer`** when running in node/jsdom. The default loader resolves the .wasm path relative to jsdom's `http://localhost`, not the actual file on disk. Detect node via `globalThis.process?.versions?.node`, read with `fs.readFile`, slice into a fresh ArrayBuffer (`buf.buffer.slice(buf.byteOffset, ...)`), pass as `factoryOpts.wasmBinary`.
- **EXPORTED_RUNTIME_METHODS uses `HEAP32`, not `HEAPI32`**. The latter was the old emsdk alias; modern emsdk warns and silently drops it. Always export `['HEAPF64','HEAP32']`.

## Heap marshaling

- **`Float64Array` byteOffset must be 8-aligned**. `_malloc` returns 16-aligned, but interior 4-byte sections (Int32 buffers, CSR row-starts) shift any *following* double-typed buffer off-alignment. Pattern: build a `let off = 0; off = align8(off);` accumulator before each Float64 section in a combined-block layout. `align8 = n => (n + 7) & ~7`.
- **Document units explicitly when count and storage diverge**. `edgePointTotal` was point count; doubles required = `points * 2`. Caller-side allocation must use the doubles count, not the points count, or `_emit*` returns -1 capacity-mismatch.

## ABI shape

- **Stateful single-instance C++ + serialised JS in-flight queue** is fine for slicer-worker workloads where a layer is processed serially. Pattern: TU-local `g_state`, `_buildX` populates it, `_getCounts(outPtr)` writes a small Int32 header, `_emitX(ptr, capacity)` returns `-1` on capacity mismatch / >=0 on bytes written, `_resetX` frees. JS adapter wraps everything in a Promise-chained `inFlight` so concurrent callers serialise rather than trample emit caches.
- **Capacity is in *units of the buffer's element type***, not bytes. `_emitVertices(ptr, vertexCount * 3)` because the buffer is doubles. `_emitEdges(ptr, edgeCount * 4)` because the buffer is int32s. Easy to get wrong when CSR sizes are derived from totals.

## Build flags that matter

- `-Oz -fno-rtti` save bundle size; `-fno-exceptions` saves another ~30KB but only works on modules that don't `throw` (Clipper2 throws — needs `-fexceptions`; Boost.Polygon.Voronoi doesn't — `-fno-exceptions` ok).
- `STANDALONE_WASM=0` is what we want when using `MODULARIZE=1 + EXPORT_ES6=1`. STANDALONE_WASM=1 is for self-hosted-runtime contexts; doesn't apply to our Vite/Vitest pipeline.
- `INITIAL_MEMORY=2MB + ALLOW_MEMORY_GROWTH=1` is plenty for our payloads.

## Warm-up pattern (sync-fast-path callers)

When a caller wants the synchronous variant (`*Sync`) of a WASM-backed op — because they're inside a render path or a sync API surface like `computeAtomicRegions` — the module must already be instantiated. Pattern:

1. **Adapter exposes `loadClipper2Module(): Promise<Module>`** as a public export. Memoised; subsequent calls are O(1).
2. **At each entry-point module's top level**, fire-and-forget the warm-up:
   ```ts
   void loadClipper2Module().catch(() => { /* fallback stays available */ });
   ```
   Burns a few ms during JS-bundle eval, returns immediately. Memory cost: zero (already imported transitively).
3. **Caller uses `*Sync`** + `?? polygonClippingFallback(...)` chain. The fallback covers the brief instantiation window.

Concrete entry points wired (2026-04-26):
- `src/workers/SlicerWorker.ts` — runs while geometry reconstructs from transferred typed arrays.
- `src/engine/geometryEngine/core/sketch/profileGeometry.ts` — runs on first sketch import, well before user can commit an overlap-resolving extrude.

**Don't drop the fallback dependency yet.** Even with warm-ups, there's a brief window between worker boot and first slice where `*Sync` returns null. Keep `polygon-clipping` in `package.json` until production telemetry confirms the WASM path always wins, OR refactor to a ready-handshake (worker posts `{type: 'ready'}` after `await loadClipper2Module()`, main thread blocks slice request on it).

## OCCT-specific: VIEW vs owned allocation — never delete a VIEW

Emscripten's `wrapPointer(ptr, Type)` creates a JS *view* of an existing C++ object at that address. Calling `.delete()` on it runs `~Type()` AND `free(ptr)`. If `ptr` is *inside* another allocation (e.g., a member variable or a map's contiguous slot), `free()` on that interior address corrupts the heap allocator — subsequent `malloc` calls may return `ptr=0`, and every Emscripten method on the resulting zero-ptr object throws **"TopoDS_Shape instance already deleted"**.

| OCCT call | Return semantics | Safe to `.delete()`? |
|-----------|-----------------|----------------------|
| `map.FindKey(i)` / `map.FindKey_1(i)` | VIEW of map's internal contiguous slot | ❌ No — `map.delete()` owns it |
| `TopoDS::Face_1(s)` / `Edge_1` / `Vertex_1` | VIEW — C++ cast, same ptr | ❌ No |
| `faceMaker.Face()` | VIEW of faceMaker's internal `TopoDS_Face` member | ❌ No — `faceMaker.delete()` owns it |
| `polygonMaker.Wire()` | VIEW of polygonMaker's internal wire | ❌ No |
| `explorer.Current()` | New heap-allocated copy | ✅ Yes |
| `handle.get()` (OCCT `Handle<T>`) | VIEW of the refcounted C++ object | ❌ No — `handle.delete()` owns it via refcount |
| `occWrap(obj, type)` / `new OccHandle(...)` | Owned handle | ✅ Yes — `dispose()` calls `obj.delete()` |

**ownedResources double-destroy — the pattern to avoid:**
```ts
// BAD: face = faceMaker.Face() VIEW; faceMaker already in profileResources
ownedResources.push(startFace, ...profileResources); // double-destroy at disposal

// GOOD: faceMaker owns face's memory; one delete is enough
ownedResources.push(...profileResources);

// BAD: outerWire = polygonMaker.Wire() VIEW; polygonMaker already in profileResources
profileResources.push(wires.outerWire, ...wires.holeWires);

// GOOD: takeOccOwnedResources(face) already transferred polygonMaker; don't re-add wires
const profileResources = face ? takeOccOwnedResources(face) : [];
```

**FindKey method name varies by opencascade.js build:** the `TopTools_IndexedMapOfShape` instance exposes `FindKey` (no suffix) in the npm modular build but `FindKey_1` in older monolithic builds. Always check both:
```ts
const findKey = typeof map.FindKey === 'function' ? map.FindKey.bind(map) : map.FindKey_1?.bind(map);
if (!findKey) { map.delete(); /* fall back to explorer */ }
```
If neither exists, the guard should fall through to the `TopExp_Explorer` path rather than crashing.

**explorer.Current() + TopoDS.Face_1 double-delete:** `explorer.Current()` returns an owned copy (ptr P). `TopoDS.Face_1(shape)` returns a VIEW with the same ptr. Wrapping the VIEW in `occWrap` (which calls `.delete()` on dispose) AND calling `shape.delete()` in the explorer `finally` → two `.delete()` calls on ptr P → WASM heap corruption. Fix: pass `isOwnedCopy` flag to the callback; use a no-op-dispose `OccHandle` for map VIEWs and a real `occWrap` for explorer copies; remove `shape.delete()` from the explorer `finally`.

**OCCT face holes: REVERSED topological orientation required (2026-05-26)**

`BRepBuilderAPI_MakeFace::Add(wire)` adds `wire` with its current topological orientation. `BRepBuilderAPI_MakePolygon` always produces `FORWARD` wires. OCCT classifies wires in a face as:
- `FORWARD` → outer boundary
- `REVERSED` → inner boundary (hole)

So `faceMaker.Add(holeWire)` with a raw FORWARD wire makes it ANOTHER outer boundary — NOT a hole. Fix: call `holeWire.Reversed()` to get a heap-allocated REVERSED `TopoDS_Shape`, then cast it to `TopoDS_Wire` via `oc.TopoDS.Wire_1()` (VIEW — same ptr) before passing to `Add()`, then delete the owned shape:
```ts
const reversedShape = (holeWire as any).Reversed();    // owned TopoDS_Shape, REVERSED
try {
  const reversedWire = oc.TopoDS.Wire_1(reversedShape); // VIEW — same ptr, do NOT delete
  faceMaker.Add(reversedWire);
} finally {
  reversedShape.delete?.();
}
```
**Why the cast:** `TopoDS_Shape.Reversed()` always returns the base `TopoDS_Shape` type. `faceMaker.Add(W: TopoDS_Wire)` does an Emscripten `instanceof TopoDS_Wire` check and throws `BindingError: Cannot pass "[object Object]" as a TopoDS_Wire` if given a plain `TopoDS_Shape`. `TopoDS.Wire_1()` returns a VIEW-cast that passes the check.

For correct inner-wall normals in the prism, hole wires should be CCW geometrically (same direction as outer), NOT reversed in UV. The `REVERSED` topological orientation flips effective traversal to CW, which is what `BRepPrimAPI_MakePrism` needs for proper inward-facing hole walls.

**Known places already fixed (2026-05-26):**
- `brepBody.ts` `collectTopologyHandles`: fixed `FindKey_1` → `FindKey`/`FindKey_1` dual check; fixed explorer double-delete; added `isOwnedCopy` flag; map VIEWs use no-op dispose OccHandle
- `extrude.ts` `occExtrudeShapeWithInstance`: removed `profileResources.push(wires.outerWire, ...wires.holeWires)`
- `extrude.ts` `occExtrudeFaceShapeWithInstance`: removed `startFace` from both `ownedResources.push(...)` calls; added try/catch around `resultShape.delete()` in both `dispose()` functions
- `tessellate.ts` `appendFaceTriangles`: removed `poly.delete()` — `poly = triangulation.get()` is a VIEW of an OCCT Handle-managed `Poly_Triangulation`; deleting it bypasses refcount → WASM heap corruption ("memory access out of bounds")
- `tessellate.ts` face loop: removed `face.delete()` — `face = TopoDS.Face_1(current)` is a VIEW of `current` (same ptr); deleting both caused double-free → WASM heap corruption → OOM on subsequent operations
- `booleanBase.ts` `propagateBooleanIds` (2026-05-30): removed `newFace.delete?.()` — `newFace = TopoDS.Face_1(modShape)` is a VIEW of `modShape` (same ptr), and `modShape.delete?.()` runs right after; deleting both double-freed the same ptr on every boolean that remapped a face → latent heap corruption surfacing as a later "already deleted" throw
- `extrude.ts` `applyDraftAngle` (2026-05-30): the **tapered-extrude** path carried the FULL draft.ts bug set on a separate code path that never got the OCC-18 fix — `BRepOffsetAPI_DraftAngle_1(shape)` (should be `_2`), 4-arg `Add` (needs trailing Flag → 5 args), `Build(progress)` (0-arg → `runEdgeOpBuild`), AND `s=explorer.Current()` (owned) then `Face_1(s)` (VIEW same ptr) with `s.delete()` BEFORE using the VIEW → use-after-free + later double-free when `allFaces` VIEWs were deleted. Fixed: `_2` ctor, 5-arg Add, runEdgeOpBuild, and split owned `Current()` copies into `ownedFaceCopies` (delete those, never the `Face_1` VIEWs). Tapered extrude (`taperAngle`!=0) was fully broken/crashing before; non-tapered early-returns at the `Math.abs(taperDeg)<=0.001` guard so it was unaffected.
- `sliceSketch.ts` `occSliceSketch` (2026-05-30): `edgeShape=explorer.Current()` (owned) + `edge=Edge_1(edgeShape)` (VIEW) were NEVER freed → per-edge heap LEAK on every plane-section-to-sketch. Wrapped the loop body in try/finally that frees the owned `edgeShape` (never the VIEW); `continue` paths run the finally.
- `edgeModActions.ts` `propagateTangentEdges`: removed `.delete()` on `occDeref()` VIEW result
- `sketchToWire.ts` `wireToFace`: added `.Reversed()` for hole wires + changed `orientLoop2D` to keep CCW (not reverse) for holes — holes must be CCW geometry + REVERSED topology for correct OCCT hole behavior
- `sketchEntityToWire.ts` `wiresToFace`: same `.Reversed()` fix for hole wires

**⚠️ `occDeref(oc, handle, ctor)` does NOT return the `ctor` type — it returns a `TopoDS_Shape` (2026-05-30).**

Recurring HIGH-severity bug (hit 5+ times). The `ctor` arg is effectively ignored when occDeref falls to `handle._object` (stored as a Shape). Passing the result to a **type-strict** OCC embind API throws `BindingError: Expected ... TopoDS_Edge/Face, got an instance of TopoDS_Shape`. These throws are usually swallowed by a try/catch → the feature **silently degrades to null/wrong output** (looks "implemented but non-functional", not a crash). ALWAYS cast before a type-strict call:
```ts
const rawEdge = oc.TopoDS.Edge_1(occDeref(oc, handle, oc.TopoDS_Shape)); // Edge_1 is a VIEW — never .delete()
const rawFace = oc.TopoDS.Face_1(occDeref(oc, handle, oc.TopoDS_Shape)); // Face_1 is a VIEW — never .delete()
```
- **Type-strict (MUST cast):** `MakeFillet/MakeChamfer.Add_2/Add_3/Add_5/AddDA(edge|refFace)`, `BRep_Tool.Surface_2(face)`, `BRepAdaptor_Surface_2(face)`, `BRepOffsetAPI_DraftAngle.Add(face)`, `MakePolygon`/`MakeFace` wire adds.
- **Shape-ok (no cast needed):** `Modified(shape)`, `TopTools_ListOfShape.Append(shape)`, `BRepPrimAPI_MakePrism(shape)`, boolean `AddTool/AddArgument(shape)`.

Fixed (2026-05-30): `chamfer.ts` (edge Add_2 + refFace Add_3/AddDA; test `chamferEdgeCast.test.ts`), `offsetFaces`, `draft` (test `draftBindings.test.ts`), `geomSurface` (test `occGeomSurface.test.ts`). Already-correct: `fillet.ts` (Shape+Edge_1/Face_1 throughout). Confirmed OK (shape-typed APIs, no cast needed): `booleanBase.ts` `Modified(shape)`, `shell.ts` `ListOfShape.Append(shape)`. When writing ANY new face/edge OCC call, follow this pattern.

**Compounding binding gotchas found alongside the cast bug (this opencascade.js build):**
- **`BRep_Tool.Surface` overloads are "backwards":** `Surface_1(F, L)` is the 2-arg (location-aware) version; `Surface_2(F)` is 1-arg. Calling `Surface_2(F, loc)` throws (wrong arg count). And **`Handle_Geom_Plane.DownCast` is `undefined`** — there is no generated DownCast. To classify/inspect a surface, prefer `new BRepAdaptor_Surface_2(face, true)` + `GetType()` vs `GeomAbs_SurfaceType.GeomAbs_Plane` + `.Plane()` (mirrors how `BRepAdaptor_Curve_2.GetType()/.Line()` is used for edges; folds in the face location automatically).
- **`BRepOffsetAPI_DraftAngle_1()` is the 0-ARG ctor;** the shape ctor is `_2(shape)`. Its `Add(F, dir, angle, plane, Flag)` needs **5 args** (the trailing Flag is required).
- **`.Build()` takes 0 args** on `BRepAlgoAPI_*` (boolean), `BRepOffsetAPI_DraftAngle`, fillet/chamfer makers in this build — calling `Build(progress)` throws `... Build called with 1 arguments, expected 0`. Always go through **`runEdgeOpBuild(oc, builder)`** (adjacency.ts), which tries `Build(progress)` then falls back to `Build()`. booleanCore calls bare `Build()`.
  - **The 0-arg rule is UNIFORM across the whole `BRepBuilderAPI_MakeShape` hierarchy** in this build, not just edge ops. A second audit (2026-05-30, post fillet/chamfer) found the SAME `Build(progress)` bug latent in the modeling ops: **`revolve.ts` (MakeRevol ×2), `shell.ts` (MakeThickSolid ×2), `sweep.ts` (MakePipe/MakePipeShell ×4), `loft.ts` (ThruSections), `pattern.ts` (Fuse).** All routed through `runEdgeOpBuild`. Smoking gun: sibling `thicken.ts` already used bare `prism.Build()` for the same `BRepPrimAPI` base, while `revolve.ts` used `revol.Build(progress)` — they can't both be right. `runEdgeOpBuild` is a STRICT SUPERSET (only catches the "expected 0 args" message; re-throws everything else), so converting is zero-regression even if a given maker's `Build(progress)` happened to work. **Rule: never call `.Build(progress)` directly on ANY `BRep*API_*` maker — always `runEdgeOpBuild`.** Note `MakeThickSolidByJoin(..., progress)` takes a progress as a normal METHOD arg (keep that); only the `Build` call is 0-arg.

## What's checked in

`wasm/dist/*.js` and `*.wasm` are tracked in git (per ARACHNE-9.4B). Toolchain (`wasm/.toolchain/emsdk`, `boost_1_84_0`, `clipper2`, `CuraEngine`) is gitignored — Dockerfile is canonical, build.ps1 is the no-Docker dev fallback.

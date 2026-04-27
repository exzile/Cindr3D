---
name: WASM Adapter Patterns
description: Recurring gotchas when writing TS adapters over emsdk-built WASM modules — node-env loading, heap alignment, capacity ABI, single-instance state.
type: feedback
originSessionId: 768c4a3e-fc4c-4a2b-ba31-60db44f6dc31
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

## What's checked in

`wasm/dist/*.js` and `*.wasm` are tracked in git (per ARACHNE-9.4B). Toolchain (`wasm/.toolchain/emsdk`, `boost_1_84_0`, `clipper2`, `CuraEngine`) is gitignored — Dockerfile is canonical, build.ps1 is the no-Docker dev fallback.

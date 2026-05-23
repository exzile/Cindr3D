---
name: CSG Edge-Cut (Chamfer/Fillet)
description: Shared edge-cut driver, non-destructive feature model, Manifold WASM backend, weld-between-cuts, quad-fan, and all Fusion 360 fillet/chamfer parity tasks
type: project
---
**All 17 Fusion 360 fillet/chamfer parity tasks (0a–0e, 1–16) are COMPLETE** as of 2026-05 (branch codex/authored-edge-topology-fillet / PR #66).

Chamfer and fillet are ONE operation differing only in the per-edge cutter. Shared driver: `src/utils/geometry/edgeCutCore.ts` → `computeEdgeCutGeometry` (sequential per-edge `csgSubtract` loop). Cutters: `chamferGeometry.ts` `buildChamferCutter` (triangular ExtrudeGeometry prism), `filletGeometry.ts` `buildFilletCutter` (prism − cylinder). HIGH blast radius — one driver feeds **4 paths**: commit (`featureMeshActions.ts` commitFillet/commitChamfer → `applyEdgeCut.ts`) ×2 tools, and live preview (`FilletPreview`/`ChamferPreview` → `EdgeOpPreview.tsx`) ×2 tools. `parseEdgeIds` (re-exported as parse{Fillet,Chamfer}EdgeIds) also used by all 4.

## NON-DESTRUCTIVE ARCHITECTURE (Phase 0, shipped 2026-05)

Fillet/chamfer are now proper feature nodes — parent mesh is **never mutated**. Key pieces:

- **`EdgeCutSpec.featureId`** (in `applyEdgeCut.ts`): when set, activates non-destructive path — CSG result stored on the fillet/chamfer feature's own `mesh`, not on the parent.
- **Feature shape**: `{ type:'fillet'|'chamfer', params:{radius, edgeIds, mode, ...}, parentFeatureId:'<source body id>', mesh:<CSG result>, healthState, healthMessage }`. `edgeIds` stored as comma-separated string in `params.edgeIds`.
- **Source geometry cache** (`applyEdgeCut.ts`): `_srcGeoCache: Map<featureId, BufferGeometry>` — session-only, keyed by fillet/chamfer feature ID. `cacheEdgeCutSource(fid, geo)` / `getCachedEdgeCutSource(fid)` / `evictEdgeCutSource(fid)`. Stores a clone of the parent's pre-fillet geo so edit/replay never needs to re-render.
- **`replayEdgeCutFeature(featureId)`** in `featureMeshActions.ts`: called on edit-confirm, suppress, and delete-dependent. Source resolution waterfall: (1) session cache → (2) `feature.parentFeatureId` → live parent mesh → (3) `bodyGeometryCache` → (4) stale-UUID rescue via `liveBodyMeshes`. Sets `srcLabel` for diagnostic output.
- **Rendering**: `ExtrudedBodies.tsx` shows the fillet/chamfer feature's mesh instead of the parent's when the feature is active and unsuppressed.
- **Mesh tagging**: `newMesh.userData._edgeCutApplied = true` — guards undo/redo from carrying the mesh onto a non-edge-cut restore.
- **Health states**: `feature.healthState: 'healthy'|'warning'|'error'` + `feature.healthMessage`. Set from `newGeo.userData.failedEdgeCount` / `totalEdgeCount`. Surfaced in feature tree with icon.

## MANIFOLD WASM CSG backend (shipped 2026-05)

Primary CSG engine is now `manifold-3d` (WASM). Three-bvh-csg is the fallback.

- **`src/engine/geometryEngine/core/solid/manifoldWasm.ts`**: singleton loader. `initManifold()` (async, call at app startup + once per worker); `getManifoldModule()` (sync, returns module or null). Pre-warmed in `main.tsx` and `edgeOpWorker.ts`.
- **`src/engine/geometryEngine/core/solid/csg.ts`**: `csgSubtract/csgUnion/csgIntersect` — try Manifold first (convert geometry → Manifold mesh → op → convert back), fall back to three-bvh-csg if Manifold isn't loaded yet or throws. Manifold guarantees valid manifold output — no post-processing soup repair needed on that path.
- **Fallback triggers**: (a) Manifold WASM not yet resolved (startup race), (b) source mesh is non-manifold (legacy files from before Manifold was added). Compact warn: `manifold×(non-manifold?) → fbk: <msg>` / `sub× → fbk: <msg>`.
- **Off-thread**: `edgeOpWorker.ts` also calls `initManifold()` so live-preview CSG in the worker uses Manifold too.

## SHIPPED Tasks 12–15 (full-round, rule fillet, G2, stable IDs)

**Task 12 — Full-round fillet + face pick mode**
- `filletPickMode: 'edge'|'face'` in store (`state/modelingState.ts`, init + reset-on-dialog-open in `generalUiActions.ts`).
- `FilletEdgeHighlight.tsx` passes `pickMode={filletPickMode}` and `onFacePicked={setFilletLiveRadius}` to `EdgeOpEdgeHighlight`.
- `EdgeOpEdgeHighlight`: when `pickMode='face'`, uses `useFacePicker`; on click, calls `addEdge` for each boundary segment of the hit face, then `onFacePicked(inradius)`. `faceInradius` = min distance from face centroid to any boundary segment midpoint. Full-round dialog auto-switches to face-pick.

**Task 13 — Rule fillet**: same face-pick path; clicking a face selects all its boundary edges.

**Task 14 — G2 curvature continuity + tangency weight**
- `FilletCommitParams.tangencyWeight?: number` in `filletGeometry.ts`. When `isG2=true` and `tangencyWeight` is set: `effectiveRadius = baseRadius * clamp(tangencyWeight, 0.1, 2.0)`. Tangency Weight input shown in `FilletDialog` when G2 is checked.

**Task 15 — Stable edge IDs (stale UUID fallback)**
- Coords normalised to 4 d.p. in `EdgeOpEdgeHighlight.tsx` `edgeId()` (`normCoord = (n) => +n.toFixed(4)`).
- `parseEdgeIds` in `edgeCutCore.ts`: after grouping by `featureId|meshUuid`, scans any group whose `meshUuid` is not in `liveBodyMeshes`. If `featureId` is set, searches `liveBodyMeshes` for a mesh whose `userData.featureId` matches → rewrites `group.meshUuid` to the new live UUID. Handles BodyMesh remount / HMR without losing edge selection.

## DIAGNOSTIC: logEdgeCutSummary (shipped 2026-05)

`logEdgeCutSummary(tag, featureId, sizeLabel, totalEdges, cutEdges, failedEdges, src, startMs, health)` in `applyEdgeCut.ts` — emits one grep-able log line per operation:

```
[fil] id=..abc123 r=2.0 edges=5→cut=3 fail=2 src=cache ms=38 → warning
[cha] id=..d4e5f6 d=1.5 edges=2→cut=2 fail=0 src=live ms=12 → ok
```

- `src` values: `cache` (session srcGeo cache hit) | `parent` (live parent mesh) | `bodyCache` (bodyGeometryCache) | `live` (liveBodyMeshes stale-UUID rescue) | `unknown`.
- Called in `applyEdgeCut` (non-destructive path, `src='live'`) and `replayEdgeCutFeature` (all src variants).
- Compact status messages use `×` = fail, `→` = consequence, `fbk` = fallback; see `edgeCutCore.ts` and `csg.ts`.

## Edge-ID format
`${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}` (world coords; legacy = no `featureId|`). `meshUuid` is VOLATILE (recreated on geometry swap / BodyMesh remount / HMR). Built in `EdgeOpEdgeHighlight.tsx` `edgeId(result)`. Coords normalised to 4 d.p. so minor float drift doesn't invalidate IDs. Stale UUID healed at parse time by featureId lookup (see Task 15 above).

## FIXED 2026-05-20 — ghost topology (selection of pre-cut edges through filleted/chamfered geometry)
When a fillet/chamfer cut consumes a sharp edge it leaves no detectable edge in `extractEdgeTopology` (fillet transitions have ~0–7.5° dihedral, well below the 30° threshold; chamfer endpoint transitions are tangent). The picker was blind to those edges and users couldn't chamfer-the-already-filleted-edge.

**Fix**: `computeEdgeCutGeometry` in `edgeCutCore.ts` now captures `srcGeo.userData.topology + srcGeo.userData.ghostTopology` at the top of the function and stamps the union as `output.userData.ghostTopology = { edges: [...] }`. Multi-step chains (box → fillet → chamfer → …) accumulate the history: each operation's source-topology contribution flows into the result's ghost.

**Picker**: `pickNearestEdge` reads `geom.userData.ghostTopology` alongside `geom.userData.topology` and walks both through the same screen-space-nearest loop — whichever segment is closer wins. Ghost edges are returned through the same `EdgePickResult` shape (no `isGhost` flag yet — added if/when the highlight needs to render them differently).

**Cache**: `topologyCache.getCachedEdges` was a one-entry-per-geom WeakMap; ghost + live with the same geom thrashed it. Refactored to `WeakMap<geom, Map<topo, entry>>` so both topologies stay warm. matrixSnap compare unchanged.

**Migration**: existing committed fillets have NO `ghostTopology` — they were stamped before this code landed. Users must delete + re-apply the fillet feature for ghost edges to materialize on that body. Documented user-facing.

**Chamfer-on-ghost-edge commit caveat**: the cutter is built at the original (pre-fillet) edge coordinates and CSG-subtracted from the current (filleted) geometry. Result is geometrically valid but may render as a chamfer-stacked-on-fillet faceted shape rather than a clean "fillet replaced by chamfer". Cleaner replacement requires timeline-aware logic (suppress the prior fillet before re-applying chamfer) — separate change.

## FIXED 2026-05-20 — edge picker uses SCREEN-space distance (KEEP)
`pickNearestEdge` (in `src/hooks/edgePicker/nearestEdge.ts`) previously found the edge nearest the 3D ray-hit point. **This is wrong** on perspective/isometric views: when the raycast lands on a face, the 3D-nearest edge to that hit point is often NOT the edge the user is visually pointing at. Symptom: on a filleted box viewed from a TOP perspective, the user couldn't pick the visible "front-top edge" — the algorithm kept selecting the left-top or back-top edge (3D-nearer to the cursor's surface hit) and the proximity gate then rejected it because that 3D-nearest edge projected ~120-160 px away in screen space.

**Fix:** changed the inner loop to project every cached-edge segment to canvas-pixel space and pick the segment with the minimum `segDistSqPx` to the cursor. The 3D `hitPoint` is no longer consulted for edge selection (param kept and underscored). Signature now takes `camera, cursorPx, cursorPy, rectW, rectH`; both callsites in `useEdgePicker.ts` (`handlePointerMove` + `handleClick`) updated.

**Why this is safe for circles/rims:** a circle is ONE `CachedEdge` with N segments — the closest segment determines screen distance, but the whole `chain` (full polyline) is still returned for highlight/cut. Selection behavior on circles is identical. The cached-chain pattern (PERF round 7) is untouched: `getCachedChain(bestEdge)` is still called once per pick.

**Why occlusion still works:** `edgeIsPickable` still casts a ray through the segment's nearest-to-hitpoint NDC. If the picked edge is behind the body, the front face is hit first → rejected. The `hitPoint` parameter still feeds the occlusion check via the caller, even though `pickNearestEdge` itself doesn't use it for selection.

**Companion changes:** `EDGE_PICK_PX` bumped 12→20 in `edgeVisibility.ts` (perspective foreshortening leaves the cursor a few px off the projected line even when it looks "on" the edge — matches Fusion-style slop). `edgeIsPickable` now walks the full chain in screen space (was only checking `edgeVertexA/B`).

**Perf:** ~300 segment projections per pointermove worst case (98 edges × avg 2 segments + a few rims), <0.1 ms. The broad-phase AABB skip was removed (it gated on 3D distance, which is no longer the metric) — net cost still well under one frame.

## Verified fix — weld between sequential CSG cuts (KEEP)
`computeEdgeCutGeometry` calls `weldAndCleanSolid(next)` after every successful `csgSubtract` (and on the final result). three-bvh-csg emits an UNWELDED triangle soup; the next cut slicing that soup near a vertex shared by two picked edges produced a gray "star/spike" of degenerate/inverted slivers. Welding (`mergeVertices`, **normal+uv deleted first** so it unifies by position, then `computeVertexNormals` — three-bvh-csg throws if a later operand lacks `normal`) + dropping near-zero-area tris hands each subsequent boolean a clean manifold. Hardened 2026-05: weld + degenerate-area tolerances are **bbox-diagonal-relative** (like `makeNear`; weld=max(diag·1e-5,1e-6), degenLen=max(diag·1e-7,1e-7)) so sub-mm/huge parts are safe; zero `uv` re-added to match the old raw-CSG attribute set; `try/finally` disposes all intermediates on throw; output positions preallocated (no per-vert push). Verified: 2-/4-edge shared-corner degenerate tris 2/3→0, non-manifold 4→0, single-edge known-good stays clean, cuts apply monotonically. **Do not remove or regress this.**

## FIXED 2026-05-17 — quad-fan collapse via coplanar retriangulation + edge dedupe
The quad-fan ("broken/disappearing face", giant skewed triangle) and the duplicate-edge double-cut are FIXED in `edgeCutCore.ts`. Two additions, both in the shared core so all 4 paths (commit×2, preview×2) get them:

1. **`retriangulateCoplanarRegions(posIn, diag)`** — called inside `weldAndCleanSolid` after the degenerate-tri drop, before building `out`. Algorithm: weld posns→vertex ids (q=diag·1e-4, 3×3×3 neighbour snap); group tris into connected **coplanar** regions by shared-VERTEX growth (`nrmTol=1e-5`, `dTol=max(diag·1e-5,1e-6)`); per region recover directed boundary half-edges (net-direction cancels interior edges), **split boundary segments at interior-collinear region verts (T-junction fix — three-bvh-csg fans leave T-junctions or the loop won't close)**, walk into loops, drop collinear/dup loop verts (PINNED verts = shared by >1 region = real seam corners are never dropped → keeps adjacent rims consistent), pick largest-area loop as outer + rest as holes, `bridgeHoles` (keyhole) + `earClip`, emit. **Two safety gates so this is provably shape-safe for inputs we don't fully model (e.g. weld-degraded fillet): (a) PLANARITY GATE — reject region if any tri normal off modal by >1e-6 OR any vert off the band (max(diag·1e-5,1e-6)); keeps a fillet's curved arc OUT, lets a flat CSG fan through; (b) AREA GATE — keep originals unless retri surface area matches within 0.1%.** ≤2-tri regions emitted unchanged. Any failure → emit originals (caller's catch also keeps raw CSG). Net: a flat face fanned to 40 tris collapses to a clean ~2-tri polygon; curved/uncertain regions are untouched.
2. **Geometry edge-dedupe in `computeEdgeCutGeometry`** — before the cut loop, drop edges whose endpoint pair matches an earlier one (either direction) within `makeNear`. Kills tangent-propagation / preview-re-registration duplicates that double-bevel & over-cut.

**Before→after (persisted box, d=2, measured via preview_eval):** chamfer topBack 22→16, topRight 21→19, **topFront 40→24, topLeft 42→24** (the broken giant-triangle fans), all **0 degenerate**; non-manifold (over-counted on CSG soup) 14-19→0-7. Distance-independent (d=1/2/4). Multi-edge monotonic [16,19,31,47]. 7-edge + tangent-propagation + near-dup → all cut, **0 skip logs**. Exact/near/reversed duplicate edge → 16 (== single, was 23/21). Shared-corner 2-/4-edge: **0 degenerate (corner-spike weld fix intact)**. tsc clean.

**Fillet caveat (pre-existing, NOT regressed):** `weldAndCleanSolid`'s `mergeVertices` (weldTol=diag·1e-5, PROTECTED — don't touch) already flattens a fillet's fine arc on a coarse box face — baseline fillet topBack=32 tris has **0 verts on the round** (verified: it's a flat fan, the round was lost to weld long before retri). So retri collapsing it to 12 is the SAME shape, fewer tris — not a shape regression. Broken fillet topFront/topLeft improved 121/127→101/103 (their genuinely-curved arc is correctly preserved by the planarity gate). The fillet-round-loss on coarse quads is a separate pre-existing weld-tolerance issue, out of scope here.

## FIXED 2026-05-17 — single edge "doesn't chamfer/fillet" (left-handed basis mirror)
Symptom: pick ONE edge of a box, set a distance — nothing visibly happens (geometry IS cut, 36→72 verts, 0 degenerate, but the new bevel facet is INVISIBLE). Reproduces on ~5/12 box edges for chamfer, the OTHER ~7/12 for fillet (orientation-dependent, not random). Root cause: both cutter builders place the local prism with `new THREE.Matrix4().makeBasis(...)` whose columns are the in-face dirs + edgeDir. `(u1,u2,edgeDir)` (chamfer) / `(u1,edgeDir,u2)` (fillet) is right-handed for some edges, **left-handed for others** — depends purely on the edge's world orientation + which adjacent triangle `resolveEdge` listed first (arbitrary geometry order). A left-handed basis = **negative determinant = a MIRROR**: `prism.applyMatrix4(basis)` turns the ExtrudeGeometry/Box−cyl cutter inside-out; CSG-subtracting an inside-out cutter leaves the new facet **back-wound** → FrontSide-culled → invisible → "it didn't chamfer". `resolveEdge`'s u1/u2 are geometrically CORRECT; the bug is purely the placement basis handedness. Pre-existing (not a PR #53 regression) — earlier single-edge tests just happened to land on right-handed edges.

**Fix (in BOTH `chamferGeometry.ts` `buildChamferCutter` and `filletGeometry.ts` `buildFilletCutter`):** compute `makeBasis(...).determinant() < 0`; if so swap the two in-face axis columns (chamfer: u1↔u2 AND legs d1↔d2 so the world wedge `{a, a+d1·u1, a+d2·u2}` is geometrically identical — same corners/volume/cut result, vertex+triangle ordering may differ; fillet: just u1↔u2 columns — its box cross-section is symmetric setback×setback and the cylinder rides the symmetric bisector, so the world cutter is geometrically identical). Swapping two columns flips det → right-handed → no mirror → facet outward-wound. **det>0 edges take neither branch → output byte-identical to before (the unchanged code path; zero regression risk on the cases that already worked).** Tried & RULED OUT: reversing the 2D `Shape` point order to "compensate" the mirror — does NOT work (ExtrudeGeometry re-triangulates; facet stayed inverted). Verified live (all 12 box edges, hard-reload + `computeChamferGeometry`/`computeFilletGeometry` direct): post-fix **chamferBad=[] filletBad=[]**, every edge strongInv=0 degen=0, previously-working edges keep identical tri counts. tsc clean. Changed: `chamferGeometry.ts` ~lines 51-78, `filletGeometry.ts` ~lines 71-90.

## FIXED 2026-05-17 — deselect doesn't remove bevel (edge-pick proxy)
Symptom: with multiple edges selected in Chamfer/Fillet, clicking an already-selected edge **in the 3D viewport** to deselect it did NOT remove its bevel; adding seemed to work, removing didn't. Root cause was NOT in the geometry core — `parseEdgeIds` + `computeEdgeCutGeometry` + edge-dedupe were verified correct for every 4→3→2→1-edge case (right vertex counts, never wrongly discarded). The bug: `EdgeOpPreview.tsx` sets the live body `mesh.visible = false` while a preview is shown. THREE.Raycaster skips invisible objects, and (a) the preview mesh has none of the picker's `userData.pickable`/`featureId` (so `useEdgePicker.collectPickable()` + its `featureId` filter exclude it) and (b) the preview's chamfered/filleted geometry no longer contains the original sharp edges anyway. So once ANY preview was shown there was nothing for the edge picker to raycast → clicks never reached `handleClick` → `removeEdge`/`addEdge` never fired. The dialog's `×` button worked (pure React, bypasses picker), which is why only viewport-click deselect failed.

**Fix (in `EdgeOpPreview.tsx`, shared → both tools, preview only):** when a preview is shown, add an invisible-but-raycastable **pick proxy** = `new THREE.Mesh(liveMesh.geometry, new MeshBasicMaterial({visible:false}))` added to the scene root, with `proxy.uuid = liveMesh.uuid` and `userData.pickable`/`featureId` copied from the live mesh. `material.visible=false` keeps it out of the render; `Object3D.visible` stays true so Raycaster still hits it. It wraps the ORIGINAL (unchamfered) geometry so `pickNearestEdge` finds the original edges and `edgeId()` produces IDs that exactly match the selection list (same uuid + same featureId + original endpoints). Proxy is created next to where the live mesh is hidden, removed in every `restoreLiveMesh()` path, on the "target mesh changed" branch (rebuilt vs new geometry/uuid), and on unmount (`removePickProxy` disposes only the proxy's material — NEVER the shared live geometry). `renderOrder=-1`, identity transform (matches `liveBodyMeshes` "identity matrixWorld, world-space geometry" contract). The hidden live mesh shares the proxy's uuid but is `visible=false` so the raycaster only ever hits the proxy (no double hit). Geometry-core acceptance re-verified post-fix: topFront+topLeft 2-edge 0 degenerate, shared-corner 4-edge 0 degenerate/0 skip, 7-edge+propagation all cut 0 skip/0 degenerate. tsc clean (edge-op subsystem). Changed file/lines: `src/components/viewport/scene/edgeOp/EdgeOpPreview.tsx` (~lines 18-26 docblock, 49-82 refs+removePickProxy+unmount cleanup, 94-103 restoreLiveMesh, 135-143 mesh-changed branch, 151-170 proxy creation).

## ~~Open defect 2~~ — parseEdgeIds group-drop ("second edge doesn't chamfer")
Note: the geometry-layer edge-dedupe above means even if parse returns duplicates, the driver now cuts each physical edge once. The parse group-drop itself is unchanged (still returns largest group) — but the "missing edge" symptom was primarily the quad-fan throwing/over-cutting mid-loop, now fixed.
`parseEdgeIds` groups by `featureId ?? meshUuid` and returns ONLY the largest group (ties → first), silently discarding the rest. Two picks on the SAME body split into separate single-edge groups when the live mesh re-registers between picks (preview swap) and featureId is empty (key falls back to volatile meshUuid) → 2nd edge dropped → "first edge chamfers, second doesn't". Geometry layer (`computeChamferGeometry` multi-edge) is proven correct — bug is purely in parse. Still spawned-task material.

**Ruled out (regressed, reverted): "return ALL parsed edges, dominant group only for body identity."** Synthetic harness looked clean (split-prefix → 2 edges), but in the real app it BROKE chamfer — first selection stopped chamfering and faces went missing. Cause: real selections (esp. with PROPAGATE-ALONG-TANGENT-EDGES) and preview re-registration produce the SAME physical edge under multiple group keys / many IDs; returning them all feeds duplicate + stray edges into the sequential CSG driver → double-cuts/over-cut → missing faces. Any real fix MUST dedupe by geometry and exclude other-body edges, not just "return everything". Verify in the LIVE app with tangent-propagation on, not only the synthetic 2-ID harness.

## Ruled-out approaches (do NOT retry)
- **Union all cutters then one subtract** — empirically far worse (~88 vs ~7 non-manifold).
- **Feed the boolean a welded INDEXED manifold source** instead of non-indexed soup — does NOT fix the quad-fan (top-front stayed 40) and slightly regressed the multi-edge case. Reverted.
- Position-welded boundary/non-manifold counts OVER-COUNT on raw three-bvh-csg soup — valid only for RELATIVE comparison; the trustworthy absolute signal is **near-zero-area (degenerate) triangle count**.

## PERF 2026-05-20 (round 12) — parseEdgeIds avoids per-point split+map+some allocations
The chain-segment parse loop ran `parts[pi].split(',').map(Number)` plus `.some((n) => !Number.isFinite(n))` per point — three transient arrays + a closure invocation per point. Circle-rim selections arrive with 30+ points per ID, and with several picked rims the loop allocates hundreds of throw-away arrays per parse. Switched to direct `indexOf`/`slice`/`+` parsing (no transient arrays, no closure) with explicit `Number.isFinite` checks on the three scalars. Behaviour-equivalent — added 8 new unit tests covering simple/legacy/featureId-prefixed IDs, chained multi-segment IDs, malformed IDs, NaN/Infinity rejection, and the null-featureId upgrade case to lock in the contract. Also added 3 tests for `parseEdgeLabel`'s `Number.isFinite` guard (no `NaN` in the dialog).

## PERF 2026-05-20 (round 11) — hoist edgeIds Set to a useMemo
`EdgeOpEdgeHighlight.useFrame` was constructing `new Set(edgeIds)` on every frame for the selected-line cleanup membership check (~100 ops × 60 Hz = 6000/sec on a circle-rim selection). Hoisted into `const edgeIdSet = useMemo(() => new Set(edgeIds), [edgeIds])` so it's built once per edgeIds change. `handleClick` also switched to `edgeIdSet.has(id)` instead of `edgeIds.includes(id)` — O(1) vs O(N), and the callback's identity stability follows edgeIdSet (which already follows edgeIds).

## PERF 2026-05-20 (round 10) — let idle edge-picker idle
`EdgeOpEdgeHighlight.useFrame` was calling `invalidate()` unconditionally on every frame while the picker was enabled, defeating R3F's `frameloop="demand"`: the canvas rendered at 60 Hz the whole time a Fillet/Chamfer dialog was open, even when the user sat still with no edge hovered and nothing selected. Gated on a `hasVisible` check (any hover, any selected line, any pending edgeIds), so pulse animation still runs whenever there's something animatable, but a truly idle picker (open dialog, cursor parked off the body, no picks yet) lets the canvas settle. Pointermove still wakes the loop: `handleHover` now calls `invalidate()` on every hover-change, so the next `useFrame` runs and picks up the result.

## PERF 2026-05-20 (round 9) — skip redundant computeBoundingBox
`computePositionEps` was unconditionally calling `srcGeo.computeBoundingBox()` on every invocation. The render pipeline almost always has the bbox set (frustum culling needs it), so the recompute was wasted O(N) work. Now guarded by `if (!srcGeo.boundingBox) srcGeo.computeBoundingBox()`. Hit primarily by `EdgeOpPreview.parsedAndClustered` memo (runs `computePositionEps(liveMesh.geometry)` on every edges change) and indirectly through the per-srcGeo cache's first miss.

## PERF 2026-05-20 (round 8) — EdgeOpPreview reuses preview mesh across updates
Previously every debounced value tick (every 150 ms during gizmo drag) did `scene.remove(previewMesh) + previewMesh.geometry.dispose() + new THREE.Mesh(...) + scene.add(newMesh)` — a full scenegraph remove/add cycle plus shadow-flag setup. Now we keep the same `THREE.Mesh` wrapper in the scene across updates and just swap its `geometry` field (the geometry itself MUST be a new buffer per tick — positions differ). The previous geometry is disposed AFTER the swap so the mesh is never temporarily geometry-less.

The mesh is still rebuilt fresh when `liveMesh.material` swaps (i.e. body identity changes under us) — same conservatism as before. Bail-out paths (`!parsedAndClustered`, `!previewGeo`, empty positions) now also clean up the lingering preview mesh through a single `restoreLiveMesh()` helper, so the "we kept the mesh between ticks" optimisation can never strand it on dialog close or mesh-disappear.

## PERF 2026-05-20 (round 7) — cached edge chain in topology cache
`pickNearestEdge` allocated a fresh `THREE.Vector3[]` for the whole edge polyline every time it returned (continuous hover at 60 Hz, up to ~30 segments per circle-rim edge). Moved the chain materialisation into `topologyCache.getCachedChain(ce)` — lazily built on first access, then reused for the cached edge's lifetime. WeakMap-evicts with the geometry; rebuilds automatically on cache miss (when geom/topo/matrix changes).

Safety contract documented in the type: the returned chain is read-only. Verified existing consumers in `EdgeOpEdgeHighlight.handleClick` (clones via `.map(p => p.clone())`) and `EdgeOpEdgeHighlight.useFrame` (read-only iteration into `buildPolylineGeometry`). `midpoint` and `direction` on the result still depend on the hovered segment so they remain freshly allocated per call.

## PERF 2026-05-20 (round 6) — topology cache matrix snapshot
`getCachedEdges` in `src/hooks/edgePicker/topologyCache.ts` is on the pointermove hot path (called from `pickNearestEdge` on every cursor move while an edge picker is active). The cache hit check compared `matrixKey` strings — and BUILT the string `` `${e0},${e1},...` `` on every call. ~100 char concat + ~100 char comparison per move at 60 Hz = ~6 KB/sec of garbage and an O(string-length) `===` check.

Replaced with a 12-float `Float32Array` snapshot of the affine matrix elements + element-wise `matrixSnapEq` compare. Cache hit short-circuits on the first element (live body meshes have identity `matrixWorld` so `1 === 1` ends the loop fast). No allocations on cache hit; the snapshot is allocated only on cache miss (alongside the cached edges themselves).

## PERF 2026-05-20 (round 5) — pointermove scratch in EdgeOpGizmo
EdgeOpGizmo's window pointermove handler was allocating a fresh `new THREE.Vector2()` per event during gizmo drag. Switched to the module-level `_scratchNdc` already used by `onPointerDown`. Same scratch — onPointerDown runs once, then onMove fires until onUp, no overlap.

## PERF 2026-05-20 (round 4) — dialog edge-label memo + extracted parseEdgeLabel helper
Fillet/Chamfer dialogs both re-render on every gizmo drag tick (the `*LiveRadius` / `*LiveDistance` store subscriptions update at ~60 Hz during drag). The selected-edges list was re-parsing every edge ID on every render (`{edgeIds.map((id, i) => parseEdgeLabel(id, i))}` inline). For a circle-rim selection (~100 edges) that's ~6000 string splits + Number.toFixed per second of drag.

- Extracted the duplicated `parseEdgeLabel` from both dialogs into `edgeCutCore.ts` (the edge-ID format lives there). Added Number.isFinite guard so a malformed coord doesn't print `NaN` in the dialog.
- Both dialogs now `useMemo(() => edgeIds.map(parseEdgeLabel), [edgeIds])` so the labels are computed only when the selection actually changes; render is a cheap `edgeLabels[i]` lookup.

## PERF 2026-05-20 (round 3) — index-aware buildTriangleList + half-edge integer keys + shared-material single-pulse + parse consolidation
Round 3 followups:

- **`buildTriangleList` now handles BOTH indexed and non-indexed geometry.** The driver (`computeEdgeCutGeometry`) still expects non-indexed because the CSG operand path requires it; but read-only consumers (`computeEdgeGizmoDir`) can now pass a live `THREE.BufferGeometry` straight from `liveBodyMeshes` regardless of indexing. **`EdgeOpGizmo` drops its `liveMesh.geometry.clone().toNonIndexed()` + dispose** entirely — was a per-edges-change alloc scaling with mesh tri count. As a side bonus, because `getOrBuildSrcCache` is keyed on the geometry reference and the gizmo now passes the live mesh's own geometry, **every gizmo recompute hits the cache for the lifetime of the body** (vs the old "fresh clone, fresh cache entry, immediate dispose" cycle that defeated caching).

- **`retriangulateCoplanarRegions` half-edge keys are now packed numbers** (`u·2^26 + v`) instead of `\`${u}_${v}\`` strings. Same role as the spatial-hash repack from round 1; per-region vertex IDs come from the local `vid()` counter so they're tiny non-negative integers, far under 2^26. Cuts the per-region directed-edge bookkeeping cost on complex CSG results (many small fan-collapse regions).

- **`EdgeOpEdgeHighlight` per-frame pulse: one mutation per shared material.** Every selected line shares one `selectedMat` (created once via `useMemo`), so the previous `forEach(line => applyLinePulse(line, ...))` mutated `mat.opacity` N times per frame with the identical result. Now we pulse one representative line — `mat.opacity` updates once and every line picks it up. The hover line has its own material so it's still pulsed directly. N×60 → 60 mutations/sec.

- **`EdgeOpGizmo` consolidates parse + centroid + dir into one `useMemo`.** Previously `parseEdgeCentroid` (a duplicated mini-parser) and `gizmoDir` each ran `parseEdgeIds` (or a partial reimplementation) on the same edge IDs. Now a single `computeGizmoAnchor(edgeIds)` parses once, computes both, and **fixes a latent bug**: the old `parseEdgeCentroid` only read `parts[1]`/`parts[2]` — the first chord of each edge ID — so a chained multi-segment model edge anchored the gizmo to its first chord's midpoint instead of the full edge centroid. Using `parseEdgeIds` walks every chord segment of the chain.

Tests: 14 unit tests (added 2 for indexed/non-indexed `buildTriangleList` parity and `computeEdgeGizmoDir` indexed acceptance). All 1295 existing tests pass.

## PERF 2026-05-20 (round 2) — per-srcGeo WeakMap cache + idle-gizmo invalidate guard + Set-based per-frame ID lookup
Followup pass building on round 1:

- **`edgeCutCore.ts` — WeakMap-cached `getOrBuildSrcCache(srcGeo)`** memoises `{tris, triIdx, eps}` per source-geometry reference. Both `computeEdgeCutGeometry` and `computeEdgeGizmoDir` use it. The previous code rebuilt the triangle list (3·N `THREE.Vector3` allocations) and the spatial index on every preview tick even though `EdgeOpPreview`'s `srcGeoCacheRef` already pinned the same non-indexed source geometry across all ticks of one drag. With this cache the second-and-later ticks hit the cache and do zero allocation for tris/index. WeakMap evicts automatically when the source geometry is GC'd (which happens promptly when `EdgeOpPreview` cleans up on dialog close), so no manual eviction is needed. The driver never mutates `srcGeo` — `solid` is a separate clone — so the cache stays valid for the geometry's lifetime.

- **`EdgeOpGizmo.tsx` — `lastAppliedValueRef` skip-when-unchanged guard.** The `useFrame` callback unconditionally called `invalidate()` whenever the gizmo was active, which kept R3F's `frameloop="demand"` spinning at 60 Hz even when neither the live value nor the drag offset had changed. Now the frame work and `invalidate()` only fire when the value differs from the previously applied one; `useEffect([gizmoDir, edgeCentroid])` clears the guard so a different selection re-renders next frame. Idle gizmo = idle canvas.

- **`EdgeOpEdgeHighlight.tsx` — per-frame `Set`-based membership check.** The selected-line sync built one `Set` from `edgeIds` once per frame and reused it for the cleanup pass, replacing `edgeIds.includes(id)` inside the `forEach`. Trivial on box selections (≤12) but matters on full-rim selections (~100 ids × ~100 lines × 60 fps).

- **`EdgeOpPreview.tsx` — condition + deps cleanup.** Effect gate simplified to `!parsedAndClustered || !(debouncedValue > 0)` (the memo already encodes `enabled` and `debouncedEdgeIds.length === 0` as null); effect deps reduced to `[debouncedValue, compute, scene, invalidate, parsedAndClustered]` since the omitted ones flow through the memo identity.

## PERF 2026-05-20 — O(N²) → O(N) on dedupe + clustering + numeric spatial-hash
Live-preview latency on circle-rim selections (30-100+ chord segments, sometimes doubled by tangent-edge propagation / preview re-registration) was dominated by three O(N²) hot spots that all live in `edgeCutCore.ts`:

1. **Edge dedupe** — `uniqueEdges.some(...)` scan per input edge. Replaced by `dedupEdgesByEndpoints(edges, eps)`: spatial-hash canonical-cell key per endpoint with a 3×3×3 neighbour probe for cell-boundary straddling (same probe pattern `buildTriangleIndex` already uses), unordered-pair Set lookup. O(N) instead of O(N²).
2. **Endpoint connectivity clustering** — `while(changed) for(rem)` linear-scan reconvergence. Replaced by `clusterEdgesByEndpointConnectivity(edges, eps)`: union-find keyed on canonicalised endpoint cells. O(N·α(N)).
3. **Spatial triangle index** — `triIdxKey` returned a 3-comma string; every `getCandidatesNear` lookup did 27 `Map.get` calls on freshly-concatenated strings. Switched to a packed-integer key (`packCell` packs 3×21-bit biased cell indices into a single JS number, 53-bit-safe; collision-free over a ±1M-cell range). Map became `Map<number, number[]>`; signatures of `buildTriangleIndex` / `resolveEdge` / `getCandidatesNear` updated. Also reuses a module-level scratch `Set` in `getCandidatesNear` instead of allocating per call.

**`EdgeOpPreview.tsx`** had a SECOND inline O(N²) clustering loop on the picked edges before delegating to the driver (it needed clusters to apply the `MAX_NON_CIRCLE_SEGS=6` decimation cap per-cluster, so a circular rim is kept intact while a non-circular cluster is capped). Replaced with a `useMemo` over the shared `clusterEdgesByEndpointConnectivity` — and moved the whole parse+cluster+cap work into that memo so it now only re-runs when `debouncedEdgeIds` changes (not on every `debouncedValue` tick during gizmo drag). Memo also caches the resolved `liveMesh`, `parsed`, and capped `previewEdges` together so the compute effect is a thin consumer.

**Numbers (synthetic bench, 400 input edges from a doubled 200-segment rim):** dedupe 2.8 ms (down from prior ~50-200 ms for the pairwise-near scan), cluster 1.4 ms; both run inside one rAF frame. Real-app preview latency on circular-rim fillet/chamfer drops noticeably during slider drag because the per-tick cluster recomputation is gone entirely.

**Correctness:** tolerance-equivalent to the previous `near()` predicate (eps = bbox-diagonal · 1e-4, with the 3×3×3 probe to handle within-eps points across a cell line). 12 unit tests in `src/utils/geometry/edgeCutCore.test.ts` cover: exact dup, reversed-direction dup, jittered-across-cell-boundary dup, zero-length guard, distinct-edges retention, single chain, disjoint groups, closed loop, jittered shared endpoint, and a 200-edge scaling case. tsc clean (only pre-existing `HalfEdgeMap` errors in `edgeTopology.ts` remain — unrelated, on HEAD too).

**Public API additions in `edgeCutCore.ts`:** `dedupEdgesByEndpoints(edges, eps)` and `clusterEdgesByEndpointConnectivity(edges, eps)` are exported so `EdgeOpPreview.tsx` (and any future consumer that needs to make per-cluster decisions) can share the exact same canonicalisation as the driver.

## Test harness (preview_eval, dev server :5173)
Offscreen render loop is FROZEN → screenshots are stale; rely on numeric measurement + ask user to eyeball. Hard-reload (`location.reload()`, wait ~6s) before each measurement to defeat HMR module caching. Build `PickedEdge` objects directly from the live mesh (bypasses edge-ID parsing): import `/src/store/meshRegistry.ts`, `/src/utils/geometry/chamferGeometry.ts`, `/node_modules/.vite/deps/three.js`; `srcGeo = liveMesh.geometry.clone().toNonIndexed(); srcGeo.applyMatrix4(mesh.matrixWorld)`; call `computeChamferGeometry(srcGeo.clone(), [{a,b}], dist)`; measure `position.count/3`.

---
name: R3F Critical Patterns
description: Recurring Three.js/R3F bugs that must be avoided — per-frame allocs, plane-aware math, disposal, stale closures, ref-sync, JSX bufferAttribute leaks
type: project
originSessionId: 6f52931a-2f78-47ac-9277-a63615943896
---
These patterns have caused real bugs fixed 3+ times. Apply to all viewport/interaction code.

**Per-frame allocation (60 Hz hot path — never `new THREE.*` in event handlers or `useFrame`):**
- Allocate scratch objects as stable `useRef` at component init, or module-level `const _v = new THREE.Vector3()`
- Write into scratch: `writeNDC(e, canvas, _ndc.current)` not `return new THREE.Vector2(...)`
- Drag loops, pointermove handlers, and `useFrame` callbacks are all hot paths

**Plane-aware sketch math (recurring wrong pattern: raw `p.x, p.y`):**
- Always use `GeometryEngine.getSketchAxes(sketch)` → `t1`/`t2` dot products
- Raw `p.x, p.y` only works on XY plane; breaks silently on XZ/YZ/custom planes

**Geometry disposal:**
- Every `new THREE.BufferGeometry()` must be disposed in `useEffect` cleanup
- Material singletons (`BODY_MATERIAL`/`SURFACE_MATERIAL`/`DIM_MATERIAL` in `viewport/scene/bodyMaterial.ts`; `SKETCH_MATERIAL`/`CONSTRUCTION_MATERIAL`/`CENTERLINE_MATERIAL`/`ISOPARAMETRIC_MATERIAL`/`EXTRUDE_MATERIAL` in `engine/geometryEngine/materials.ts`; `FORM_BODY_MATERIAL`; profile overlay materials in `viewport/extrude/materials.ts`; `REHYDRATED_FEATURE_MATERIAL` in `store/cad/persistence.ts`) must NEVER be disposed — tag with `userData.shared = true` (use `tagShared()` helper from `engine/geometryEngine/materials.ts`) and `removeFeature`'s disposer will skip them
- Cache eviction: when caching cloned materials per bodyId / per feature, a `useEffect([bodiesById])` must evict entries whose key disappeared — otherwise the cache leaks until the parent component unmounts

**JSX bufferAttribute with inline Float32Array leaks GPU buffers:**
- Wrong: `<bufferAttribute args={[new Float32Array([...]), 3]} />` — each render allocates a new buffer, R3F rebuilds it, old GPU buffer is orphaned
- Right: `useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute(...); return g; }, [...primitiveDeps])` + `useEffect(() => () => g.dispose(), [g])`
- Memo deps must be primitives (numbers, strings) — if you pass an array literal like `[dir]`, array identity changes every render and the memo thrashes. Use `[dir[0], dir[1], dir[2]]` or a string key.

**Stale closure / drag state:**
- Store drag state in `useRef`, not React `useState` — state updates are async and cause stale reads mid-drag
- Use `useCADStore.getState()` inside event handlers, not reactive subscriptions

**Ref sync for state read in long-lived DOM listeners (the dep-storm fix):**
- Problem: if a DOM listener closure reads `stateVal`, putting it in `useEffect(..., [stateVal])` re-attaches the listener on every change — fatal when `stateVal` is `mousePos` (fires on every pointermove). Listeners get torn down mid-event and events are silently dropped.
- Fix: `const myRef = useRef(stateVal); useEffect(() => { myRef.current = stateVal; }, [stateVal]);` Handlers read `myRef.current` instead. Remove `stateVal` from the listener-binding effect's deps.
- Mutating the ref DURING render (`myRef.current = stateVal;` outside useEffect) trips `react-hooks/refs` lint — always sync via useEffect.

**Click vs drag suppression:**
- Use a `didDragRef = useRef(false)` boolean, reset on pointerdown, set on pointermove — check in click handler
- OR measure distance between pointerdown and click positions, skip click if > 5px
- Don't use `dragRef.current && !dragRef.current.active` — fragile with async state

**Right-click + context menu:**
- `onContextMenu` fires AFTER mouseup. To suppress on right-drag pan, track right-button pointerdown position in a ref, compare to the contextmenu event's clientX/Y, and skip if moved > 5px. Always `e.preventDefault()` the native menu regardless.

**Material mutation — never in render:**
- Never assign `mesh.material = X` inside JSX `.map()` or render body — React may run renders multiple times (Strict Mode) and there's no cleanup path
- Always use `useEffect` for material changes: stash original in `mesh.userData._origMaterial`, restore on cleanup
- Pattern: `if (dim) { stash + assign DIM_MATERIAL } else { restore _origMaterial }` in `useEffect([deps])`

**Animated material clones — one per component, not one per state:**
- Wrong: `const animatedMat = useMemo(() => srcMaterial.clone(), [state])` — re-clones + disposes on every state change, and if the mesh memo has `animatedMat` as a dep the entire geometry gets re-triangulated too
- Right: `const animatedMat = useMemo(() => srcMaterial.clone(), [])` (one clone per component life). Mutate `color` / `opacity` / `emissiveIntensity` in place inside `useFrame`. Dispose in a separate `useEffect(() => () => animatedMat.dispose(), [animatedMat])`.

**`frameloop="demand"` + useFrame must call `invalidate()`:**
- Writes like `m.opacity = 0.5` inside `useFrame` do nothing unless a render is triggered
- Call `invalidate()` after any per-frame mutation. For steady states (e.g. no pulsing), guard with "did anything change?" so invalidate isn't called every frame

**Shell / offset meshes — weld vertices first:**
- `shellMesh` and similar offset operations MUST `mergeVertices` to weld coincident corners before calling `computeVertexNormals` and offsetting along normals
- If you operate on non-indexed geometry, each triangle has its own copy of each corner vertex → `computeVertexNormals` gives per-triangle face normals (not averaged) → offsetting opens seams between adjacent triangles → torn shell
- Drop the existing `normal` attribute before `mergeVertices` so it unifies purely by position

**Connected-components split for disconnected geometry:**
- `GeometryEngine.splitByConnectedComponents(geom, tol)` groups triangles by shared vertex positions (spatial-hash union-find) and returns one BufferGeometry per component
- Output is sorted deterministically by centroid so commit-time and render-time splits agree on which piece → which bodyId
- Returns `[inputGeom]` (same reference) when singly connected — callers must handle the single-part case without double-disposing

---
name: Cindr3D Gotchas
description: Non-obvious bugs, version pins, broken third-party APIs, and hook rules that have already cost time in this repo
type: project
---

Things that are NOT obvious from reading the current code, and would burn time to rediscover.

## Build / tooling
- **Vite 8 uses rolldown** — TypeScript interfaces MUST be imported with `import type { ... }`, otherwise rolldown emits `MISSING_EXPORT` errors. Applies to `ThreeEvent` from `@react-three/fiber` in particular.
- **VS 2026 .esproj SDK pinned to `1.0.4338480`.** Unpinning produces "SDK not found" because that version is bundled with VS 2026.
- **`npm run build` fails on pre-existing TS errors** in Slicer / Duet / Printer files (TS6133 unused-var, TS2339 missing-property). `npx tsc --noEmit` is the clean check during CAD/sketch work — ignore the unrelated build failures unless touching those files.

## React Three Fiber / drei
- **Minimum R3F version is 9.6.0.** Earlier 9.5.x produced `THREE.Clock` deprecation warnings against three.js r170+. Don't downgrade.
- **drei `<Grid infiniteGrid>` is broken for non-horizontal planes.** For sketch planes use `THREE.GridHelper` wrapped in a rotated `<group>` instead.
- **Never dispose shared module-level materials** (`SKETCH_MATERIAL`, `EXTRUDE_MATERIAL` in `GeometryEngine.ts`) inside per-component cleanup — they're singletons reused across instances.

## React rules that already crashed the app
- **All `useCADStore(...)` hook calls must come before any early return.** Calling a hook after `if (!hasAny) return null` triggered "Rendered more hooks than during the previous render" + WebGL Context Lost. `ComponentTree.tsx` is the file that hit it.

## Sketch math
- **`GeometryEngine.getPlaneAxes(plane)` is the single source of truth for sketch-plane tangent vectors `t1`/`t2`.** Used by both the engine and `Viewport.tsx`. Never hardcode `dx`/`dy`/`dz` for sketch math — it works on XZ but is wrong on XY and YZ. Arc angles must be `Math.atan2(v, u)` in plane-local coords, not world deltas.

## Form / SubdivisionEngine
- **FormBodies uses per-instance (module-level) materials, not per-component.** They are module-level constants in `FormBodies.tsx` (not in `GeometryEngine.ts`) and are safe to keep alive but must NOT be disposed. Pattern is intentional — four materials cover all render states, no allocation per body.
- **SubdivisionEngine.subdivide capped at level 3.** FormBodies clamps `subdivisionLevel` to `Math.max(0, Math.min(level, 3))`. Level 3 on a 6-face box = 6×4^3 = 384 quads → 768 triangles; level 4 would be 1536. Don't raise the cap without profiling.
- **useMemo for geo + useEffect for disposal.** FormBodyMesh builds geometries in `useMemo([cage])` and disposes them in `useEffect([smoothGeo, wireGeo])` cleanup. This pattern keeps disposal tied to the PREVIOUS geometry when the memo recomputes.

## Toolbar
- **`ToolButton` dropdowns render INSIDE the button container** (no portal), so they get clipped by `.ribbon-content { overflow-y: hidden }`. Section-level flyouts already use `createPortal`. If a `ToolButton` dropdown ever extends past the ribbon, port it to a portal too.

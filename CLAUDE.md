# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What's Being Built

**Cindr3D** — a web-based CAD + slicer + Duet3D printer-control app. Three parity targets:
- **Design workspace** → Fusion 360 UX/feature parity
- **Slicer workspace** → UltiMaker Cura 5.x parity (reference: `fdmprinter.def.json`)
- **Printer panel** → Duet3D Web Control (DWC) parity (standalone `/rr_*` and SBC `/machine/*` modes)

Pending/done work is tracked in `TaskLists.txt` at the repo root (`[x]` done, `[s]` storage-only, `[ ]` not started, `[.]` in progress, `[skip]` intentional no-op).

## Commands

```bash
npm run dev           # start dev server
npm run dev:fresh     # clear Vite cache then start
npm run typecheck     # tsc --noEmit (use this during CAD/sketch work — build fails on unrelated TS errors)
npm run test:run      # run tests once (vitest run)
npm run test          # vitest watch mode
npm run lint          # eslint
npm run build         # full production build (tsc + vite + SEO pages)
```

Run a single test file:
```bash
npx vitest run src/test/MyFile.test.ts
```

TypeScript check only (no emit):
```bash
npx tsc --noEmit
```

**Note:** `npm run build` fails on pre-existing TS errors in Slicer/Duet/Printer files (TS6133, TS2339). Use `npx tsc --noEmit` during CAD/sketch work and ignore unrelated failures.

## Code Navigation — Use GitNexus First

Before searching for files, always run a GitNexus query:
```bash
npx gitnexus query "...concept..." --repo Cindr3D
```

The `memory/` folder is a curated index of architectural decisions. Read `memory/MEMORY.md` first, then the relevant topic file — this is far cheaper than spawning Explore agents. Use `rg`/Glob only to verify or narrow GitNexus results.

**Before editing any symbol**, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and check blast radius. Never rename symbols with find-and-replace — use `gitnexus_rename`.

## Architecture

### Shim + Subdir Pattern (Critical)

Many former monoliths are now 2-30 line re-export shims. **Add new code to the submodule, never to the shim.**

| Shim file | Real code location |
|-----------|-------------------|
| `engine/GeometryEngine.ts` | `engine/geometryEngine/{core,operations}/` |
| `engine/slicer/Slicer.ts` | `engine/slicer/{pipeline,geometry,gcode}/` |
| `store/cadStore.ts` | `store/cad/slices/*Slice.ts` + `store/cad/slices/<slice>/*Actions.ts` |
| `store/slicerStore.ts` | `store/slicer/actions/*.ts`, `store/slicer/plateActions.ts` |
| `store/componentStore.ts` | `store/component/actions/*.ts` |
| `store/printerStore.ts` | `store/printer/actions/*.ts` |
| `App.tsx` | `src/app/` |
| `types/cad.ts`, `types/slicer.ts` | `types/<area>.types.ts` per concern |

### Store Layout

`useCADStore` is composed of 9 slices in `store/cad/slices/*Slice.ts`. Several slices split further into `<slice>/<area>Actions.ts` (e.g., `extrudeRevolve/extrudeCommitActions.ts`). State types in `state/{coreState,modelingState,analysisState,workflowState}.ts`. Same pattern for componentStore/printerStore/slicerStore — each has `actions/` + `storeApi.ts` + `persistence.ts`.

### Workspace Anchors

- `src/components/` — `viewport/`, `toolbar/`, `panels/`, `dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`, `slicer/`, `printer/`
- `src/engine/` — geometry engine, slicer pipeline, `SubdivisionEngine.ts` (Catmull-Clark)
- `src/store/meshRegistry.ts` — module-level `Map<string, THREE.Mesh>` (`liveBodyMeshes`); import directly, not a Zustand store
- `src/services/DuetService.ts` — façade + `duet/` per-concern modules
- `src/workers/SlicerWorker.ts` — off-main-thread slicer; warms WASM modules at boot
- `src/calibration/` — 7-step printer-tuning wizard
- `src/services/vision/` — multimodal-LLM analyzers (failureDetector, tuningWizards, printDiagnostics); accept `VisionProviderConfig { provider, model, apiKey }`

### Persistence

- `cadStore` → IndexedDB `cindr3d-cad` (`store/cad/persistence.ts`); waits for componentStore hydration to prevent double-add
- `slicerStore` → IndexedDB (IDB adapter + `serializeGeom`/`deserializeGeom`)
- `printerStore` → localStorage `cindr3d-duet-config`
- `themeStore` → localStorage `cindr3d-theme`

## Where to Add Things

| Task | Where |
|------|-------|
| New sketch tool | `types/cad.ts` `Tool` union → `toolbar/Toolbar.tsx` → `viewport/interaction/sketchInteraction/commitHandlers/<family>.ts` |
| New ribbon button | `toolbar/Toolbar.tsx` + per-tab `Ribbon*Tab.tsx` |
| New dialog | `components/dialogs/<category>/<Name>Dialog.tsx` |
| New slicer setting | Type in `types/slicer/`, UI in `components/slicer/printProfileSettings/`, engine in `engine/slicer/pipeline/` |
| New geometry op | `engine/geometryEngine/core/{mesh,sketch,solid,surface}/` or `operations/meshOps/` |
| New edge-modification tool | OCC BRep path only (select OCC edge IDs, draw guides from OCC tessellation); do NOT reintroduce removed mesh-CSG files |
| New store action | `store/<name>/{slices,actions}/` — never in the store shim |
| New Duet API call | Pick sibling module by concern in `src/services/duet/`; use `fetchOrThrow`/`requestJsonOrText` for transport; add thin forwarding wrapper to `DuetService.ts` only |
| New calibration test | Card in `calibrationContent.ts`, G-code in `engine/calibration/`, preset in `calibrationSlicePresets.ts` |

## Coding Rules

### Split by Responsibility, Not Line Count

When a file passes ~500 lines, scan for hidden concerns — async workflows, sub-regions of UI, modals/dialogs, pure helpers, constants/presets, side-effect setup, visualizations. Extract each into its own file. Follow the shim+subdir pattern. A split must be complete in one commit — don't leave orphaned copies.

**Reach for shared abstraction on second use:**
- `src/components/ui/Modal.tsx` — `Modal`/`ModalBody`/`ModalFooter` + `useModalKeys`
- `src/components/dialogs/common/` — `CollapsibleSection`, `FaceSelector`, `SegmentedIconGroup`, `ToolPanel.css`
- `engine/geometryEngine/materials.ts` — `tagShared()` + singleton materials

### Dialog Style

All new tool dialogs use `src/components/dialogs/common/ToolPanel.css` with `tool-panel` + `tp-*` classes. Non-modal, floats top-right, no overlay backdrop. Use `<ExpressionInput>` for numbers, `tp-toggle` for booleans. **ExtrudePanel.tsx** and **HoleDialog.tsx** are reference implementations. Migrate any old `dialog-overlay` style dialogs you touch.

### Plane-Aware Math

Always `getSketchAxes(sketch)` → `t1`/`t2` dot products. Raw `p.x, p.y` only works on XY and breaks silently on XZ/YZ/custom planes. This is a recurring bug fixed 3+ times.

### Material Singletons — Never Dispose

Singletons live in: `viewport/scene/bodyMaterial.ts`, `engine/geometryEngine/materials.ts`, `viewport/extrude/materials.ts`, `store/cad/persistence.ts`. Tag with `userData.shared = true` via `tagShared()` helper. Disposers must skip these.

### Vite 8 / Rolldown

TypeScript interfaces **must** be imported with `import type { ... }` — rolldown emits `MISSING_EXPORT` without it. Applies especially to `ThreeEvent` from `@react-three/fiber`.

## R3F Critical Patterns

- **Per-frame allocations:** allocate scratch objects as stable `useRef` or module-level `const _v = new THREE.Vector3()`. Never `new THREE.*` in event handlers or `useFrame`.
- **Geometry disposal:** every `new THREE.BufferGeometry()` must be disposed in `useEffect` cleanup.
- **JSX bufferAttribute:** never `<bufferAttribute args={[new Float32Array([...]), 3]} />` — allocates a new GPU buffer every render. Use `useMemo` + `useEffect` dispose instead.
- **Stale closure / drag state:** store drag state in `useRef`, not `useState`. Use `useCADStore.getState()` in event handlers.
- **Ref-sync for DOM listeners:** mirror state to `useRef` via `useEffect`; handlers read `ref.current`. Never put frequently-changing state (e.g., `mousePos`) in listener-binding effect deps.
- **Material mutation:** never assign `mesh.material` in render. Always use `useEffect`; stash original in `mesh.userData._origMaterial`.
- **Animated material clones:** clone once at mount (`useMemo(() => mat.clone(), [])`), mutate in `useFrame`, dispose in separate `useEffect`.
- **`frameloop="demand"`:** call `invalidate()` after any per-frame mutation.
- **`useCADStore` hooks:** all hook calls must come before any early return — hooks after `if (!x) return null` crash the app.
- **R3F minimum version: 9.6.0.** Don't downgrade.

## WASM / OCCT Patterns

- WASM `.js`/`.wasm` files in `wasm/dist/` are tracked in git. Toolchain is gitignored (`wasm/Dockerfile` is canonical).
- Use `EXPORTED_RUNTIME_METHODS: ['HEAPF64','HEAP32']` — `HEAPI32` is the old alias.
- `Float64Array` byteOffset must be 8-aligned; use `align8 = n => (n + 7) & ~7` accumulator.
- Single-instance C++ state: wrap JS adapter in a Promise-chained `inFlight` queue so concurrent callers serialize.

**OCCT VIEW vs owned allocation — never `.delete()` a VIEW:**

| Call | Safe to delete? |
|------|----------------|
| `map.FindKey(i)` / `FindKey_1(i)` | ❌ VIEW — map owns it |
| `TopoDS::Face_1(s)` / `Edge_1` / `Vertex_1` | ❌ VIEW |
| `faceMaker.Face()` / `polygonMaker.Wire()` | ❌ VIEW — maker owns it |
| `explorer.Current()` | ✅ owned copy |
| `occWrap(obj, type)` / `new OccHandle(...)` | ✅ owned handle |

OCCT face holes require `REVERSED` topological orientation: call `holeWire.Reversed()` to get a FORWARD→REVERSED `TopoDS_Shape`, then cast via `oc.TopoDS.Wire_1()` (VIEW, don't delete) before `faceMaker.Add()`.

`FindKey` vs `FindKey_1`: always check both — build variant determines which exists.

## Slicer Engine Invariants

- **Layer height:** `const layerH = li === 0 ? layerZs[0] : layerZs[li] - layerZs[li-1]`. Never use `pp.layerHeight` for per-layer math (adaptive layers produce variable spacing).
- **Two emission sites:** any wall change must touch BOTH `groupOuterWalls` pre-pass (`emitGroupedAndContourWalls.ts`) AND main inline path. Same applies to scarf seam logic.
- **`calcExtrusion` is a method:** always call `emitter.calculateExtrusion(...)` — never a free function.
- **Arachne:** gated on `printProfile.wallGenerator: 'arachne'`. WASM backend ~9× faster. `ARACHNE_MAX_EDGES = 400` falls back to classic for JS backend.
- **Layer-material cache:** `run.layerMaterialCache` populated by sequential pre-pass before main emit loop. Workers receive `layerMaterialCache: []` — don't attempt to populate in workers.

## Sketch Interaction Pipeline

Chain-of-responsibility in `commitTool.ts`: `handleBasicSketchCommit` → `handleTangentSketchCommit` → `handleCurveSketchCommit` → `handleEditingSketchCommit`. Order matters for perf — basic first. To add a new sketch tool, add it to the right existing handler family.

Preview uses a 32-entry LRU `PREVIEW_FINGERPRINT_CACHE`. If you add a new preview input, add it to `previewFingerprint()` or previews go stale.

## Types

All type definition files go in the `types/` folder named by area (e.g., `types/slicer/wallTypes.ts`). Never bloat `cad.ts` or `slicer.ts` shims.

## Styles

Prefer CSS classes over inline styles, especially in slicer workspace components. Avoid passthrough wrapper components — import implementation components directly.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Cindr3D** (39272 symbols, 62469 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Cindr3D/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Cindr3D/clusters` | All functional areas |
| `gitnexus://repo/Cindr3D/processes` | All execution flows |
| `gitnexus://repo/Cindr3D/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

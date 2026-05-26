---
name: Agents on Cindr3D — hot-conflict files
description: Cindr3D-specific hot files for ONE-agent-at-a-time rule (the rule itself lives in global session_rules)
type: feedback
---
Global `feedback_session_rules.md` already mandates one background agent at a time. Cindr3D-specific addendum: the 2026-04 refactor broke old monolith hot files into shim + subdirs, so conflict surface moved. Never run two agents that might touch the same file below.

**GitNexus-first search rule:** when an agent needs to locate files, discover where a feature lives, or choose what to inspect/edit, it must run a GitNexus query first. Use filesystem search (`rg`, Glob, file tree scans) only after GitNexus has supplied candidate symbols/flows/paths.

**GitNexus repo name:** this project is indexed as **`Cindr3D`**. Always pass `repo: "Cindr3D"` to every GitNexus tool call — the index spans multiple repos and queries without `repo` silently search the wrong one. CLI equivalent: `npx gitnexus query "..." --repo Cindr3D`.

**Current hot files** (post-refactor):
- `src/store/cadStore.ts` (shim) and `src/store/cad/state.ts` / `state/*.ts` (types + aggregator)
- `src/store/cad/slices/*Slice.ts` + `src/store/cad/slices/<slice>/*Actions.ts` — the per-slice action files are now the real editing targets
- `src/store/slicerStore.ts` (shim), `src/store/slicer/actions/*.ts`, `src/store/slicer/plateActions.ts`
- `src/store/componentStore.ts` (shim), `src/store/component/actions/*.ts`
- `src/store/printerStore.ts` (shim), `src/store/printer/actions/*.ts`
- `src/App.tsx` (43 lines) and `src/app/ActiveDialog.tsx` (dialog routing)
- `src/components/toolbar/Toolbar.tsx` + `designMenuBuilders.tsx` / `sketchMenuBuilders.tsx` / `menuBuilders.tsx`
- `src/types/cad/*`, `src/types/slicer/*`, and the many `*.types.ts` files (touch one at a time — cross-cutting type edits are a frequent conflict vector)
- `src/engine/geometryEngine/core/GeometryEngine.ts` and `core/{mesh,sketch,solid,surface}/*.ts`
- `src/engine/slicer/pipeline/execution/*.ts`, `pipeline/perimeters.ts`, `geometry/coreGeometry.ts` (bridge/seam/adaptive layers)

**TSC-OK gate:** after each agent completes, run `npx tsc --noEmit` (via `.ps1` file — see global `ref_powershell_tsc.md`) before launching the next.

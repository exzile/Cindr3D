---
name: Cindr3D Code Graph
description: Where the durable architectural anchors live — read before exploring. Granular file paths shifted in the 2026-04 refactor; use Glob for live locations.
type: project
---

**Read this first** for "where is X" questions, then run a targeted `Glob`/`Grep` for the live file. The 2026-04 refactor moved many monoliths into shim+subdir form, so granular file paths shift; the architectural anchors below stay stable.

## Workspace layout (stable anchors)

- `src/components/` — `viewport/`, `toolbar/`, `panels/`, `dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`, `slicer/`, `printer/`
- `src/engine/` — `geometryEngine/{core,operations}/` (real code; `engine/GeometryEngine.ts` is a 2-line shim), `slicer/{geometry,pipeline,gcode}/` (real code; `engine/Slicer.ts` was removed, `engine/slicer/Slicer.ts` is a tiny `SlicePipeline` subclass), `SubdivisionEngine.ts` (Catmull-Clark for Form workspace)
- `src/store/` — Zustand stores: `cadStore`, `slicerStore`, `componentStore`, `printerStore`, `themeStore`. Each big store is now a shim that composes per-area slices/actions in a `<store>/` subdir. **Never put new logic in the shim.**
- `src/types/` — fragmented `*.types.ts` files per concern (cad, slicer, duet, picker, settings, sketch-commit, etc.). `cad.ts` and `slicer.ts` are re-exports.
- `src/services/` — `DuetService.ts` façade + `duet/` per-concern modules; `OctoPrintService.ts`. See `auto-memory/duet_service_architecture.md`.
- `src/workers/SlicerWorker.ts` — slicer off-main-thread. Warms WASM modules at boot.
- `src/utils/expressionEval.ts` — parameter expression evaluator.
- `src/calibration/` — 7-step printer-tuning wizard (`wizard/CalibrationWizard.tsx`, `wizard/steps/Step*.tsx`), STL/G-code generators in `engine/calibration/`, slice presets per test in `calibration/calibrationSlicePresets.ts`, camera capture in `calibration/camera/CalibrationCameraCapture.tsx`.
- `src/services/vision/` — multimodal-LLM analyzers: `failureDetector.ts` (in-flight spaghetti/layer-shift), `tuningWizards.ts` (calibration-photo recommendations), `printDiagnostics.ts`, `cameraPose.ts`. All accept a `VisionProviderConfig { provider, model, apiKey }` and call Anthropic or OpenAI/OpenRouter directly from the browser.
- `src/services/calibration/calibrationPhotoStore.ts` — IDB-backed Blob store (`cindr3d-calibration-photos` / `photos`) for calibration result photos. Keyed by photo ID; `CalibrationResult.photoIds` holds the IDs. Survives reloads without bloating localStorage. Renders go through `components/printer/calibration/results/CalibrationResultThumbnail.tsx` (async object-URL with revoke-on-unmount).

## Where to add common things

| Need | Where |
|---|---|
| New sketch tool | `types/cad.ts` `Tool` union → `toolbar/Toolbar.tsx` ribbon → `viewport/interaction/sketchInteraction/commitHandlers/<family>.ts` (chain-of-responsibility, see `auto-memory/sketch_interaction_pipeline.md`) |
| New ribbon button | `toolbar/Toolbar.tsx` + per-tab `Ribbon*Tab.tsx` (split files in 2026-04) |
| New dialog | `components/dialogs/<category>/<Name>Dialog.tsx` matching the existing categories |
| New slicer setting | Type in `types/slicer/`, UI in `components/slicer/printProfileSettings/`, engine in `engine/slicer/pipeline/` (and update `slicer_gaps.md` if engine still stubs it) |
| New geometry op | `engine/geometryEngine/core/{mesh,sketch,solid,surface}/` or `operations/meshOps/` — never in the `GeometryEngine.ts` shim |
| New store action | `store/<name>/{slices,actions}/` — never in the store shim |
| New WASM op | See `auto-memory/wasm_patterns.md` |
| Sketch dimension behavior | Tool hook `viewport/interaction/sketchInteraction/hooks/useSketchDimensionTool.ts` (merge-scarred — read every branch). `activeDimensionType` defaults to `'auto'` (modeless smart inference: in the universal block `effectiveType = activeDimensionType==='auto' ? 'linear' : activeDimensionType`; explicit modes are power-user overrides). Pure math in `engine/dimensionPlacement.ts` (`inferLinearPlacement` cursor→orientation; `pointToLineDistance` point→infinite-line, both unit-tested in `src/test/DimensionPlacement.test.ts`). Ghost preview = transient `dimensionPreview` store field (modelingState + sketchUiActions, NOT persisted) rendered by `viewport/scene/SketchDimensionPreview.tsx` (singleton `DIMENSION_PREVIEW_MATERIAL`, useMemo-geo + useEffect-dispose); point→foot branch mirrored in `SketchDimensionAnnotations.tsx`. Annotation math `engine/DimensionEngine.ts`; one-way resize `engine/dimensionResizeUtils.ts`. Constraint solver is a real Newton-Raphson (`engine/ConstraintSolver.ts`); `engine/sketchSolveInputs.ts` `buildSketchSolveInputs` is the SHARED projection+constraint builder used by BOTH the real `solveSketch` (constraintAndViewActions) and the predictive `engine/overConstraintCheck.ts` `wouldOverConstrain` (so trial==reality). Over-constraint interception via single shared `interceptOverConstraint` helper in the dimension hook: `commitDimension` routes through it AND a thin `interceptAndClearPreview` adapter guards every direct-`addSketchDimension` bypass site (inferred circle→diameter, arc→radial, explicit arc-length, `_addCircleOrArcDimension`). Edit path: `commitSketchDimEdit`. Raises transient `pendingOverConstraint` (modelingState/sketchUiActions, NOT persisted) → `OverConstraintDialog.tsx` (ui/Modal) offers Create-driven / Cancel. Detection is universal across all dimension types: `arc-length` is now a real `dimension-arc-length` solver constraint (detection-parity with radial/diameter — residual `r·normalizedSweep − value` identical to `DimensionEngine.computeArcLengthDimension`; radius/angles not solver DOFs so Jacobian row ~0, no instability). Wiring is logic-tested (`OverConstraintCheck.test.ts` + `OverConstraintInterception.test.ts` drive the real store actions: edit→prompt→resolve-driven/cancel-revert). OPEN: live visual/interactive QA of `OverConstraintDialog` (modal look + false-positive feel on near-singular sketches) needs a human click-through — not automatable |
| New calibration test | Card in `components/printer/calibration/calibrationContent.ts` `CALIBRATION_CARDS`, G-code generator in `engine/calibration/`, slice preset in `calibration/calibrationSlicePresets.ts`, then add a `tuningKindForTest` mapping + manual field in `calibration/wizard/steps/StepInspect.tsx` |
| AI photo analysis for a calibration test | Extend `TuningWizardKind` + `kindGuidance` in `services/vision/tuningWizards.ts`; if the test has tower-style bands, pass `startValue`/`stepPerMm`/`towerHeightMm` in `TuningTowerContext` so the model can map a visible band to a value. Per-test wiring lives under `calibration/wizard/steps/inspect/` (shim + subdir): add the test to `inspectHelpers.tuningKindForTest`, derive its context in a sibling `<test>Context.ts`, surface it via `useTestContext` + `useTuningAnalysis`, and add tips in `PhotoGuidance.tsx`. `StepInspect.tsx` itself is a thin composer — do NOT push new logic back into it, and do NOT re-introduce a `fallbackProvider()` with an empty key (provider config comes from `useAiAssistantStore`) |
| Calibration photo / history persistence | Photos written by `StepApplyResult.saveResult()` via `services/calibration/calibrationPhotoStore.ts` (one IDB transaction per save), photo IDs land in `CalibrationResult.photoIds`. History UI lives in `components/printer/calibration/results/{CalibrationResultsSection,CalibrationResultsHistory,CalibrationResultThumbnail}.tsx` — each a focused file. Mount the section in `PrinterCalibrationPanel.tsx` alongside `CalibrationAgingSection` |

## Plane-axis math (single source of truth)

`GeometryEngine.getSketchAxes(sketch)` for `t1`/`t2` — handles named planes (XY/XZ/YZ) AND custom. Use this over `getPlaneAxes(plane)` when you have the full Sketch. Raw `p.x, p.y` is wrong on non-XY planes (recurring bug — see `gotchas.md`).

## Persistence schemas

- `cadStore` → IndexedDB `cindr3d-cad`. Schema in `store/cad/persistence.ts` (`partialize` + `onRehydrateStorage`). Mesh rebuild on load. Coordinates with componentStore hydration to avoid double-add on refresh.
- `slicerStore` → IndexedDB. Reference template for `idbStorage` adapter + `serializeGeom`/`deserializeGeom`.
- `printerStore` → localStorage `cindr3d-duet-config`.
- `themeStore` → localStorage `cindr3d-theme`.

## Cross-references

Detailed pipeline docs live under auto-memory at `~/.claude/projects/C--Users-joeyp-source-repos-exzile-Cindr3D/memory/`:
- `project_designcad.md` — fuller architectural snapshot (shim+subdir, store slices, material singletons, persistence caches)
- `extrude_pipeline.md`, `slicer_engine.md`, `arachne_subsystem.md`, `sketch_interaction_pipeline.md`, `duet_service_architecture.md`
- `r3f_critical_patterns.md` — recurring R3F bug catalog
- `wasm_patterns.md` — emsdk adapter gotchas

---
name: Sketch Interaction Pipeline
description: Chain-of-responsibility commit dispatch + parallel preview pipeline with fingerprint LRU, SketchCommitCtx shape, where to add new tools
type: project
originSessionId: 768c4a3e-fc4c-4a2b-ba31-60db44f6dc31
---
Sketch tool runtime split into preview (per-frame, non-committing) and commit (on-click). Both driven by a `ctx` object assembled by `SketchInteraction.tsx` (orchestrator) and dispatched across small handler modules in `viewport/interaction/sketchInteraction/`.

## Commit chain — `commitTool.ts`

Pure chain-of-responsibility, first handler returning `true` wins:
```
HANDLERS = [
  handleBasicSketchCommit,    // commitHandlers/basicHandlers.ts  (line, circle, rect — hot path)
  handleTangentSketchCommit,  // commitHandlers/tangentHandlers.ts
  handleCurveSketchCommit,    // commitHandlers/curveHandlers.ts
  handleEditingSketchCommit,  // commitHandlers/editingHandlers.ts (most expensive — hit-tests entities)
]
```
**Order matters for perf** — basic first because it's hot. Editing further split in `commitHandlers/editing/{corner,curve,line}EditingHandlers.ts`.

**To add a new tool:** add the activeTool string to the right existing handler. Don't create a new top-level handler unless it's a brand-new family.

## SketchCommitCtx — `types/sketch-commit.types.ts`

Flat shape: `activeTool`, `activeSketch`, `sketchPoint`, `drawingPoints` + `setDrawingPoints`, `t1`/`t2` plane-axis vectors (never raw `p.x, p.y`), `projectToPlane`, `addSketchEntity`, `replaceSketchEntities`, `cycleEntityLinetype`, HUD values (`polygonSides`, `filletRadius`, `chamfer*`, `tangentCircleRadius`, `conicRho`, `blendCurveMode`). Changing this shape touches every handler.

## Preview pipeline — `previewTool.ts`

Parallel structure to commit. **32-entry LRU `PREVIEW_FINGERPRINT_CACHE`** keyed by activeTool group, value = `"${activeTool}|${mousePos}|${drawingPoints}|${isDraggingArc}|${conicRho}|${blendCurveMode}"` rounded to 4 decimals. Skip re-render when fingerprint unchanged.

**If you add a new preview input that affects output, add it to `previewFingerprint()`** or previews ghost-stale.

`clearGroupChildren(previewGroup)` disposes geometries, NOT materials (singletons from `engine/geometryEngine/materials.ts`).

## Event wiring — `hooks/useSketchInteractionEvents.ts`

Pointer listeners attach via refs, not reactive state — the ref-sync-in-effect pattern from `r3f_critical_patterns.md`. New listener-read state must mirror to a `useRef` inside `useEffect([state])`, never in deps that would re-attach on every pointermove.

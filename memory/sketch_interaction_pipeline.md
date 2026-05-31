---
name: Sketch Interaction Pipeline
description: Chain-of-responsibility commit dispatch + parallel preview pipeline with fingerprint LRU, SketchCommitCtx shape, where to add new tools
type: project
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

## Shape editing (polygon + rectangle parametric glyphs)

Regular polygons and rectangles are committed as N/4 individual `line` entities, then **grouped** under a marker constraint so they stay editable:
- `'polygon'` constraint carries `polygonMeta { center, radius, baseAngle, kind }` (radius = cursor distance: circumradius for inscribed, apothem for circumscribed). `'rectangle'` constraint carries `rectangleMeta { center, width, height, rotation }`.
- These constraint types are **pure grouping markers** — the Newton solver's default case ignores them (no residual). Adding a new shape type to `ConstraintType` is safe as long as the solver doesn't need a residual.
- `regeneratePolygon(id, sides)` / `regenerateRectangle(id, w, h)` in `store/cad/slices/.../sketchEditing/polygonEditActions.ts` rebuild the member lines from the meta (kind-aware for polygons: inscribed keeps the circumscribing circle, circumscribed keeps the inscribed circle), replace entities, and re-add constraints. `replaceSketchEntities` auto-drops constraints whose entityIds were removed.
- **`PolygonConstraintOverlay.tsx`** (mounted in `Viewport.tsx`, despite the name handles BOTH shapes) renders a clickable Html glyph at each shape center → inline editor (sides / width×height), auto-focused, Enter/Escape/click-outside closes, delete button. Shared `editingPolygonConstraintId` store field tracks which is open; polygon commits set it for auto-open-on-draw.
- `SketchConstraintOverlay.tsx` (the THREE-line glyph renderer) **skips** `'polygon'`/`'rectangle'` so the interactive Html glyph isn't doubled by a default dot.
- Committed **ellipse** render (`sketchRendering.createEllipse`) returns a **Group** (curve + dashed major/minor construction axes); disposal is traverse-based so nested lines are freed.

## Snap engine — `SketchInteraction.tsx` findSnapCandidate

- Snap radius is **screen-space** (~12 px), computed via camera FOV/depth — NOT a fixed world-space mm. Zoom-invariant.
- Priority tiers: endpoint/center (1) > intersection (2) > midpoint/perp/tangent (3) > nearest (4) > grid (5). Higher priority wins over geometrically closer lower-priority snap.
- Intersection snap covers line-line, **line-circle**, and **circle-circle** (analytic 2D solutions).
- Midpoint snap includes **arc midpoint** (point at (startAngle+endAngle)/2).
- Center snap includes **ellipse/elliptical-arc** (center = points[0]).
- Nearest snap (lowest priority): foot of perpendicular onto line, radial projection onto circle.
- Endpoint snap uses **exact entity geometry** (arc start/end, spline knots, rect corners) — NOT the old O(mesh-verts) scene traverse.
- SnapType union (`types/cad/core.ts`) now matches runtime: includes `'perpendicular'` and `'tangent'`.

## Constraint tool — `hooks/useSketchConstraintTool.ts`

- **coincident/midpoint/concentric/symmetric** capture `pointIndices` (nearest endpoint hit-test) so the correct endpoint pair is bonded.
- **symmetric** prompts "entity 1 → entity 2 → axis line" and reorders to `[axisId, e1, e2]` before dispatch (solver expects this order).
- **equal** rejects line+circle mixed pairs with a clear message.
- **arc** pick is clamped to the arc's angular sweep — can't select the un-drawn side.
- Dedupe key in `addSketchConstraint` includes `pointIndices` so p0↔p1 and p1↔p0 coincidents are distinct.

## Arc orientation invariants (SKETCH-2 fixes — 2026-05-31)

Renderer forces CCW arcs (`createArc` in `sketchRendering.ts`). All commit handlers must guarantee the intended arc is CCW:
- **arc-3point**: after computing start/end from atan2, verify through-point lies on CCW arc; swap if not.
- **tangent-arc**: check CCW start tangent vs incoming tangentDir; swap if dot < 0.
- **circle-2tangent / circle-3tangent**: `toUV`/`toUV3` subtract `planeOrigin` before projecting; center reconstruction adds it back.
- **slot / slot-center** c1 cap: `axisAngle + π/2 → axisAngle + 3π/2` (not perpAngle).
- **slot-3point-arc / slot-center-arc** caps: use actual radial angles of p0/p2 from C, independent of arcSA/arcEA swap.

## Rectangle commit (B11.a — 2026-05-31)

The `rectangle` commit handler now emits **4 `line` entities** + coincident constraints at corners, NOT a single `'rectangle'` entity. `rectangle-center` and `rectangle-3point` already did this. Existing saved `'rectangle'` entities still render/solve correctly.

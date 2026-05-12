---
name: Code Quality Feedback
description: User wants clean, refactored code split by responsibility (not line count); shared abstractions over duplication
type: feedback
originSessionId: 6f52931a-2f78-47ac-9277-a63615943896
---
Always write clean, refactored, simplified code. **Split by responsibility, not by line count.**

**Why:** Files that accumulate too many concerns become hard to maintain. The user drove a sweeping 2026-04 refactor to break up monoliths across the codebase (GeometryEngine, Slicer, cadStore, slicerStore, componentStore, printerStore, App, Toolbar, SketchInteraction, FormInteraction, Timeline, ExtrudePanel, SketchPalette, DuetService, DuetHeightMap, BedCompensationPanel, etc.). Future additions should keep that invariant.

## The rule: extract by concern

A file should be about **one thing**. Look for these distinct concerns living together — when you find them, extract:

- **Long-running async workflows** (probe sequences, calibration loops, file uploads with progress, multi-step pipelines) — pull into a hook or service module. They carry their own state machine and don't belong in a render tree.
- **Sub-regions of UI** (sidebar, topbar, modal mount points, status pills) — each region is its own file once it has its own props contract.
- **Modals/dialogs/result panels** — always their own file, no matter how small. They have a self-contained lifecycle (open → confirm/cancel → dismiss) and routinely get reused.
- **Pure helpers / parsers / converters** (M557 parsing, prefs (de)serialization, CSV diffing, stat computation) — belong in a sibling `.ts` so they're testable without React.
- **Constants, presets, templates** (camera presets, demo data, M-code templates, default option sets) — extract to `prefs.ts` / `presets.ts` / `templates.ts` so the host file isn't padded with literal data.
- **Side-effect setup** (effects that snapshot/restore firmware state, intervals/timeouts, subscriptions) — wrap in a custom hook so cleanup is co-located with setup.
- **Visualizations** (Scene3D, Heatmap2D, legends, rulers, markers) — each a focused render component. Composition assembles them; the host doesn't reach inside.

If two of these concerns share a file, that's the signal to split — even if the file is small.

## Line count is a **smell**, not a rule

A file's size is a hint that prompts investigation, not a verdict:

- **Long but cohesive** → fine. A 1000-line file with one responsibility, no hidden concerns, and a clear narrative is healthy.
- **Short but mixed** → not fine. A 250-line file that mixes rendering, async orchestration, parsing, and a modal needs splitting.
- **When a file feels long**, ask: "what concerns are jammed together here?" — and split those out. Don't split arbitrarily to hit a number.
- **Rough triggers for the question, not the action**: when a file passes ~500 lines, scan for hidden concerns. When it passes ~1000, the answer is almost always yes there are some. The number is the prompt to *look*; the split decision comes from what you find.

## Shim + subdir pattern (when you do split)

- Follow the established pattern: a small composer/shim file plus a neighbor subdir with focused files. The shim re-exports the public API; consumers don't need to know the split happened.
- Within a single React file, every modal/dialog/result-panel is its own file under `<host>/modals/` or `<host>/<feature>/`. Apply this even mid-task — if you find a 200-line modal living inside a larger component file, split it before touching the surrounding code.
- New dialogs live in their own file under `src/components/dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`.
- Stores: new actions go into existing action files under `src/store/<store>/{slices,actions}/` — never back into the shim.
- Engine: new geometry code goes under `src/engine/geometryEngine/{core,operations}/` — not into `GeometryEngine.ts` (2-line shim).
- Slicer: new code goes under `src/engine/slicer/{pipeline,geometry,gcode}/` — not into `Slicer.ts` (~9-line shim).
- Types: create a focused `src/types/<area>.types.ts` rather than bloating `cad.ts`/`slicer.ts`.

## Don't split halfway

If you split a file, run `tsc -b` and finish the move in the same commit — don't leave the orphaned copy in place or stash "some helpers" in the old file "for later". A split that leaves dead code or duplicate types is worse than no split.

## Reach for shared abstraction on second use

Modals, animations, viewers, charts, hooks, services, factories — if you write something twice, extract on the second use. If you find a third copy mid-edit, extract before continuing.

Examples that already exist (use these, don't reinvent):
- `src/components/ui/Modal.tsx` — `Modal` / `ModalBody` / `ModalFooter` + `useModalKeys(onClose, onEnter?)`. Every modal-style dialog should compose these instead of re-implementing `createPortal` + overlay + header + Escape handling.
- `src/components/printer/heightMap/hooks/useHeightMapRunners.ts` — pattern for a "long-running workflow" hook: owns its own state, accepts deps via an interface, exposes setters + run functions. Reach for this shape when wrapping a probe/calibrate/upload-style sequence.
- `src/components/dialogs/common/` — `CollapsibleSection`, `FaceSelector`, `SegmentedIconGroup`, `ToolPanel.css`.
- `engine/geometryEngine/materials.ts` — `tagShared()` + the singleton materials. Reuse these instead of cloning a new material per body.
- `viewport/scene/` — `bodyMaterial.ts`, `WorldAxes`, etc. Camera presets, axis labels, common overlays live here.

When a new shared piece appears (a scene viewer wrapper, a tooltip, a progress strip, a workflow hook), put it under `src/components/ui/` (atom-level) or `src/components/<feature>/common/` (feature-scoped) and import. Document the new primitive here so the next session finds it.

---
name: Code Quality Feedback
description: User wants clean, refactored code split into focused subcomponents; large monoliths have all been broken up
type: feedback
originSessionId: 6f52931a-2f78-47ac-9277-a63615943896
---
Always write clean, refactored, simplified code. Split large components/modules into focused subcomponents or sub-modules.

**Why:** Files that accumulate too many concerns become hard to maintain. The user drove a sweeping 2026-04 refactor to break up all the big monoliths (GeometryEngine, Slicer, cadStore, slicerStore, componentStore, printerStore, App, Toolbar, SketchInteraction, FormInteraction, Timeline, ExtrudePanel, SketchPalette, DuetService, etc.). Future additions should keep that invariant.

**Size thresholds (applies during ANY change to a file — do not need to be asked):**
- `≤ 300 lines` — fine as-is.
- `300-800 lines` — actively look for split lines. Extract any obvious independent unit (a sub-component, a modal, a helper, a hook, a constant block, a parser).
- `> 800 lines` — must split before adding more. Do not bolt new code onto a file that's already this big; route the additions into a neighbor file under the established subdir pattern. If the file currently has no subdir, create one alongside it (e.g. `Foo.tsx` → `foo/`).
- `> 1500 lines` — treat as a bug. Plan and commit a dedicated split before any other change to that file.

**How to apply:**
- Follow the established pattern of a small "shim" or composer file plus a neighbor subdir with focused files. The shim re-exports the public API; consumers don't need to know the split happened.
- Within a single React file, every modal/dialog/result-panel sub-component is its own file under `<host>/modals/` or `<host>/<feature>/`. Apply this even mid-task — if you find a 200-line modal living inside an 1800-line component file, split it out before touching it.
- New dialogs live in their own file under `src/components/dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`.
- Stores: new actions go into existing action files under `src/store/<store>/{slices,actions}/` — never back into the shim.
- Engine: new geometry code goes under `src/engine/geometryEngine/{core,operations}/` — not into `GeometryEngine.ts` (2-line shim).
- Slicer: new code goes under `src/engine/slicer/{pipeline,geometry,gcode}/` — not into `Slicer.ts` (~9-line shim).
- Types: create a focused `src/types/<area>.types.ts` rather than bloating `cad.ts`/`slicer.ts`.
- Panel components should extract sub-rows into small named sub-components where it improves readability.

**Don't do the split half-way.** If you split a file, run `tsc -b` and finish the move in the same commit — don't leave the orphaned copy in place or stash some helpers in the old file "for later".

**Always reach for a shared abstraction before duplicating a pattern.** Modals, animations, viewers, charts, hooks, services, factories — if you write something twice, extract it on the second use. If you find a third copy mid-edit, extract before continuing.

Examples that already exist (use these, don't reinvent):
- `src/components/ui/Modal.tsx` — `Modal` / `ModalBody` / `ModalFooter` + `useModalKeys(onClose, onEnter?)`. Every modal-style dialog should compose these instead of re-implementing `createPortal` + overlay + header + Escape handling.
- `src/components/dialogs/common/` — `CollapsibleSection`, `FaceSelector`, `SegmentedIconGroup`, `ToolPanel.css`.
- `engine/geometryEngine/materials.ts` — `tagShared()` + the singleton materials. Reuse these instead of cloning a new material per body.
- `viewport/scene/` — `bodyMaterial.ts`, `WorldAxes`, etc. Camera presets, axis labels, common overlays live here.

When a new shared piece appears (e.g. a "scene viewer" wrapper, a tooltip, a progress strip), put it under `src/components/ui/` (atom-level) or `src/components/<feature>/common/` (feature-scoped) and import. Document the new primitive here so the next session finds it.

---
name: Code Quality Feedback
description: User wants clean, refactored code split into focused subcomponents; large monoliths have all been broken up
type: feedback
originSessionId: 6f52931a-2f78-47ac-9277-a63615943896
---
Always write clean, refactored, simplified code. Split large components/modules into focused subcomponents or sub-modules.

**Why:** Files that accumulate too many concerns become hard to maintain. The user drove a sweeping 2026-04 refactor to break up all the big monoliths (GeometryEngine, Slicer, cadStore, slicerStore, componentStore, printerStore, App, Toolbar, SketchInteraction, FormInteraction, Timeline, ExtrudePanel, SketchPalette, DuetService, etc.). Future additions should keep that invariant.

**How to apply:**
- When a file grows past ~300-400 lines, propose splitting it into sub-files — follow the established pattern of a small "shim" or composer plus a neighbor subdir with focused files.
- New dialogs live in their own file under `src/components/dialogs/{solid,surface,mesh,pattern,sketch,assembly,construction,primitives,insert,inspect}/`.
- Stores: new actions go into existing action files under `src/store/<store>/{slices,actions}/` — never back into the shim.
- Engine: new geometry code goes under `src/engine/geometryEngine/{core,operations}/` — not into `GeometryEngine.ts` (2-line shim).
- Slicer: new code goes under `src/engine/slicer/{pipeline,geometry,gcode}/` — not into `Slicer.ts` (~9-line shim).
- Types: create a focused `src/types/<area>.types.ts` rather than bloating `cad.ts`/`slicer.ts`.
- Panel components should extract sub-rows into small named sub-components where it improves readability.

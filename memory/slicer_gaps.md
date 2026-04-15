---
name: Slicer Engine Gaps vs UI
description: Slicer settings that exist in the UI / PrintProfile but where the engine still ignores or stubs them
type: project
---

The slicer UI exposes near-full Cura 5.x settings, but the engine in `src/engine/Slicer.ts` is a partial implementation. These are the known **setting-exists-but-engine-ignores-it** gaps — important so suggestions don't claim a feature works when only the toggle does.

**How to apply:** When the user reports "X doesn't seem to do anything," check this list before debugging.

## Patterns named but not actually generated
- **Gyroid, honeycomb, lightning, tetrahedral, octet, cross-3D, cubic-subdivision** — `infillPattern` accepts them, engine falls back to linear fills.
- **Tree / organic support** — `supportType` accepts them, engine generates normal vertical supports.

## Settings the engine reads but doesn't act on
- **Adaptive layers** — fixed layer height regardless of `adaptiveLayersEnabled`.
- **One-at-a-time print sequence** — always all-at-once.
- **Mold mode** — geometry is not converted.
- **Fuzzy skin** — no noise applied to outer wall path.

## Cura features with no equivalent at all
- Per-object setting overrides (UI hooks exist on `PlateObject.perObjectSettings`, no editor)
- Mesh modifiers: Infill Mesh, Cutting Mesh, Anti-Overhang Mesh, Support Mesh
- Support / seam / blocker painting
- Multi-extruder (prime tower, tool change G-code, per-extruder settings)
- PostProcessingPlugin equivalent
- Print time estimation before slicing (only available after slice completes)
- `settingsSearch` filter — `show()` helper exists but isn't wired to individual `<Num>`/`<Check>`/`<Sel>` controls in `SettingsPanel`

## Print monitoring
Live print monitoring is intentionally NOT in the slicer — it's handled by `DuetPrinterPanel`.

---
name: Canonical Dialog Style — ExtrudePanel
description: All tool dialogs/panels should match the Extrude panel look — non-modal floating panel, tp-* classes from common/ToolPanel.css
type: feedback
originSessionId: 41af41c8-5267-46c1-bc59-dbc0fb757714
---
The **ExtrudePanel** look is the canonical visual style for ALL tool dialogs/panels in Cindr3D.

**Why:** User explicitly said all tool dialogs should look like Extrude (2026-04-17). Old `dialog-overlay` modal style with large fonts and centered backdrop is being phased out.

**How to apply:**
- Import `src/components/dialogs/common/ToolPanel.css` and use the `tool-panel` + `tp-*` class set:
  `tool-panel`, `tp-header`, `tp-header-icon`, `tp-header-title`, `tp-close`,
  `tp-body`, `tp-section`, `tp-section-title`, `tp-divider`,
  `tp-row`, `tp-label`, `tp-select`, `tp-input-group`, `tp-unit`,
  `tp-toggle` / `tp-toggle-track`, `tp-actions`, `tp-btn`, `tp-btn-cancel`, `tp-btn-ok`.
- Panel is **non-modal** — floats top-right (`position: absolute; right: 12px; top: 80px`), no overlay backdrop, viewport stays interactive (essential for face/edge picking).
- Header has a 20×20 colored icon square + bold uppercase title + X close. Per-tool color variants live in the tool's own CSS file (e.g. `ExtrudePanel.css` keeps `.tp-header-icon.extrude` blue / `.tp-header-icon.cut` red).
- Sections use small uppercase grey titles, rows are flex space-between with label-left / control-right.
- Numeric values use `<ExpressionInput>` inside `tp-input-group` with a `tp-unit` suffix.
- Booleans use `tp-toggle` switches, NOT checkboxes.
- Footer has compact icon+label OK/Cancel pills.
- ExtrudePanel.tsx and HoleDialog.tsx are the reference implementations to copy from.

**Old dialog-overlay style (`.dialog`, `.dialog-overlay`, `.dialog-body`, `.btn-primary` etc.)** is legacy — only retain it on dialogs that haven't been migrated yet. New dialogs MUST use the tool-panel style. When touching an old dialog for any reason, migrate it.

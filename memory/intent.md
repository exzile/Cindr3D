---
name: Cindr3D / Cindr3D Intent
description: What the user is building, parity targets, launch plan, and what they expect from Claude
type: project
---

## User & expectations

Senior developer building **Cindr3D** (repo: Cindr3D). Tracks all pending/done work in `TaskLists.txt` at the repo root. Expects autonomous operation: spawn agents, TSC-check, commit, iterate without asking permission for routine ops.

## What's being built

Web-based CAD + slicer + Duet3D printer-control app, branded **Cindr3D**.

**Parity targets:**
- Design workspace → Fusion 360 UX/feature parity
- Slicer workspace → UltiMaker Cura 5.x feature parity (reference install: `C:\Program Files\UltiMaker Cura 5.12.0`)
- Printer panel → Duet3D web control (DWC) parity, both standalone (`/rr_*`) and SBC (`/machine/*`) modes

**How to apply:** When extending features, check the corresponding reference tool. For slicer settings, the source of truth is Cura's `resources/definitions/fdmprinter.def.json`. For CAD UX, mimic Fusion 360.

**Launch:** Public launch at `cindr3d.com` is intentionally deferred until the user says "go live." Until then, the app ships to the Azure staging URL on every push to `master`. See `azure_hosting.md`.

**Rebrand done:** All occurrences of "Cindr3D" in user-visible strings (browser title, G-code headers, exports, localStorage keys, IndexedDB names) were changed to "Cindr3D". The repo, project, and solution files still use the Cindr3D name.

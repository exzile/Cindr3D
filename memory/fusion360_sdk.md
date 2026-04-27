---
name: Fusion 360 SDK Reference
description: Local Fusion 360 SDK install path + canonical enum names used to audit DesignCAD dialog parity
type: reference
originSessionId: 44b47ea6-8828-4fd8-9638-602fb35b76e7
---
Local install: `C:\Users\joeyp\AppData\Local\Autodesk\webdeploy\production\ca305acf3852cfce8e837ee5435adf649bc398ca\`

**Feature headers (most useful for dialog parity):** `…\CPP\include\Fusion\Features\`
- `ExtrudeFeatureInput.h` — ExtrudeDirection: `Positive/Negative/Symmetric`; ThinWallSide: `Side1/Side2/Center`; FeatureOperation: `NewBody/Join/Cut/Intersect/NewComponent`
- `HoleFeatureInput.h` — HoleType: `Simple/Counterbore/Countersink` (NO CounterboreCountersink); HoleTermination: `Distance/ThroughAll/ToObject` (NO Symmetric)

**Other header roots:** `Fusion\BRep\`, `Fusion\Sketch\`, `Core\`, `Python\`.

**Usage:** when adding/auditing a dialog's parameter enum, cross-reference the matching header. C++ enum names map to behaviour even when our string literals differ.

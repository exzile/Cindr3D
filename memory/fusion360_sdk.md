---
name: Fusion 360 SDK Reference
description: Fusion 360 SDK header reference and canonical enum names used to audit Cindr3D dialog parity
type: reference
---
Local reference: Fusion 360 installs SDK headers under the Autodesk webdeploy production directory for the current user. Do not commit machine-specific install paths or deployment hashes.

**Feature headers (most useful for dialog parity):** `…\CPP\include\Fusion\Features\`
- `ExtrudeFeatureInput.h` — ExtrudeDirection: `Positive/Negative/Symmetric`; ThinWallSide: `Side1/Side2/Center`; FeatureOperation: `NewBody/Join/Cut/Intersect/NewComponent`
- `HoleFeatureInput.h` — HoleType: `Simple/Counterbore/Countersink` (NO CounterboreCountersink); HoleTermination: `Distance/ThroughAll/ToObject` (NO Symmetric)

**Other header roots:** `Fusion\BRep\`, `Fusion\Sketch\`, `Core\`, `Python\`.

**Usage:** when adding/auditing a dialog's parameter enum, cross-reference the matching header. C++ enum names map to behaviour even when our string literals differ.

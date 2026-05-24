# Legacy CSG Edge-Cut Archive

Status: removed on `codex/occ-only-remove-fallbacks`.

The old mesh/CSG fillet and chamfer pipeline has been deleted so edge modification now runs through the OCC BRep path only.

Removed modules:

- `src/utils/geometry/edgeCutCore.ts`
- `src/utils/geometry/filletGeometry.ts`
- `src/utils/geometry/chamferGeometry.ts`
- `src/store/cad/slices/featureManagement/applyEdgeCut.ts`
- `src/store/cad/slices/featureManagement/resolveBodySource.ts`
- `src/workers/edgeOpWorker.ts`
- `src/components/viewport/scene/edgeOp/EdgeOpPreview.tsx`
- `src/components/viewport/scene/FilletPreview.tsx`
- `src/components/viewport/scene/ChamferPreview.tsx`

Current behavior:

- Fillet/chamfer selection IDs are OCC IDs: `occ:<bodyId>:<edgeId>`.
- Orange selectable edge overlays are drawn from OCC tessellation `edgePolylines`.
- Committing and replaying fillet/chamfer uses the OCC body registry and OCC edge IDs.
- Legacy mesh edge IDs are rejected with a status message instead of falling back to CSG.
- The old live-preview preview-params store fields were removed.

Known follow-up:

- Full-round face-pick UI was removed with the legacy face boundary picker. Reintroduce it only by using OCC face-to-edge adjacency, not the old mesh face picker.

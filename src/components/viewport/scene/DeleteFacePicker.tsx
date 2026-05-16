/**
 * DeleteFacePicker — multi-face picker for the Surface » Delete Face dialog.
 * Active while activeDialog === 'delete-face'. Each clicked face is recorded
 * (body featureId + face plane) into the store; commitDeleteFace removes them
 * and heals the holes. Reuses the shared useSimpleFacePicker (hover/selected
 * overlay + pulse + cursor) — same path as the working solid Remove Face.
 */

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DeleteFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const deleteFaceIds = useCADStore((s) => s.deleteFaceIds);
  const addDeleteFacePick = useCADStore((s) => s.addDeleteFacePick);

  const enabled = activeDialog === 'delete-face';

  const onCommit = useCallback((result: FacePickResult) => {
    const featureId = result.mesh.userData.featureId as string | undefined;
    if (!featureId) return;
    addDeleteFacePick(
      featureId,
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
    );
  }, [addDeleteFacePick]);

  useSimpleFacePicker({
    overlayEnabled: enabled,
    pickEnabled: enabled, // multi-pick: stays enabled so several faces can be added
    selectedFaceId: deleteFaceIds.length > 0 ? deleteFaceIds[deleteFaceIds.length - 1] : null,
    onCommit,
    selectedColor: 0xff3b30, // red — "will be deleted"
  });

  return null;
}

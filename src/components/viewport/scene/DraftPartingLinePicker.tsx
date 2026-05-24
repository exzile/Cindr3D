import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DraftPartingLinePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const draftPartingFaceId = useCADStore((s) => s.draftPartingFaceId);
  const setDraftPartingFace = useCADStore((s) => s.setDraftPartingFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setDraftPartingFace(
      result.centroid.toArray().join(','),
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
      result.occBodyId && result.occFaceId !== undefined
        ? { bodyId: result.occBodyId, faceId: result.occFaceId }
        : null,
    );
  }, [setDraftPartingFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'draft',
    pickEnabled: activeDialog === 'draft' && draftPartingFaceId === null,
    selectedFaceId: draftPartingFaceId,
    onCommit,
  });

  return null;
}

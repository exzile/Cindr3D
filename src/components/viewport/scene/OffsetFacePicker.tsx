import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function OffsetFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const offsetFaceId = useCADStore((s) => s.offsetFaceId);
  const setOffsetFace = useCADStore((s) => s.setOffsetFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setOffsetFace(
      result.centroid.toArray().join(','),
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
      result.occBodyId && result.occFaceId !== undefined
        ? { bodyId: result.occBodyId, faceId: result.occFaceId }
        : null,
    );
  }, [setOffsetFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'offset-face',
    pickEnabled: activeDialog === 'offset-face',
    selectedFaceId: offsetFaceId,
    onCommit,
  });

  return null;
}

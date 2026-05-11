import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function RemoveFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const removeFaceFaceId = useCADStore((s) => s.removeFaceFaceId);
  const setRemoveFaceFace = useCADStore((s) => s.setRemoveFaceFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setRemoveFaceFace(
      result.centroid.toArray().join(','),
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
    );
  }, [setRemoveFaceFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'remove-face',
    pickEnabled: activeDialog === 'remove-face' && removeFaceFaceId === null,
    selectedFaceId: removeFaceFaceId,
    onCommit,
  });

  return null;
}

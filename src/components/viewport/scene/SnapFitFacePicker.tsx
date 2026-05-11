import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function SnapFitFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const snapFitFaceId = useCADStore((s) => s.snapFitFaceId);
  const setSnapFitFace = useCADStore((s) => s.setSnapFitFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setSnapFitFace(result.centroid.toArray().join(','));
  }, [setSnapFitFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'snap-fit',
    pickEnabled: activeDialog === 'snap-fit' && snapFitFaceId === null,
    selectedFaceId: snapFitFaceId,
    onCommit,
    selectedColor: 0xff9800,
  });

  return null;
}

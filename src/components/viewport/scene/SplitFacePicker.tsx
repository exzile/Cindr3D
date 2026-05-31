import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function SplitFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const splitFaceId = useCADStore((s) => s.splitFaceId);
  const splitFaceOccFaceId = useCADStore((s) => s.splitFaceOccFaceId);
  const setSplitFace = useCADStore((s) => s.setSplitFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setSplitFace(
      result.centroid.toArray().join(','),
      result.occBodyId != null && result.occFaceId !== undefined
        ? {
            bodyId: result.occBodyId,
            faceId: result.occFaceId,
            featureId: (result.mesh.userData['featureId'] as string | undefined) ?? '',
          }
        : null,
    );
  }, [setSplitFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'split-face',
    pickEnabled: activeDialog === 'split-face' && splitFaceId === null && splitFaceOccFaceId === null,
    selectedFaceId: splitFaceId,
    onCommit,
  });

  return null;
}

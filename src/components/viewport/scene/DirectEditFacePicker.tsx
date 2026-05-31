import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DirectEditFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const directEditFaceId = useCADStore((s) => s.directEditFaceId);
  const directEditOccFaceId = useCADStore((s) => s.directEditOccFaceId);
  const setDirectEditFace = useCADStore((s) => s.setDirectEditFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setDirectEditFace(
      result.centroid.toArray().join(','),
      result.occBodyId != null && result.occFaceId !== undefined
        ? {
            bodyId: result.occBodyId,
            faceId: result.occFaceId,
            featureId: (result.mesh.userData['featureId'] as string | undefined) ?? '',
          }
        : null,
    );
  }, [setDirectEditFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'direct-edit',
    pickEnabled: activeDialog === 'direct-edit' && directEditFaceId === null && directEditOccFaceId === null,
    selectedFaceId: directEditFaceId,
    onCommit,
  });

  return null;
}

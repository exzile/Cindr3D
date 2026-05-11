import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DirectEditFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const directEditFaceId = useCADStore((s) => s.directEditFaceId);
  const setDirectEditFace = useCADStore((s) => s.setDirectEditFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setDirectEditFace(result.centroid.toArray().join(','));
  }, [setDirectEditFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'direct-edit',
    pickEnabled: activeDialog === 'direct-edit' && directEditFaceId === null,
    selectedFaceId: directEditFaceId,
    onCommit,
  });

  return null;
}

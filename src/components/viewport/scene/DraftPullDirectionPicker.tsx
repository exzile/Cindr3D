import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DraftPullDirectionPicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const draftPullFacePickActive = useCADStore((s) => s.draftPullFacePickActive);
  const setDraftPullFace = useCADStore((s) => s.setDraftPullFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setDraftPullFace(
      result.centroid.toArray().join(','),
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
    );
  }, [setDraftPullFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'draft' && draftPullFacePickActive,
    pickEnabled: activeDialog === 'draft' && draftPullFacePickActive,
    selectedFaceId: null,
    onCommit,
  });

  return null;
}

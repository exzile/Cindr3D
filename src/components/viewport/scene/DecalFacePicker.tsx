import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function DecalFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const decalFaceId = useCADStore((s) => s.decalFaceId);
  const setDecalFace = useCADStore((s) => s.setDecalFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setDecalFace(
      result.centroid.toArray().join(','),
      result.normal.toArray() as [number, number, number],
      result.centroid.toArray() as [number, number, number],
    );
  }, [setDecalFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'decal',
    pickEnabled: activeDialog === 'decal' && decalFaceId === null,
    selectedFaceId: decalFaceId,
    onCommit,
  });

  return null;
}

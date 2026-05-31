import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function OffsetFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const offsetFaceIds = useCADStore((s) => s.offsetFaceIds);
  const setOffsetFace = useCADStore((s) => s.setOffsetFace);
  const addOffsetFace = useCADStore((s) => s.addOffsetFace);

  const onCommit = useCallback((result: FacePickResult) => {
    const occ =
      result.occBodyId && result.occFaceId !== undefined
        ? { bodyId: result.occBodyId, faceId: result.occFaceId }
        : null;
    const id = result.centroid.toArray().join(',');
    setOffsetFace(
      id,
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
      occ,
    );
    addOffsetFace(id, occ);
  }, [setOffsetFace, addOffsetFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'offset-face',
    pickEnabled: activeDialog === 'offset-face',
    selectedFaceId: offsetFaceIds[offsetFaceIds.length - 1] ?? null,
    onCommit,
  });

  return null;
}

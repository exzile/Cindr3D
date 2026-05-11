import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function ExtrudeToEntityPicker() {
  const activeTool = useCADStore((s) => s.activeTool);
  const extentType = useCADStore((s) => s.extrudeExtentType);
  const extentType2 = useCADStore((s) => s.extrudeExtentType2);
  const faceId = useCADStore((s) => s.extrudeToEntityFaceId);
  const setFace = useCADStore((s) => s.setExtrudeToEntityFace);

  const isToObject = extentType === 'to-object' || extentType2 === 'to-object';

  const onCommit = useCallback((result: FacePickResult) => {
    setFace(
      result.centroid.toArray().join(','),
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
    );
  }, [setFace]);

  useSimpleFacePicker({
    overlayEnabled: activeTool === 'extrude' && isToObject,
    pickEnabled: activeTool === 'extrude' && isToObject && faceId === null,
    selectedFaceId: faceId,
    onCommit,
  });

  return null;
}

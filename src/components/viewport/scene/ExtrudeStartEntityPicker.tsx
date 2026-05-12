import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function ExtrudeStartEntityPicker() {
  const activeTool = useCADStore((s) => s.activeTool);
  const startType = useCADStore((s) => s.extrudeStartType);
  const faceCentroid = useCADStore((s) => s.extrudeStartFaceCentroid);
  const setStartFace = useCADStore((s) => s.setExtrudeStartFace);

  const isEntityMode = startType === 'entity';

  const onCommit = useCallback((result: FacePickResult) => {
    setStartFace(
      [result.normal.x, result.normal.y, result.normal.z],
      [result.centroid.x, result.centroid.y, result.centroid.z],
    );
  }, [setStartFace]);

  useSimpleFacePicker({
    overlayEnabled: activeTool === 'extrude' && isEntityMode,
    pickEnabled: activeTool === 'extrude' && isEntityMode && faceCentroid === null,
    selectedFaceId: faceCentroid ? faceCentroid.join(',') : null,
    onCommit,
    hoverColor: 0x44cc88,
    selectedColor: 0x00aacc,
  });

  return null;
}

import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../hooks/useFacePicker';

export default function TextureExtrudeFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const textureExtrudeFaceId = useCADStore((s) => s.textureExtrudeFaceId);
  const setTextureExtrudeFace = useCADStore((s) => s.setTextureExtrudeFace);

  const onCommit = useCallback((result: FacePickResult) => {
    setTextureExtrudeFace(result.centroid.toArray().join(','));
  }, [setTextureExtrudeFace]);

  useSimpleFacePicker({
    overlayEnabled: activeDialog === 'texture-extrude',
    pickEnabled: activeDialog === 'texture-extrude' && textureExtrudeFaceId === null,
    selectedFaceId: textureExtrudeFaceId,
    onCommit,
  });

  return null;
}

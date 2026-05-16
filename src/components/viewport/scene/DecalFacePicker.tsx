import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import DecalProjections from './DecalProjections';
import type { FacePickResult } from '../../../hooks/useFacePicker';

/**
 * DecalFacePicker — picks the target face for the Decal tool (D192) AND hosts
 * the committed-decal renderer.
 *
 * On commit we store the *target body's featureId* (from
 * mesh.userData.featureId) in `decalFaceId`, plus the picked point/normal in
 * decalFaceCentroid/decalFaceNormal. commitDecal bakes these into the feature
 * params; DecalProjections then projects the image onto that body's mesh.
 *
 * DecalProjections is rendered here (this component is already mounted in the
 * scene) so committed decals persist regardless of dialog state.
 */
export default function DecalFacePicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const decalFaceId = useCADStore((s) => s.decalFaceId);
  const setDecalFace = useCADStore((s) => s.setDecalFace);

  const onCommit = useCallback((result: FacePickResult) => {
    const targetFeatureId = result.mesh.userData.featureId as string | undefined;
    if (!targetFeatureId) return; // only bodies (which carry featureId) are valid decal hosts
    setDecalFace(
      targetFeatureId,
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

  return <DecalProjections />;
}

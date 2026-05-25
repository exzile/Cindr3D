import { useCallback } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { useSimpleFacePicker } from './useSimpleFacePicker';
import type { FacePickResult } from '../../../types/face-picker.types';

/**
 * Handles OCC face picking for the full-round fillet dialog.
 * Active when activeDialog === 'fillet' and filletFullRoundPickSlot is set.
 * Routes each pick to the correct face slot (center / side1 / side2).
 */
export default function FilletFullRoundPicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletFullRoundPickSlot = useCADStore((s) => s.filletFullRoundPickSlot);
  const setFilletFullRoundFace = useCADStore((s) => s.setFilletFullRoundFace);
  const filletFullRoundCenterFaceId = useCADStore((s) => s.filletFullRoundCenterFaceId);
  const filletFullRoundSide1FaceId = useCADStore((s) => s.filletFullRoundSide1FaceId);
  const filletFullRoundSide2FaceId = useCADStore((s) => s.filletFullRoundSide2FaceId);

  const isFilletOpen = activeDialog === 'fillet';
  const pickEnabled = isFilletOpen && filletFullRoundPickSlot !== null;

  // The selected face ID for the highlight is whichever slot is currently active
  const selectedFaceId =
    filletFullRoundPickSlot === 'center' ? filletFullRoundCenterFaceId :
    filletFullRoundPickSlot === 'side1' ? filletFullRoundSide1FaceId :
    filletFullRoundPickSlot === 'side2' ? filletFullRoundSide2FaceId :
    null;

  const onCommit = useCallback((result: FacePickResult) => {
    const slot = useCADStore.getState().filletFullRoundPickSlot;
    if (!slot) return;
    const centroidKey = [result.centroid.x, result.centroid.y, result.centroid.z].join(',');
    setFilletFullRoundFace(
      slot,
      centroidKey,
      result.occBodyId ?? null,
      result.occFaceId !== undefined ? result.occFaceId : null,
    );
  }, [setFilletFullRoundFace]);

  useSimpleFacePicker({
    overlayEnabled: isFilletOpen && filletFullRoundPickSlot !== null,
    pickEnabled,
    selectedFaceId,
    onCommit,
    hoverColor: 0x2196f3,
    selectedColor: 0xff9800,
  });

  return null;
}

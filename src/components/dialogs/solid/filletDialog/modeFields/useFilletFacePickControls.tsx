import { useCADStore } from "../../../../../store/cadStore";
import { FilletFacePickerRow } from "./FilletFacePickerRow";

type FilletFacePickSlot = "center" | "side1" | "side2";

export function useFilletFacePickControls() {
  const filletFullRoundCenterFaceId = useCADStore((s) => s.filletFullRoundCenterFaceId);
  const filletFullRoundSide1FaceId = useCADStore((s) => s.filletFullRoundSide1FaceId);
  const filletFullRoundSide2FaceId = useCADStore((s) => s.filletFullRoundSide2FaceId);
  const filletFullRoundPickSlot = useCADStore((s) => s.filletFullRoundPickSlot);
  const setFilletFullRoundPickSlot = useCADStore((s) => s.setFilletFullRoundPickSlot);
  const setFilletFullRoundFace = useCADStore((s) => s.setFilletFullRoundFace);

  const faceIdBySlot: Record<FilletFacePickSlot, string | null> = {
    center: filletFullRoundCenterFaceId,
    side1: filletFullRoundSide1FaceId,
    side2: filletFullRoundSide2FaceId,
  };

  const renderRow = (slot: FilletFacePickSlot, label: string) => (
    <FilletFacePickerRow
      label={label}
      faceId={faceIdBySlot[slot]}
      isActive={filletFullRoundPickSlot === slot}
      onActivate={() => setFilletFullRoundPickSlot(slot)}
      onClear={() => setFilletFullRoundFace(slot, null, null, null)}
    />
  );

  return { renderRow };
}

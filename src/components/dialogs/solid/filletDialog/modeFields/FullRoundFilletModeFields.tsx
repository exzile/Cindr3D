import { useFilletFacePickControls } from "./useFilletFacePickControls";

export function FullRoundFilletModeFields() {
  const facePicker = useFilletFacePickControls();

  return (
    <>
      <p className="dialog-hint">
        Select the center face and two adjacent side faces. The fillet radius
        is computed automatically from the boundary edge midpoints.
      </p>
      {facePicker.renderRow("center", "Center face")}
      {facePicker.renderRow("side1", "Side face 1")}
      {facePicker.renderRow("side2", "Side face 2")}
    </>
  );
}

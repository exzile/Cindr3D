import type { ChamferMode } from "./types";
import type { ChamferDialogState } from "./useChamferDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";

interface ChamferModeFieldsProps {
  dialog: ChamferDialogState;
}

export function ChamferModeFields({ dialog }: ChamferModeFieldsProps) {
  return (
    <>
      <div className="form-group">
        <label>Mode</label>
        <select
          value={dialog.mode}
          onChange={(e) => dialog.setMode(e.target.value as ChamferMode)}
        >
          <option value="equal-dist">Equal Distance</option>
          <option value="two-dist">Two Distances</option>
          <option value="dist-angle">Distance + Angle</option>
          <option value="three-face">Three Face</option>
        </select>
      </div>

      {dialog.mode === "three-face" ? (
        <p className="dialog-hint">
          Select edges at the intersection of three faces. The chamfer is
          automatically sized to blend all three faces tangentially.
        </p>
      ) : (
        <NumberInput
          label="Distance (mm)"
          value={dialog.distance}
          onChange={dialog.setDistanceAndLive}
          min={0.01}
          max={500}
          step={0.5}
          fallback={2}
        />
      )}

      {dialog.mode === "two-dist" && (
        <NumberInput
          label="Distance 2 (mm)"
          value={dialog.distance2}
          onChange={dialog.setDistance2}
          min={0.01}
          max={500}
          step={0.5}
          fallback={2}
        />
      )}

      {dialog.mode === "dist-angle" && (
        <NumberInput
          label="Angle (deg)"
          value={dialog.angle}
          onChange={dialog.setAngle}
          min={1}
          max={89}
          step={1}
          fallback={45}
        />
      )}

      {(dialog.mode === "two-dist" || dialog.mode === "dist-angle") && (
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={dialog.isFlipped}
              onChange={(e) => dialog.setIsFlipped(e.target.checked)}
            />
            Flip Faces
          </label>
        </div>
      )}
    </>
  );
}

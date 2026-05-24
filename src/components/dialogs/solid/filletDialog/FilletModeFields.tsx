import type { FilletMode } from "./types";
import type { FilletDialogState } from "./useFilletDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";

interface FilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function FilletModeFields({ dialog }: FilletModeFieldsProps) {
  return (
    <>
      <div className="form-group">
        <label>Type</label>
        <select
          value={dialog.mode}
          onChange={(e) => dialog.setMode(e.target.value as FilletMode)}
        >
          <option value="constant">Constant Radius</option>
          <option value="variable">Variable Radius</option>
          <option value="chord-length">Chord Length</option>
          <option value="asymmetric">Asymmetric</option>
          <option value="full-round">Full Round</option>
        </select>
      </div>

      {dialog.mode === "full-round" && (
        <>
          <p className="dialog-hint">
            Click the center face to auto-compute the fillet radius and select
            its edges. The radius is set to the inradius of the face (distance
            from centroid to nearest edge).
          </p>
          <NumberInput
            label="Radius (mm, auto)"
            value={dialog.radius}
            onChange={dialog.setRadiusAndLive}
            min={0.01}
            max={500}
            step={0.5}
            fallback={2}
          />
        </>
      )}

      {dialog.mode === "constant" && (
        <NumberInput
          label="Radius (mm)"
          value={dialog.radius}
          onChange={dialog.setRadiusAndLive}
          min={0.01}
          max={500}
          step={0.5}
          fallback={2}
        />
      )}

      {dialog.mode === "variable" && (
        <div className="settings-grid">
          <NumberInput
            label="Start Radius (mm)"
            value={dialog.startRadius}
            onChange={dialog.setStartRadius}
            min={0.01}
            max={500}
            step={0.5}
            fallback={1}
          />
          <NumberInput
            label="End Radius (mm)"
            value={dialog.endRadius}
            onChange={dialog.setEndRadius}
            min={0.01}
            max={500}
            step={0.5}
            fallback={4}
          />
        </div>
      )}

      {dialog.mode === "chord-length" && (
        <div className="form-group">
          <NumberInput
            label="Chord Length (mm)"
            value={dialog.chordLength}
            onChange={dialog.setChordLength}
            min={0.01}
            max={1000}
            step={0.5}
            fallback={5}
          />
          <p className="dialog-hint" style={{ marginTop: 4 }}>
            Chord length controls the width of the fillet arc rather than its
            radius. r = chordLen / (2 cos(phi/2)) for the edge dihedral angle
            phi used by the geometry solver.
          </p>
        </div>
      )}

      {dialog.mode === "asymmetric" && (
        <>
          <div className="settings-grid">
            <NumberInput
              label="Offset 1 (mm)"
              value={dialog.offsetOne}
              onChange={dialog.setOffsetOne}
              min={0.01}
              max={500}
              step={0.5}
              fallback={2}
            />
            <NumberInput
              label="Offset 2 (mm)"
              value={dialog.offsetTwo}
              onChange={dialog.setOffsetTwo}
              min={0.01}
              max={500}
              step={0.5}
              fallback={3}
            />
          </div>
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
        </>
      )}
    </>
  );
}

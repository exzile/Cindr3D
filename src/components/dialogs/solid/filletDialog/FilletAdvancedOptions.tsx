import type { FilletDialogState } from "./useFilletDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";

interface FilletAdvancedOptionsProps {
  dialog: FilletDialogState;
}

export function FilletAdvancedOptions({ dialog }: FilletAdvancedOptionsProps) {
  return (
    <>
      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={dialog.propagate}
            onChange={(e) => dialog.setPropagate(e.target.checked)}
          />
          Propagate Along Tangent Edges
        </label>
      </div>

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={dialog.setback}
            onChange={(e) => dialog.setSetback(e.target.checked)}
          />
          Setback
        </label>
      </div>
      {dialog.setback && (
        <NumberInput
          label="Setback Distance (mm)"
          value={dialog.setbackDistance}
          onChange={dialog.setSetbackDistance}
          min={0}
          max={500}
          step={0.5}
          fallback={0}
          style={{ paddingLeft: 16 }}
        />
      )}

      {dialog.setback && (
        <div className="form-group" style={{ paddingLeft: 16 }}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={dialog.isRollingBallCorner}
              onChange={(e) => dialog.setIsRollingBallCorner(e.target.checked)}
            />
            Rolling Ball Corner
          </label>
        </div>
      )}

      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={dialog.isG2}
            onChange={(e) => dialog.setIsG2(e.target.checked)}
          />
          G2 Smooth (curvature continuity)
        </label>
      </div>

      {dialog.isG2 && (
        <NumberInput
          label="Tangency Weight"
          value={dialog.tangencyWeight}
          onChange={dialog.setTangencyWeight}
          min={0.1}
          max={2.0}
          step={0.1}
          fallback={1.0}
          title="1.0 = standard blend; > 1.0 extends blend along adjacent faces; < 1.0 tightens it"
          style={{ paddingLeft: 16 }}
        />
      )}
    </>
  );
}

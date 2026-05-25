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
          // FILLET-5: OCC has no per-edge setback distance binding —
          // corner shape is controlled by the Rolling Ball Corner toggle
          // (ChFi3d_QuasiAngular vs ChFi3d_Rational). This field is kept
          // for Fusion 360 file round-trip but does not affect geometry today.
          title="OCC does not bind per-edge setback distance — corner shape is controlled by the Rolling Ball Corner toggle below. Stored for future use."
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
          // FILLET-6: opencascade.js does not expose a per-edge tangency weight
          // on BRepFilletAPI_MakeFillet; the field is stored for Fusion 360
          // file round-trip but does not affect the produced blend today.
          title="Tangency weight is not supported by the OCC kernel — value stored for Fusion 360 file round-trip only."
          style={{ paddingLeft: 16 }}
        />
      )}
    </>
  );
}

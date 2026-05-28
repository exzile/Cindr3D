import type { FilletDialogState } from "./useFilletDialogState";
import { NumberInput } from "../edgeDialog/NumberInput";
import { FilletCheckboxOption } from "./FilletCheckboxOption";

interface FilletAdvancedOptionsProps {
  dialog: FilletDialogState;
}

export function FilletAdvancedOptions({ dialog }: FilletAdvancedOptionsProps) {
  return (
    <>
      <div className="form-group">
        <FilletCheckboxOption
          checked={dialog.propagate}
          onChange={dialog.setPropagate}
          description="Continues the fillet through smoothly tangent connected edges, so a rounded chain can be selected and applied together."
        >
          Propagate Along Tangent Edges
        </FilletCheckboxOption>
      </div>

      <div className="form-group">
        <FilletCheckboxOption
          checked={dialog.setback}
          onChange={dialog.setSetback}
          description="Shows corner setback controls. The value is stored for CAD round-trip, while the current OCC output uses the rolling-ball corner mode below."
        >
          Setback
        </FilletCheckboxOption>
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
          <FilletCheckboxOption
            checked={dialog.isRollingBallCorner}
            onChange={dialog.setIsRollingBallCorner}
            description="Uses a rolling-ball corner blend at multi-edge intersections for a smoother, more natural corner transition."
          >
            Rolling Ball Corner
          </FilletCheckboxOption>
        </div>
      )}

      <div className="form-group">
        <FilletCheckboxOption
          checked={dialog.isG2}
          onChange={dialog.setIsG2}
          description="Requests curvature-continuous smoothing where the OCC kernel supports it, producing a softer transition than standard tangency."
        >
          G2 Smooth (curvature continuity)
        </FilletCheckboxOption>
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

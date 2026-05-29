import { NumberInput } from "../../edgeDialog/NumberInput";
import type { FilletDialogState } from "../useFilletDialogState";

interface VariableFilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function VariableFilletModeFields({ dialog }: VariableFilletModeFieldsProps) {
  return (
    <>
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
      {dialog.midRadii.length > 0 && (
        <div className="form-group">
          <label style={{ marginBottom: 4 }}>Mid-points</label>
          {dialog.midRadii.map((pt, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <NumberInput
                label="Pos"
                value={pt.position}
                onChange={(v) => dialog.updateMidRadius(i, { position: v })}
                min={0.01}
                max={0.99}
                step={0.05}
                fallback={0.5}
              />
              <NumberInput
                label="R (mm)"
                value={pt.radius}
                onChange={(v) => dialog.updateMidRadius(i, { radius: v })}
                min={0.01}
                max={500}
                step={0.5}
                fallback={2}
              />
              <button
                type="button"
                className="tp-btn-secondary"
                style={{ padding: "2px 6px", fontSize: 11, flexShrink: 0 }}
                onClick={() => dialog.removeMidRadius(i)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="form-group">
        <button
          type="button"
          className="tp-btn-secondary"
          style={{ fontSize: 11, width: "100%" }}
          onClick={dialog.addMidRadius}
        >
          + Add Mid-point
        </button>
      </div>
    </>
  );
}

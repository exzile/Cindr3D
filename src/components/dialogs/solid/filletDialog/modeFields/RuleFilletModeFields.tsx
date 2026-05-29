import { NumberInput } from "../../edgeDialog/NumberInput";
import type { RuleFilletTopology, RuleFilletType } from "../types";
import type { FilletDialogState } from "../useFilletDialogState";
import { useFilletFacePickControls } from "./useFilletFacePickControls";

interface RuleFilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function RuleFilletModeFields({ dialog }: RuleFilletModeFieldsProps) {
  const facePicker = useFilletFacePickControls();

  return (
    <>
      <div className="form-group">
        <label>Rule</label>
        <select
          value={dialog.ruleType}
          onChange={(e) => dialog.setRuleType(e.target.value as RuleFilletType)}
        >
          <option value="all-edges">All Edges of Face</option>
          <option value="between-faces">Between Two Face Sets</option>
        </select>
      </div>
      <div className="form-group">
        <label>Topology</label>
        <select
          value={dialog.ruleFilletTopology}
          onChange={(e) => dialog.setRuleFilletTopology(e.target.value as RuleFilletTopology)}
        >
          <option value="all">Rounds and Fillets</option>
          <option value="convex">Rounds Only (convex)</option>
          <option value="concave">Fillets Only (concave)</option>
        </select>
      </div>
      <NumberInput
        label="Radius (mm)"
        value={dialog.radius}
        onChange={dialog.setRadiusAndLive}
        min={0.01}
        max={500}
        step={0.5}
        fallback={2}
      />
      {dialog.ruleType === "all-edges" ? (
        <>
          <p className="dialog-hint">
            Pick a face. Every edge of that face will be filleted at the radius above.
          </p>
          {facePicker.renderRow("center", "Target face")}
        </>
      ) : (
        <>
          <p className="dialog-hint">
            Pick two faces. Only edges shared between them will be filleted.
          </p>
          {facePicker.renderRow("side1", "Face set A")}
          {facePicker.renderRow("side2", "Face set B")}
        </>
      )}
    </>
  );
}

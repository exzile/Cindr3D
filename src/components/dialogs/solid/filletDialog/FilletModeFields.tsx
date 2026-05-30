import type { FilletMode } from "./types";
import type { FilletDialogState } from "./useFilletDialogState";
import { AsymmetricFilletModeFields } from "./modeFields/AsymmetricFilletModeFields";
import { ChordLengthFilletModeFields } from "./modeFields/ChordLengthFilletModeFields";
import { ConstantFilletModeFields } from "./modeFields/ConstantFilletModeFields";
import { FullRoundFilletModeFields } from "./modeFields/FullRoundFilletModeFields";
import { RuleFilletModeFields } from "./modeFields/RuleFilletModeFields";
import { VariableFilletModeFields } from "./modeFields/VariableFilletModeFields";

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
          <option value="rule-fillet">Rule Fillet</option>
        </select>
      </div>

      {dialog.mode === "rule-fillet" && <RuleFilletModeFields dialog={dialog} />}
      {dialog.mode === "full-round" && <FullRoundFilletModeFields />}
      {dialog.mode === "constant" && <ConstantFilletModeFields dialog={dialog} />}
      {dialog.mode === "variable" && <VariableFilletModeFields dialog={dialog} />}
      {dialog.mode === "chord-length" && <ChordLengthFilletModeFields dialog={dialog} />}
      {dialog.mode === "asymmetric" && <AsymmetricFilletModeFields dialog={dialog} />}
    </>
  );
}

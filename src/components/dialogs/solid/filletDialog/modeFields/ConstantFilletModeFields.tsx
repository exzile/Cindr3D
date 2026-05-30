import { NumberInput } from "../../edgeDialog/NumberInput";
import type { FilletDialogState } from "../useFilletDialogState";

interface ConstantFilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function ConstantFilletModeFields({ dialog }: ConstantFilletModeFieldsProps) {
  return (
    <NumberInput
      label="Radius (mm)"
      value={dialog.radius}
      onChange={dialog.setRadiusAndLive}
      min={0.01}
      max={500}
      step={0.5}
      fallback={2}
    />
  );
}

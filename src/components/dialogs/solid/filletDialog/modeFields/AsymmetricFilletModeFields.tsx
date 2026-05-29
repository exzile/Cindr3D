import { NumberInput } from "../../edgeDialog/NumberInput";
import { FilletCheckboxOption } from "../FilletCheckboxOption";
import type { FilletDialogState } from "../useFilletDialogState";

interface AsymmetricFilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function AsymmetricFilletModeFields({ dialog }: AsymmetricFilletModeFieldsProps) {
  return (
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
        <FilletCheckboxOption
          checked={dialog.isFlipped}
          onChange={dialog.setIsFlipped}
          description="Swaps which adjacent face receives Offset 1 versus Offset 2 for asymmetric fillets."
        >
          Flip Faces
        </FilletCheckboxOption>
      </div>
    </>
  );
}

import { NumberInput } from "../../edgeDialog/NumberInput";
import type { FilletDialogState } from "../useFilletDialogState";

interface ChordLengthFilletModeFieldsProps {
  dialog: FilletDialogState;
}

export function ChordLengthFilletModeFields({ dialog }: ChordLengthFilletModeFieldsProps) {
  return (
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
  );
}

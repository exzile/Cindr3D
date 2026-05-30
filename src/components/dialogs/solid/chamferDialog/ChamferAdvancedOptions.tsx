import type { ChamferCornerType } from "./types";
import type { ChamferDialogState } from "./useChamferDialogState";

interface ChamferAdvancedOptionsProps {
  dialog: ChamferDialogState;
}

export function ChamferAdvancedOptions({
  dialog,
}: ChamferAdvancedOptionsProps) {
  return (
    <>
      <div className="form-group">
        <label>Corner Type</label>
        <select
          value={dialog.cornerType}
          onChange={(e) =>
            dialog.setCornerType(e.target.value as ChamferCornerType)
          }
        >
          <option value="patch">Patch</option>
          <option value="miter">Miter</option>
        </select>
      </div>

      {dialog.mode !== "three-face" && (
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
      )}
    </>
  );
}

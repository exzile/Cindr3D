import { Camera, Loader2, Save } from "lucide-react";
import type { CameraTestState } from "../cameraSectionHelpers";

interface CameraActionButtonsProps {
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onTest: () => void;
  testState: CameraTestState;
}

export function CameraActionButtons({
  hasUnsavedChanges,
  onSave,
  onTest,
  testState,
}: CameraActionButtonsProps) {
  return (
    <div className="duet-settings__btn-row">
      <button
        className={`duet-settings__btn duet-settings__btn--secondary${testState.status === "testing" ? " duet-settings__btn--disabled" : ""}`}
        onClick={onTest}
        disabled={testState.status === "testing"}
      >
        {testState.status === "testing" ? (
          <>
            <Loader2 size={14} className="spin" /> Testing...
          </>
        ) : (
          <>
            <Camera size={14} /> Test Connection
          </>
        )}
      </button>
      <button
        className={`duet-settings__btn duet-settings__btn--primary${!hasUnsavedChanges ? " duet-settings__btn--disabled" : ""}`}
        onClick={onSave}
        disabled={!hasUnsavedChanges}
      >
        <Save size={14} /> Save Camera Settings
      </button>
    </div>
  );
}

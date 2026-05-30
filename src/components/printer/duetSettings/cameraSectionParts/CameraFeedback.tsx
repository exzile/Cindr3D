import { AlertCircle, CheckCircle } from "lucide-react";
import {
  cameraTestDisplayUrl,
  type CameraTestState,
} from "../cameraSectionHelpers";

interface CameraFeedbackProps {
  hasUnsavedChanges: boolean;
  saved: boolean;
  testState: CameraTestState;
}

export function CameraFeedback({
  hasUnsavedChanges,
  saved,
  testState,
}: CameraFeedbackProps) {
  return (
    <>
      {testState.status === "success" && (
        <div className="duet-settings__banner duet-settings__banner--success">
          <CheckCircle size={16} />
          <div>
            <div className="duet-settings__banner-heading">
              Camera connected
            </div>
            <div className="duet-settings__banner-detail">
              {cameraTestDisplayUrl(testState.url)}
            </div>
          </div>
        </div>
      )}
      {testState.status === "error" && (
        <div className="duet-settings__banner duet-settings__banner--error">
          <AlertCircle size={16} />
          <div>
            <div className="duet-settings__banner-heading">
              Camera test failed
            </div>
            <div className="duet-settings__banner-detail">
              {testState.message}
            </div>
          </div>
        </div>
      )}
      {saved && !hasUnsavedChanges && (
        <div className="duet-settings__banner duet-settings__banner--success">
          <CheckCircle size={16} /> Camera settings saved for this printer.
        </div>
      )}
    </>
  );
}

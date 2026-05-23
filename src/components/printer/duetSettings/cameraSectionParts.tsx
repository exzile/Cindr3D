import { AlertCircle, Camera, CheckCircle, Plus, Trash2 } from "lucide-react";
import type { CameraStreamConfig } from "../../../utils/duetPrefs";
import {
  cameraTestDisplayUrl,
  type CameraTestState,
} from "./cameraSectionHelpers";

interface CameraStreamSelectorProps {
  cameras: CameraStreamConfig[];
  draftCameraId: string;
  onAddCamera: () => void;
  onRemoveCamera: () => void;
  onSelectCamera: (cameraId: string) => void;
}

export function CameraStreamSelector({
  cameras,
  draftCameraId,
  onAddCamera,
  onRemoveCamera,
  onSelectCamera,
}: CameraStreamSelectorProps) {
  return (
    <div className="duet-settings__section">
      <div className="duet-settings__section-title">Camera Streams</div>
      <div className="duet-settings__btn-row" style={{ flexWrap: "wrap" }}>
        {cameras.map((camera) => (
          <button
            key={camera.id}
            type="button"
            className={`duet-settings__btn duet-settings__btn--secondary${camera.id === draftCameraId ? " is-active" : ""}`}
            onClick={() => onSelectCamera(camera.id)}
            title={camera.enabled ? `${camera.role} camera` : "Disabled camera"}
          >
            <Camera size={14} /> {camera.label}
          </button>
        ))}
        <button
          type="button"
          className="duet-settings__btn duet-settings__btn--secondary"
          onClick={onAddCamera}
        >
          <Plus size={14} /> Add Camera
        </button>
        <button
          type="button"
          className={`duet-settings__btn duet-settings__btn--danger${cameras.length <= 1 ? " duet-settings__btn--disabled" : ""}`}
          onClick={onRemoveCamera}
          disabled={cameras.length <= 1}
        >
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

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

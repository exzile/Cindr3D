import { Camera, Plus, Trash2 } from "lucide-react";
import type { CameraStreamConfig } from "../../../../utils/duetPrefs";

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

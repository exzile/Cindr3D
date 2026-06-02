import { useComponentStore } from '../../../store/componentStore';
import { DEFAULT_MATERIALS } from '../../../types/cad';

export function MaterialPicker({
  bodyId,
  onClose,
}: {
  bodyId: string;
  onClose: () => void;
}) {
  const setBodyMaterial = useComponentStore((s) => s.setBodyMaterial);

  return (
    <div className="material-picker">
      <div className="material-picker-header">
        <span>Material</span>
        <button className="icon-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="material-grid">
        {DEFAULT_MATERIALS.map((mat) => (
          <button
            key={mat.id}
            className="material-swatch"
            title={mat.name}
            onClick={() => { setBodyMaterial(bodyId, mat); onClose(); }}
          >
            {/* background is dynamic (per-material color) — must stay inline */}
            <div className="swatch-color" style={{ background: mat.color }} />
            <span className="swatch-label">{mat.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

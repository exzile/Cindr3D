import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function UnstitchDialog({ onClose }: { onClose: () => void }) {
  const commitUnstitch = useCADStore((s) => s.commitUnstitch);
  const features = useCADStore((s) => s.features);

  // Surface bodies that can be unstitched (any visible surface with a mesh)
  const surfaceFeatures = features.filter(
    (f) => f.bodyKind === 'surface' && f.visible && f.mesh,
  );
  const [selectedId, setSelectedId] = useState<string>(surfaceFeatures[0]?.id ?? '');
  const [keepOriginal, setKeepOriginal] = useState(false);

  const handleOK = () => {
    commitUnstitch({ sourceFeatureId: selectedId, keepOriginal });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Unstitch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          {surfaceFeatures.length === 0 ? (
            <p className="dialog-hint">No surface bodies found. Create a surface first.</p>
          ) : (
            <div className="form-group">
              <label>Body</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {surfaceFeatures.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
            />
            Keep Original Body
          </label>
          <p className="dialog-hint">Separates the selected body back into individual face surfaces.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleOK}
            disabled={surfaceFeatures.length === 0 || !selectedId}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

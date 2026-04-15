import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function UntrimDialog({ onClose }: { onClose: () => void }) {
  const commitUntrim = useCADStore((s) => s.commitUntrim);
  const features = useCADStore((s) => s.features);

  const surfaceBodies = features.filter(
    (f) => f.bodyKind === 'surface' && f.mesh && f.visible,
  );

  const [sourceFeatureId, setSourceFeatureId] = useState(surfaceBodies[0]?.id ?? '');
  const [expandFactor, setExpandFactor] = useState(1.5);

  const handleOK = () => {
    commitUntrim({ sourceFeatureId, expandFactor });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Untrim</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Surface Body</label>
            <select
              className="dialog-input"
              value={sourceFeatureId}
              onChange={(e) => setSourceFeatureId(e.target.value)}
            >
              <option value="">— select —</option>
              {surfaceBodies.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Expand Factor</label>
            <input
              type="number"
              className="dialog-input"
              value={expandFactor}
              min={1.01}
              max={10}
              step={0.1}
              onChange={(e) => setExpandFactor(parseFloat(e.target.value) || 1.5)}
            />
          </div>
          <p className="dialog-hint">
            Extends the trimmed boundary edges of the selected surface outward
            to its natural (un-trimmed) boundary by the given expansion factor.
          </p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleOK}
            disabled={!sourceFeatureId}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

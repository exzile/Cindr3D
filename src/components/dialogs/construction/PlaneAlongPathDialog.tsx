import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function PlaneAlongPathDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);

  const [pathSketchId, setPathSketchId] = useState(sketches[0]?.id ?? '');
  const [distance, setDistance] = useState(50);
  const [flip, setFlip] = useState(false);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Plane Along Path')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Plane Along Path ${n}`,
      type: 'construction-plane',
      params: { method: 'plane-along-path', pathSketchId, distance, flip },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Plane Along Path</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Path Sketch</label>
            <select
              className="dialog-input"
              value={pathSketchId}
              onChange={(e) => setPathSketchId(e.target.value)}
            >
              {sketches.length === 0 && <option value="">— no sketches —</option>}
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Distance Along Path (%)</label>
            <input
              className="dialog-input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={distance}
              onChange={(e) => setDistance(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
            />
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={flip}
              onChange={(e) => setFlip(e.target.checked)}
            />
            Flip
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

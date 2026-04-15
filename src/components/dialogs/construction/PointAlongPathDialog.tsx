import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function PointAlongPathDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);

  const [pathSketchId, setPathSketchId] = useState(sketches[0]?.id ?? '');
  const [distanceType, setDistanceType] = useState<'percent' | 'mm'>('percent');
  const [position, setPosition] = useState(50);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Point Along Path')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Point Along Path ${n}`,
      type: 'construction-plane',
      params: { method: 'point-along-path', pathSketchId, distanceType, position },
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
          <span className="dialog-title">Point Along Path</span>
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
            <label className="dialog-label">Distance Type</label>
            <select
              className="dialog-input"
              value={distanceType}
              onChange={(e) => setDistanceType(e.target.value as 'percent' | 'mm')}
            >
              <option value="percent">Percentage (%)</option>
              <option value="mm">Distance (mm)</option>
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">
              Position ({distanceType === 'percent' ? '%' : 'mm'})
            </label>
            <input
              className="dialog-input"
              type="number"
              step={distanceType === 'percent' ? 1 : 0.1}
              min={0}
              max={distanceType === 'percent' ? 100 : undefined}
              value={position}
              onChange={(e) => setPosition(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

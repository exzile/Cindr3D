import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function PointAtEdgeAndPlaneDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);

  const [edgeDescription, setEdgeDescription] = useState('');
  const [plane, setPlane] = useState('XY');
  const [offset, setOffset] = useState(0);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Point at Edge/Plane')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Point at Edge/Plane ${n}`,
      type: 'construction-plane',
      params: { method: 'point-at-edge-plane', edgeDescription, plane, offset },
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
          <span className="dialog-title">Point At Edge And Plane</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Edge / Axis</label>
            <input
              className="dialog-input"
              type="text"
              placeholder="Click an edge or axis"
              value={edgeDescription}
              onChange={(e) => setEdgeDescription(e.target.value)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Plane</label>
            <select
              className="dialog-input"
              value={plane}
              onChange={(e) => setPlane(e.target.value)}
            >
              <option value="XY">XY Plane</option>
              <option value="XZ">XZ Plane</option>
              <option value="YZ">YZ Plane</option>
              <option value="construction">Construction Plane</option>
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Offset (mm)</label>
            <input
              className="dialog-input"
              type="number"
              step={0.1}
              value={offset}
              onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
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

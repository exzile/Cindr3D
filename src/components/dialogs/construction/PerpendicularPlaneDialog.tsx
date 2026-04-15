import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function PerpendicularPlaneDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);

  const [faceDescription, setFaceDescription] = useState('');
  const [pointX, setPointX] = useState(0);
  const [pointY, setPointY] = useState(0);
  const [pointZ, setPointZ] = useState(0);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Perpendicular Plane')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Perpendicular Plane ${n}`,
      type: 'construction-plane',
      params: { method: 'perpendicular', faceDescription, pointX, pointY, pointZ },
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
          <span className="dialog-title">Perpendicular Plane</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Reference Face</label>
            <input
              className="dialog-input"
              type="text"
              placeholder="Click a face"
              value={faceDescription}
              onChange={(e) => setFaceDescription(e.target.value)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Point</label>
            <div className="dialog-xyz-row">
              <label className="dialog-xyz-label">X</label>
              <input
                className="dialog-input dialog-input-sm"
                type="number"
                step={0.1}
                value={pointX}
                onChange={(e) => setPointX(parseFloat(e.target.value) || 0)}
              />
              <label className="dialog-xyz-label">Y</label>
              <input
                className="dialog-input dialog-input-sm"
                type="number"
                step={0.1}
                value={pointY}
                onChange={(e) => setPointY(parseFloat(e.target.value) || 0)}
              />
              <label className="dialog-xyz-label">Z</label>
              <input
                className="dialog-input dialog-input-sm"
                type="number"
                step={0.1}
                value={pointZ}
                onChange={(e) => setPointZ(parseFloat(e.target.value) || 0)}
              />
            </div>
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

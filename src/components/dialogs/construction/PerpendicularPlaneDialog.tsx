import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Perpendicular Plane" onClose={onClose} onConfirm={handleOK}>
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
    </DialogShell>
  );
}

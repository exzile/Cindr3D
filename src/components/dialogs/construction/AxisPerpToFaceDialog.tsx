import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function AxisPerpToFaceDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);

  const [faceDescription, setFaceDescription] = useState('');
  const [pointX, setPointX] = useState(0);
  const [pointY, setPointY] = useState(0);
  const [pointZ, setPointZ] = useState(0);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Axis Perp to Face')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Axis Perp to Face ${n}`,
      type: 'construction-axis',
      params: { faceDescription, pointX, pointY, pointZ, method: 'axis-perpendicular' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <DialogShell title="Axis Perpendicular To Face" onClose={onClose} onConfirm={handleOK}>
          <div className="dialog-field">
            <label className="dialog-label">Face</label>
            <input
              className="dialog-input"
              type="text"
              placeholder="Click a face in the viewport"
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

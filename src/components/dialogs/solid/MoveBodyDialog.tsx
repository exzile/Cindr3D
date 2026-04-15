import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function MoveBodyDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const solidFeatures = features.filter((f) => f.type !== 'sketch' && f.type !== 'construction-plane' && f.type !== 'construction-axis');

  const [targetFeatureId, setTargetFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [moveType, setMoveType] = useState<'free' | 'along-axis' | 'point-to-point'>('free');
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dz, setDz] = useState(0);
  const [rx, setRx] = useState(0);
  const [ry, setRy] = useState(0);
  const [rz, setRz] = useState(0);
  const [copy, setCopy] = useState(false);

  const handleApply = () => {
    const label = copy ? 'Copy Body' : 'Move Body';
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `${label}`,
      type: 'import',
      params: { isMoveBody: true, targetFeatureId, moveType, dx, dy, dz, rx, ry, rz, copy },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`${label} applied`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Move / Copy</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Body</label>
            <select value={targetFeatureId} onChange={(e) => setTargetFeatureId(e.target.value)}>
              {solidFeatures.length === 0
                ? <option value="">— no bodies —</option>
                : solidFeatures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)
              }
            </select>
          </div>
          <div className="form-group">
            <label>Move Type</label>
            <select value={moveType} onChange={(e) => setMoveType(e.target.value as 'free' | 'along-axis' | 'point-to-point')}>
              <option value="free">Free Move</option>
              <option value="along-axis">Along Axis</option>
              <option value="point-to-point">Point to Point</option>
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>X Offset (mm)</label>
              <input type="number" value={dx} onChange={(e) => setDx(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Y Offset (mm)</label>
              <input type="number" value={dy} onChange={(e) => setDy(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Z Offset (mm)</label>
              <input type="number" value={dz} onChange={(e) => setDz(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>X Rotation (°)</label>
              <input type="number" value={rx} onChange={(e) => setRx(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Y Rotation (°)</label>
              <input type="number" value={ry} onChange={(e) => setRy(parseFloat(e.target.value) || 0)} step={1} />
            </div>
            <div className="form-group">
              <label>Z Rotation (°)</label>
              <input type="number" value={rz} onChange={(e) => setRz(parseFloat(e.target.value) || 0)} step={1} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            Create Copy
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

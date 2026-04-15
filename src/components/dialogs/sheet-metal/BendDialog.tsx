import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function BendDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitBend = useCADStore((s) => s.commitBend);
  const closeBendDialog = useCADStore((s) => s.closeBendDialog);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [featureId, setFeatureId] = useState<string>(bodyFeatures[0]?.id ?? '');
  const [bendLineStartX, setBendLineStartX] = useState(-10);
  const [bendLineStartY, setBendLineStartY] = useState(0);
  const [bendLineStartZ, setBendLineStartZ] = useState(0);
  const [bendLineEndX, setBendLineEndX] = useState(10);
  const [bendLineEndY, setBendLineEndY] = useState(0);
  const [bendLineEndZ, setBendLineEndZ] = useState(0);
  const [bendAngle, setBendAngle] = useState(90);
  const [kFactor, setKFactor] = useState(0.5);

  const handleClose = () => { closeBendDialog(); onClose(); };

  const handleOK = () => {
    if (!featureId) {
      setStatusMessage('Bend: no body selected');
      return;
    }
    commitBend({
      featureId,
      bendLineStartX, bendLineStartY, bendLineStartZ,
      bendLineEndX, bendLineEndY, bendLineEndZ,
      bendAngle, kFactor,
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Sheet Metal Bend</h3>
          <button className="dialog-close" onClick={handleClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Body</label>
            <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <p className="dialog-section-label">Bend Line Start</p>
          <div className="form-group form-group-row">
            <label>X</label>
            <input type="number" step={0.1} value={bendLineStartX} onChange={(e) => setBendLineStartX(parseFloat(e.target.value) || 0)} />
            <label>Y</label>
            <input type="number" step={0.1} value={bendLineStartY} onChange={(e) => setBendLineStartY(parseFloat(e.target.value) || 0)} />
            <label>Z</label>
            <input type="number" step={0.1} value={bendLineStartZ} onChange={(e) => setBendLineStartZ(parseFloat(e.target.value) || 0)} />
          </div>
          <p className="dialog-section-label">Bend Line End</p>
          <div className="form-group form-group-row">
            <label>X</label>
            <input type="number" step={0.1} value={bendLineEndX} onChange={(e) => setBendLineEndX(parseFloat(e.target.value) || 0)} />
            <label>Y</label>
            <input type="number" step={0.1} value={bendLineEndY} onChange={(e) => setBendLineEndY(parseFloat(e.target.value) || 0)} />
            <label>Z</label>
            <input type="number" step={0.1} value={bendLineEndZ} onChange={(e) => setBendLineEndZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="form-group">
            <label>Bend Angle (°)</label>
            <input type="number" min={0} max={360} step={1} value={bendAngle}
              onChange={(e) => setBendAngle(Math.min(360, Math.max(0, parseFloat(e.target.value) || 90)))} />
          </div>
          <div className="form-group">
            <label>K-Factor (0–1)</label>
            <input type="number" min={0} max={1} step={0.05} value={kFactor}
              onChange={(e) => setKFactor(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0.5)))} />
          </div>
          <p className="dialog-hint">Splits the mesh at the bend line and rotates one side by the bend angle.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!featureId}>OK</button>
        </div>
      </div>
    </div>
  );
}

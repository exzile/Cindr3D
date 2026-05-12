import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MeshSmoothDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitMeshSmooth = useCADStore((s) => s.commitMeshSmooth);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);
  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');
  const [iterations, setIterations] = useState(5);
  const [factor, setFactor] = useState(0.5);

  const handleOK = () => {
    if (!featureId) {
      setStatusMessage('Mesh Smooth: select a feature first');
      return;
    }
    commitMeshSmooth(featureId, iterations, factor);
    onClose();
  };

  return (
    <DialogShell title="Mesh Smooth" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {meshFeatures.length === 0 && <option value="">No mesh features</option>}
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Iterations (1–20)</label>
        <input
          type="number"
          min={1}
          max={20}
          value={iterations}
          onChange={(e) => setIterations(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
        />
      </div>
      <div className="form-group">
        <label>Strength: {factor.toFixed(1)}</label>
        <input
          type="range"
          min={0.1}
          max={1.0}
          step={0.1}
          value={factor}
          onChange={(e) => setFactor(parseFloat(e.target.value))}
        />
      </div>
      <p className="dialog-hint">Applies Laplacian smoothing to soften rough or creased regions.</p>
    </DialogShell>
  );
}

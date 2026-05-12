import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function RemeshDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitRemesh = useCADStore((s) => s.commitRemesh);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null && !f.suppressed);

  const [featureId, setFeatureId] = useState<string>(meshFeatures[0]?.id ?? '');
  const [mode, setMode] = useState<'Refine' | 'Coarsen'>('Refine');
  const [iterations, setIterations] = useState(2);
  const [preserveShape, setPreserveShape] = useState(true);
  void preserveShape; // used for UI only

  const handleOK = () => {
    if (!featureId) { setStatusMessage('Remesh: select a mesh feature'); return; }
    commitRemesh(featureId, mode === 'Refine' ? 'refine' : 'coarsen', iterations);
    onClose();
  };

  return (
    <DialogShell title="Remesh" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Mesh Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          <option value="" disabled>Select a feature</option>
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'Refine' | 'Coarsen')}>
          <option value="Refine">Refine</option>
          <option value="Coarsen">Coarsen</option>
        </select>
      </div>
      <div className="form-group">
        <label>Iterations (1–5)</label>
        <input
          type="number"
          min={1}
          max={5}
          value={iterations}
          onChange={(e) => setIterations(Math.min(5, Math.max(1, parseInt(e.target.value, 10) || 2)))}
        />
      </div>
      <div className="form-group form-group-inline">
        <label>Preserve Shape</label>
        <input
          type="checkbox"
          checked={preserveShape}
          onChange={(e) => setPreserveShape(e.target.checked)}
        />
      </div>
      <p className="dialog-hint">Refines or coarsens mesh faces via subdivision or edge collapse.</p>
    </DialogShell>
  );
}

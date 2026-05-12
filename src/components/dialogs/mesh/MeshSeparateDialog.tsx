import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MeshSeparateDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitMeshSeparate = useCADStore((s) => s.commitMeshSeparate);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const meshFeatures = features.filter((f) => f.mesh != null);
  const [featureId, setFeatureId] = useState(meshFeatures[0]?.id ?? '');

  const handleOK = () => {
    if (!featureId) {
      setStatusMessage('Mesh Separate: select a feature first');
      return;
    }
    commitMeshSeparate(featureId);
    onClose();
  };

  return (
    <DialogShell title="Mesh Separate" onClose={onClose} onConfirm={handleOK}>
      <div className="form-group">
        <label>Feature</label>
        <select value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
          {meshFeatures.length === 0 && <option value="">No mesh features</option>}
          {meshFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <p className="dialog-hint">Splits the mesh into separate bodies at disconnected islands.</p>
    </DialogShell>
  );
}

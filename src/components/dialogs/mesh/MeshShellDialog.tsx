import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MeshShellDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitMeshShell = useCADStore((s) => s.commitMeshShell);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(bodyFeatures[0]?.id ?? '');
  const [thickness, setThickness] = useState(2);
  const [direction, setDirection] = useState<'inward' | 'outward' | 'symmetric'>('inward');

  const handleOK = () => {
    if (!selectedId) {
      setStatusMessage('Mesh Shell: no body selected');
      return;
    }
    commitMeshShell(selectedId, thickness, direction);
    onClose();
  };

  return (
    <DialogShell title="Mesh Shell" onClose={onClose} size="sm" onConfirm={handleOK} confirmDisabled={!selectedId}>
      <div className="form-group">
        <label>Body</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Thickness (0.5–50 mm)</label>
        <input
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          value={thickness}
          onChange={(e) => setThickness(Math.min(50, Math.max(0.5, parseFloat(e.target.value) || 2)))}
        />
      </div>
      <div className="form-group">
        <label>Direction</label>
        <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
          <option value="inward">Inside</option>
          <option value="outward">Outside</option>
          <option value="symmetric">Symmetric</option>
        </select>
      </div>
      <p className="dialog-hint">Hollows the interior of the mesh body to the specified wall thickness.</p>
    </DialogShell>
  );
}

import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function UntrimDialog({ onClose }: { onClose: () => void }) {
  const commitUntrim = useCADStore((s) => s.commitUntrim);
  const features = useCADStore((s) => s.features);

  const surfaceBodies = features.filter(
    (f) => f.bodyKind === 'surface' && f.mesh && f.visible,
  );

  const [sourceFeatureId, setSourceFeatureId] = useState(surfaceBodies[0]?.id ?? '');
  const [expandFactor, setExpandFactor] = useState(1.5);

  const handleOK = () => {
    commitUntrim({ sourceFeatureId, expandFactor });
    onClose();
  };

  return (
    <DialogShell title="Untrim" onClose={onClose} onConfirm={handleOK} confirmDisabled={!sourceFeatureId}>
      <div className="form-group">
        <label>Surface Body</label>
        <select
          value={sourceFeatureId}
          onChange={(e) => setSourceFeatureId(e.target.value)}
        >
          <option value="">— select —</option>
          {surfaceBodies.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Expand Factor</label>
        <input
          type="number"
          value={expandFactor}
          min={1.01}
          max={10}
          step={0.1}
          onChange={(e) => setExpandFactor(parseFloat(e.target.value) || 1.5)}
        />
      </div>
      <p className="dialog-hint">
        Extends the trimmed boundary edges of the selected surface outward
        to its natural (un-trimmed) boundary by the given expansion factor.
      </p>
    </DialogShell>
  );
}

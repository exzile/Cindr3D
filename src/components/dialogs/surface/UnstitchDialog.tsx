import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function UnstitchDialog({ onClose }: { onClose: () => void }) {
  const commitUnstitch = useCADStore((s) => s.commitUnstitch);
  const features = useCADStore((s) => s.features);

  // Surface bodies that can be unstitched (any visible surface with a mesh)
  const surfaceFeatures = features.filter(
    (f) => f.bodyKind === 'surface' && f.visible && f.mesh,
  );
  const [selectedId, setSelectedId] = useState<string>(surfaceFeatures[0]?.id ?? '');
  const [keepOriginal, setKeepOriginal] = useState(false);

  const handleOK = () => {
    commitUnstitch({ sourceFeatureId: selectedId, keepOriginal });
    onClose();
  };

  return (
    <DialogShell title="Unstitch" onClose={onClose} size="sm" onConfirm={handleOK} confirmDisabled={surfaceFeatures.length === 0 || !selectedId}>
      {surfaceFeatures.length === 0 ? (
            <p className="dialog-hint">No surface bodies found. Create a surface first.</p>
          ) : (
            <div className="form-group">
              <label>Body</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {surfaceFeatures.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
            />
            Keep Original Body
          </label>
          <p className="dialog-hint">Separates the selected body back into individual face surfaces.</p>
    </DialogShell>
  );
}

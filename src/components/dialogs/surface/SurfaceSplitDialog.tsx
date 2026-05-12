import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function SurfaceSplitDialog({ onClose }: { onClose: () => void }) {
  const commitSurfaceSplit = useCADStore((s) => s.commitSurfaceSplit);
  const features = useCADStore((s) => s.features);

  const surfaceBodies = features.filter(
    (f) => f.bodyKind === 'surface' && f.mesh && f.visible,
  );

  const [sourceFeatureId, setSourceFeatureId] = useState(surfaceBodies[0]?.id ?? '');
  const [splitterFeatureId, setSplitterFeatureId] = useState(surfaceBodies[1]?.id ?? '');

  const handleOK = () => {
    commitSurfaceSplit({ sourceFeatureId, splitterFeatureId });
    onClose();
  };

  return (
    <DialogShell title="Surface Split" onClose={onClose} size="sm" onConfirm={handleOK} confirmDisabled={!sourceFeatureId || !splitterFeatureId}>
      <div className="form-group">
            <label>Surface to Split</label>
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
            <label>Splitting Tool</label>
            <select
              value={splitterFeatureId}
              onChange={(e) => setSplitterFeatureId(e.target.value)}
            >
              <option value="">— select —</option>
              {surfaceBodies
                .filter((f) => f.id !== sourceFeatureId)
                .map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
            </select>
          </div>
          <p className="dialog-hint">
            Select the surface to split and the surface or plane used as the
            splitting tool. The source surface will be hidden and replaced by
            two new surface bodies.
          </p>
    </DialogShell>
  );
}

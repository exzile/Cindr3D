import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function SurfaceTrimDialog({ onClose }: { onClose: () => void }) {
  const commitSurfaceTrim = useCADStore((s) => s.commitSurfaceTrim);
  const features = useCADStore((s) => s.features);

  const surfaceBodies = features.filter(
    (f) => f.bodyKind === 'surface' && f.mesh && f.visible,
  );

  const [sourceFeatureId, setSourceFeatureId] = useState(surfaceBodies[0]?.id ?? '');
  const [trimmerFeatureId, setTrimmerFeatureId] = useState(surfaceBodies[1]?.id ?? '');
  const [keepSide, setKeepSide] = useState<'inside' | 'outside'>('outside');

  const handleOK = () => {
    commitSurfaceTrim({ sourceFeatureId, trimmerFeatureId, keepSide });
    onClose();
  };

  return (
    <DialogShell title="Surface Trim" onClose={onClose} size="sm" onConfirm={handleOK} confirmDisabled={!sourceFeatureId || !trimmerFeatureId}>
      <div className="form-group">
            <label>Source Surface</label>
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
            <label>Trimming Tool</label>
            <select
              value={trimmerFeatureId}
              onChange={(e) => setTrimmerFeatureId(e.target.value)}
            >
              <option value="">— select —</option>
              {surfaceBodies
                .filter((f) => f.id !== sourceFeatureId)
                .map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
            </select>
          </div>
          <div className="form-group">
            <label>Keep Side</label>
            <select
              value={keepSide}
              onChange={(e) => setKeepSide(e.target.value as 'inside' | 'outside')}
            >
              <option value="outside">Outside (positive side)</option>
              <option value="inside">Inside (negative side)</option>
            </select>
          </div>
          <p className="dialog-hint">
            Select the surface to trim and the surface or plane to trim against.
            The selected keep-side of the source surface will be retained.
          </p>
    </DialogShell>
  );
}

import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import '../FeatureDialogExtras.css';

export function SnapFitDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const commitSnapFit = useCADStore((s) => s.commitSnapFit);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [snapType, setSnapType] = useState<'cantilever' | 'annular' | 'torsional'>(
    (p.snapType as 'cantilever' | 'annular' | 'torsional') ?? 'cantilever'
  );
  const [length, setLength] = useState(Number(p.length ?? 10));
  const [width, setWidth] = useState(Number(p.width ?? 5));
  const [thickness, setThickness] = useState(Number(p.thickness ?? 1.5));
  const [overhang, setOverhang] = useState(Number(p.overhang ?? 1));
  const [overhangAngle, setOverhangAngle] = useState(Number(p.overhangAngle ?? 45));
  const [returnAngle, setReturnAngle] = useState(Number(p.returnAngle ?? 45));
  const [operation, setOperation] = useState<'join' | 'cut' | 'new-body'>(
    (p.operation as 'join' | 'cut' | 'new-body') ?? 'join'
  );

  const handleApply = () => {
    const params = { snapType, length, width, thickness, overhang, overhangAngle, returnAngle, operation };
    if (editing) {
      // Re-create the hook with the new params (rebuilds feature.mesh) rather
      // than only mutating params, which would leave stale geometry.
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated Snap Fit`);
    } else {
      commitSnapFit(params);
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Snap Fit' : 'Snap Fit'} onClose={onClose} size="sm" onConfirm={handleApply} confirmLabel={editing ? 'Update' : 'OK'}>
      <div className="form-group">
            <label>Type</label>
            <select value={snapType} onChange={(e) => setSnapType(e.target.value as typeof snapType)}>
              <option value="cantilever">Cantilever</option>
              <option value="annular">Annular</option>
              <option value="torsional">Torsional</option>
            </select>
          </div>

          <div className="settings-grid">
            <div className="form-group">
              <label>Length (mm)</label>
              <input type="number" value={length} min={0.1} step={0.5}
                onChange={(e) => setLength(Math.max(0.1, parseFloat(e.target.value) || length))} />
            </div>
            <div className="form-group">
              <label>Width (mm)</label>
              <input type="number" value={width} min={0.1} step={0.5}
                onChange={(e) => setWidth(Math.max(0.1, parseFloat(e.target.value) || width))} />
            </div>
            <div className="form-group">
              <label>Thickness (mm)</label>
              <input type="number" value={thickness} min={0.1} step={0.1}
                onChange={(e) => setThickness(Math.max(0.1, parseFloat(e.target.value) || thickness))} />
            </div>
            <div className="form-group">
              <label>Overhang (mm)</label>
              <input type="number" value={overhang} min={0} step={0.1}
                onChange={(e) => setOverhang(Math.max(0, parseFloat(e.target.value) || 0))} />
            </div>
            <div className="form-group">
              <label>Overhang Angle (°)</label>
              <input type="number" value={overhangAngle} min={0} max={89} step={1}
                onChange={(e) => setOverhangAngle(Math.min(89, Math.max(0, parseFloat(e.target.value) || overhangAngle)))} />
            </div>
            <div className="form-group">
              <label>Return Angle (°)</label>
              <input type="number" value={returnAngle} min={0} max={89} step={1}
                onChange={(e) => setReturnAngle(Math.min(89, Math.max(0, parseFloat(e.target.value) || returnAngle)))} />
            </div>
          </div>

          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
              <option value="new-body">New Body</option>
            </select>
          </div>
    </DialogShell>
  );
}

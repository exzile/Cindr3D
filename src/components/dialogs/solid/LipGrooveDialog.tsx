import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import '../FeatureDialogExtras.css';

export function LipGrooveDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const commitLipGroove = useCADStore((s) => s.commitLipGroove);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [lipWidth, setLipWidth] = useState(Number(p.lipWidth ?? 2));
  const [lipHeight, setLipHeight] = useState(Number(p.lipHeight ?? 2));
  const [grooveWidth, setGrooveWidth] = useState(Number(p.grooveWidth ?? 2.2));
  const [grooveDepth, setGrooveDepth] = useState(Number(p.grooveDepth ?? 2.2));
  const [clearance, setClearance] = useState(Number(p.clearance ?? 0.1));
  const [includeGroove, setIncludeGroove] = useState<boolean>(p.includeGroove !== false);
  const [operation, setOperation] = useState<'join' | 'cut' | 'new-body'>(
    (p.operation as 'join' | 'cut' | 'new-body') ?? 'join'
  );

  const handleApply = () => {
    const params = { lipWidth, lipHeight, grooveWidth, grooveDepth, clearance, includeGroove, operation };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated Lip and Groove`);
    } else {
      commitLipGroove(params);
    }
    onClose();
  };

  return (
    <DialogShell
      title={editing ? 'Edit Lip and Groove' : 'Lip and Groove'}
      onClose={onClose}
      size="sm"
      onConfirm={handleApply}
      confirmLabel={editing ? 'Update' : 'OK'}
    >
      <div className="feature-dialog-section-title">Lip</div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Width (mm)</label>
          <input type="number" value={lipWidth} min={0.1} step={0.1}
            onChange={(e) => setLipWidth(Math.max(0.1, parseFloat(e.target.value) || lipWidth))} />
        </div>
        <div className="form-group">
          <label>Height (mm)</label>
          <input type="number" value={lipHeight} min={0.1} step={0.1}
            onChange={(e) => setLipHeight(Math.max(0.1, parseFloat(e.target.value) || lipHeight))} />
        </div>
      </div>

      <div className="form-group form-group--checkbox">
        <label>
          <input type="checkbox" checked={includeGroove}
            onChange={(e) => setIncludeGroove(e.target.checked)} />
          Include Groove
        </label>
      </div>

      {includeGroove && (
        <>
          <div className="feature-dialog-section-title">Groove</div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Width (mm)</label>
              <input type="number" value={grooveWidth} min={0.1} step={0.1}
                onChange={(e) => setGrooveWidth(Math.max(0.1, parseFloat(e.target.value) || grooveWidth))} />
            </div>
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={grooveDepth} min={0.1} step={0.1}
                onChange={(e) => setGrooveDepth(Math.max(0.1, parseFloat(e.target.value) || grooveDepth))} />
            </div>
            <div className="form-group">
              <label>Clearance (mm)</label>
              <input type="number" value={clearance} min={0} step={0.01}
                onChange={(e) => setClearance(Math.max(0, parseFloat(e.target.value) || 0))} />
            </div>
          </div>
        </>
      )}

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

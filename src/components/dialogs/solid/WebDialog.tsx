import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function WebDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const commitWeb = useCADStore((s) => s.commitWeb);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [sketchId, setSketchId] = useState(String(p.sketchId ?? editing?.sketchId ?? ''));
  const [thickness, setThickness] = useState(Number(p.thickness ?? 2));
  const [height, setHeight] = useState(Number(p.height ?? 10));
  const [direction, setDirection] = useState<'normal' | 'flip' | 'symmetric'>((p.direction as 'normal' | 'flip' | 'symmetric') ?? 'normal');
  const [operation, setOperation] = useState<'join' | 'new-body'>((p.operation as 'join' | 'new-body') ?? 'join');

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { sketchId, thickness, height, direction, operation, webStyle: 'perpendicular' });
      setStatusMessage(`Updated web: ${thickness}mm thick`);
      onClose();
    } else {
      if (!sketchId) { setStatusMessage('Web: select a profile sketch'); return; }
      commitWeb(sketchId, thickness, height);
      onClose();
    }
  };

  return (
    <DialogShell title={editing ? 'Edit Web' : 'Web'} onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!sketchId && !editing}>
      <div className="form-group">
            <label>Profile Sketch</label>
            <select value={sketchId} onChange={(e) => setSketchId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Thickness (mm)</label>
              <input type="number" value={thickness} onChange={(e) => setThickness(Math.max(0.01, parseFloat(e.target.value) || 2))} step={0.5} min={0.01} />
            </div>
            <div className="form-group">
              <label>Height (mm)</label>
              <input type="number" value={height} onChange={(e) => setHeight(Math.max(0.1, parseFloat(e.target.value) || 10))} step={1} min={0.1} />
            </div>
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="normal">Normal</option>
              <option value="flip">Flip</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
              <option value="join">Join</option>
              <option value="new-body">New Body</option>
            </select>
          </div>
          <p className="dialog-hint">Select a sketch with multiple lines to create a cross-hatch web pattern.</p>
    </DialogShell>
  );
}

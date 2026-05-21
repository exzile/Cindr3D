import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function PipeDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const commitPipe = useCADStore((s) => s.commitPipe);
  const updatePipeGeometry = useCADStore((s) => s.updatePipeGeometry);

  const [pathSketchId, setPathSketchId] = useState<string>(
    (p.pathSketchId as string) ?? (sketches[0]?.id ?? ''),
  );
  const [outerDiameter, setOuterDiameter] = useState(Number(p.outerDiameter ?? 10));
  const [hollow, setHollow] = useState<boolean>(p.hollow !== false);
  const [wallThickness, setWallThickness] = useState(Number(p.wallThickness ?? 1));
  const [operation, setOperation] = useState<'new-body' | 'join' | 'cut'>(
    (p.operation as 'new-body' | 'join' | 'cut') ?? 'new-body',
  );

  const handleApply = () => {
    const params = { outerDiameter, hollow, wallThickness, operation, pathSketchId };
    if (editing) {
      updatePipeGeometry(editing.id, params);
    } else {
      commitPipe(params);
    }
    onClose();
  };

  return (
    <DialogShell
      title={editing ? 'Edit Pipe' : 'Pipe'}
      onClose={onClose}
      size="sm"
      onConfirm={handleApply}
      confirmLabel={editing ? 'Update' : 'OK'}
    >
      <div className="form-group">
        <label>Path Sketch</label>
        <select value={pathSketchId} onChange={(e) => setPathSketchId(e.target.value)}>
          {sketches.length === 0
            ? <option value="">— no sketches —</option>
            : sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
          }
        </select>
      </div>
      <div className="form-group">
        <label>Outer Diameter (mm)</label>
        <input
          type="number"
          value={outerDiameter}
          onChange={(e) => setOuterDiameter(Math.max(0.1, parseFloat(e.target.value) || 10))}
          step={0.5}
          min={0.1}
        />
      </div>
      <label className="checkbox-label">
        <input type="checkbox" checked={hollow} onChange={(e) => setHollow(e.target.checked)} />
        Hollow
      </label>
      {hollow && (
        <div className="form-group">
          <label>Wall Thickness (mm)</label>
          <input
            type="number"
            value={wallThickness}
            onChange={(e) => setWallThickness(Math.max(0.01, parseFloat(e.target.value) || 1))}
            step={0.1}
            min={0.01}
          />
        </div>
      )}
      <div className="form-group">
        <label>Operation</label>
        <select value={operation} onChange={(e) => setOperation(e.target.value as 'new-body' | 'join' | 'cut')}>
          <option value="new-body">New Body</option>
          <option value="join">Join</option>
          <option value="cut">Cut</option>
        </select>
      </div>
    </DialogShell>
  );
}

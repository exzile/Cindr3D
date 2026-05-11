import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

export function PipeDialog({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [pathSketchId, setPathSketchId] = useState(sketches[0]?.id ?? '');
  const [outerDiameter, setOuterDiameter] = useState(10);
  const [hollow, setHollow] = useState(true);
  const [wallThickness, setWallThickness] = useState(1);
  const [operation, setOperation] = useState<'new-body' | 'join' | 'cut'>('new-body');

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Pipe (⌀${outerDiameter}mm)`,
      type: 'pipe',
      params: { isPipe: true, outerDiameter, hollow, wallThickness, operation, pathSketchId },
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Created pipe ⌀${outerDiameter}mm`);
    onClose();
  };

  return (
    <DialogShell title="Pipe" onClose={onClose} size="sm" onConfirm={handleApply}>
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

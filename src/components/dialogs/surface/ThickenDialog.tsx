import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function ThickenDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [thickness, setThickness] = useState(Number(p.thickness ?? 2));
  const [direction, setDirection] = useState<'inside' | 'outside' | 'symmetric'>((p.direction as 'inside' | 'outside' | 'symmetric') ?? 'inside');
  const [operation, setOperation] = useState<'new-body' | 'join' | 'cut'>((p.operation as 'new-body' | 'join' | 'cut') ?? 'new-body');

  const commitThicken = useCADStore((s) => s.commitThicken);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { thickness, direction, operation });
      setStatusMessage(`Updated thicken: ${thickness}mm ${direction}`);
    } else {
      commitThicken({ thickness, direction, operation });
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Thicken' : 'Thicken'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Thickness (mm)</label>
            <input type="number" value={thickness} onChange={(e) => setThickness(Math.max(0.01, parseFloat(e.target.value) || 2))} step={0.5} min={0.01} />
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'inside' | 'outside' | 'symmetric')}>
              <option value="inside">Inside</option>
              <option value="outside">Outside</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'new-body' | 'join' | 'cut')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
          <p className="dialog-hint">Select a face or surface body in the viewport to thicken.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature, FeatureType } from '../../../types/cad';

export function WebDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [thickness, setThickness] = useState(Number(p.thickness ?? 2));
  const [height, setHeight] = useState(Number(p.height ?? 10));
  const [direction, setDirection] = useState<'normal' | 'flip' | 'symmetric'>((p.direction as 'normal' | 'flip' | 'symmetric') ?? 'normal');
  const [operation, setOperation] = useState<'join' | 'new-body'>((p.operation as 'join' | 'new-body') ?? 'join');

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { thickness, height, direction, operation, webStyle: 'perpendicular' });
      setStatusMessage(`Updated web: ${thickness}mm thick`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Web (${thickness}mm thick)`,
        type: 'rib' as FeatureType,
        params: { thickness, height, direction, operation, webStyle: 'perpendicular' },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created web: ${thickness}mm thick`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Web' : 'Web'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
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
          <p className="dialog-hint">Select an open-profile sketch perpendicular to the base plane.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

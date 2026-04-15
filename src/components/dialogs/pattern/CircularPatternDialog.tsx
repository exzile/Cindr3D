import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function CircularPatternDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [count, setCount] = useState(Number(p.count ?? 6));
  const [totalAngle, setTotalAngle] = useState(Number(p.totalAngle ?? 360));
  const [symmetric, setSymmetric] = useState(p.symmetric !== false && !!p.symmetric);
  const [axis, setAxis] = useState<'X' | 'Y' | 'Z'>((p.axis as 'X' | 'Y' | 'Z') ?? 'Y');
  const [computeType, setComputeType] = useState<'optimized' | 'identical' | 'adjust'>((p.computeType as 'optimized' | 'identical' | 'adjust') ?? 'optimized');

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { count, totalAngle, symmetric, axis, computeType });
      setStatusMessage(`Updated circular pattern: ${count} instances around ${axis}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Circular Pattern (${count}x)`,
        type: 'circular-pattern',
        params: { count, totalAngle, symmetric, axis, computeType },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created circular pattern: ${count} instances around ${axis}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Circular Pattern' : 'Circular Pattern'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Axis</label>
            <select value={axis} onChange={(e) => setAxis(e.target.value as 'X' | 'Y' | 'Z')}>
              <option value="X">X Axis</option>
              <option value="Y">Y Axis</option>
              <option value="Z">Z Axis</option>
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Total Angle (°)</label>
              <input type="number" value={totalAngle} onChange={(e) => setTotalAngle(parseFloat(e.target.value) || 360)} min={1} max={360} />
            </div>
          </div>
          <div className="form-group">
            <label>Compute Type</label>
            <select value={computeType} onChange={(e) => setComputeType(e.target.value as 'optimized' | 'identical' | 'adjust')}>
              <option value="optimized">Optimized</option>
              <option value="identical">Identical</option>
              <option value="adjust">Adjust</option>
            </select>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />
            Symmetric
          </label>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

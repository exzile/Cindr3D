import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function PatternOnPathDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [pathSketchId, setPathSketchId] = useState<string>(String(p.pathSketchId ?? ''));
  const [count, setCount] = useState(Number(p.count ?? 4));
  const [alignment, setAlignment] = useState<'tangent' | 'fixed'>((p.alignment as 'tangent' | 'fixed') ?? 'tangent');
  const [distance, setDistance] = useState(Number(p.distance ?? 100));
  const [distanceType, setDistanceType] = useState<'percent' | 'spacing'>((p.distanceType as 'percent' | 'spacing') ?? 'percent');

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === pathSketchId);
    const params = {
      pathSketchId,
      pathSketchName: sketch?.name ?? '',
      count,
      alignment,
      distance,
      distanceType,
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated pattern on path: ${count} instances`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Pattern on Path (${count}×)`,
        type: 'pattern-on-path',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created pattern on path: ${count} instances`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Pattern on Path' : 'Pattern on Path'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Path Sketch</label>
            <select value={pathSketchId} onChange={(e) => setPathSketchId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Count</label>
            <input type="number" value={count} min={2} step={1}
              onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} />
          </div>
          <div className="form-group">
            <label>Orientation</label>
            <select value={alignment} onChange={(e) => setAlignment(e.target.value as 'tangent' | 'fixed')}>
              <option value="tangent">Tangent to Path</option>
              <option value="fixed">Fixed (Parallel)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Distance Type</label>
            <select value={distanceType} onChange={(e) => setDistanceType(e.target.value as 'percent' | 'spacing')}>
              <option value="percent">% of Path Length</option>
              <option value="spacing">Equal Spacing</option>
            </select>
          </div>
          {distanceType === 'percent' && (
            <div className="form-group">
              <label>Path Coverage (%)</label>
              <input type="number" value={distance} min={1} max={100} step={5}
                onChange={(e) => setDistance(Math.max(1, Math.min(100, parseFloat(e.target.value) || 100)))} />
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!pathSketchId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

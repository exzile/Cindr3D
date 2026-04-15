import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function LinearPatternDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [count, setCount] = useState(Number(p.count ?? 3));
  const [spacing, setSpacing] = useState(Number(p.spacing ?? 20));
  const [distribution, setDistribution] = useState<'spacing' | 'extent'>((p.distribution as 'spacing' | 'extent') ?? 'spacing');
  const [directionX, setDirectionX] = useState(Number(p.directionX ?? 1));
  const [directionY, setDirectionY] = useState(Number(p.directionY ?? 0));
  const [directionZ, setDirectionZ] = useState(Number(p.directionZ ?? 0));
  const [useSecond, setUseSecond] = useState(p.useSecondDirection !== false && !!p.useSecondDirection);
  const [count2, setCount2] = useState(Number(p.count2 ?? 2));
  const [spacing2, setSpacing2] = useState(Number(p.spacing2 ?? 20));
  const [distribution2, setDistribution2] = useState<'spacing' | 'extent'>((p.distribution2 as 'spacing' | 'extent') ?? 'spacing');

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const effectiveSpacing = distribution === 'extent' ? spacing / Math.max(1, count - 1) : spacing;
  const effectiveSpacing2 = distribution2 === 'extent' ? spacing2 / Math.max(1, count2 - 1) : spacing2;

  const handleApply = () => {
    const params = {
      count,
      spacing: effectiveSpacing,
      distribution,
      directionX, directionY, directionZ,
      useSecondDirection: useSecond,
      count2: useSecond ? count2 : 1,
      spacing2: useSecond ? effectiveSpacing2 : 0,
      distribution2: useSecond ? distribution2 : 'spacing',
    };
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated linear pattern: ${count}${useSecond ? ` × ${count2}` : ''} instances`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Linear Pattern (${count}${useSecond ? `×${count2}` : ''})`,
        type: 'linear-pattern',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created linear pattern: ${count}${useSecond ? ` × ${count2}` : ''} instances`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Linear Pattern' : 'Linear Pattern'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="settings-grid">
            <div className="form-group">
              <label>Count</label>
              <input type="number" value={count} onChange={(e) => setCount(Math.max(2, parseInt(e.target.value) || 2))} min={2} max={100} />
            </div>
            <div className="form-group">
              <label>Distribution</label>
              <select value={distribution} onChange={(e) => setDistribution(e.target.value as 'spacing' | 'extent')}>
                <option value="spacing">Spacing</option>
                <option value="extent">Extent</option>
              </select>
            </div>
            <div className="form-group">
              <label>{distribution === 'extent' ? 'Total Extent (mm)' : 'Spacing (mm)'}</label>
              <input type="number" value={spacing} onChange={(e) => setSpacing(parseFloat(e.target.value) || 10)} step={1} />
            </div>
          </div>
          <div className="form-group">
            <label>Direction (X, Y, Z)</label>
            <div className="direction-inputs">
              <input type="number" value={directionX} onChange={(e) => setDirectionX(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionY} onChange={(e) => setDirectionY(parseFloat(e.target.value) || 0)} step={0.1} />
              <input type="number" value={directionZ} onChange={(e) => setDirectionZ(parseFloat(e.target.value) || 0)} step={0.1} />
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={useSecond} onChange={(e) => setUseSecond(e.target.checked)} />
            Second Direction
          </label>
          {useSecond && (
            <div className="settings-grid">
              <div className="form-group">
                <label>Count 2</label>
                <input type="number" value={count2} onChange={(e) => setCount2(Math.max(2, parseInt(e.target.value) || 2))} min={2} />
              </div>
              <div className="form-group">
                <label>Distribution 2</label>
                <select value={distribution2} onChange={(e) => setDistribution2(e.target.value as 'spacing' | 'extent')}>
                  <option value="spacing">Spacing</option>
                  <option value="extent">Extent</option>
                </select>
              </div>
              <div className="form-group">
                <label>{distribution2 === 'extent' ? 'Extent 2 (mm)' : 'Spacing 2 (mm)'}</label>
                <input type="number" value={spacing2} onChange={(e) => setSpacing2(parseFloat(e.target.value) || 10)} />
              </div>
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

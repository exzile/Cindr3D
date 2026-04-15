import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function ScaleDialog({ onClose }: { onClose: () => void }) {
  // D186: pre-fill from feature being edited
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [scaleType, setScaleType] = useState<'uniform' | 'non-uniform'>(((p.scaleType as 'uniform' | 'non-uniform') ?? 'uniform'));
  const [factor, setFactor] = useState(Number(p.factor ?? 1));
  const [factorX, setFactorX] = useState(Number(p.factorX ?? 1));
  const [factorY, setFactorY] = useState(Number(p.factorY ?? 1));
  const [factorZ, setFactorZ] = useState(Number(p.factorZ ?? 1));
  const [refPoint, setRefPoint] = useState<'centroid' | 'origin'>(((p.refPoint as 'centroid' | 'origin') ?? 'centroid'));

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    const params: Record<string, string | number | boolean | number[]> = scaleType === 'uniform'
      ? { scaleType, factor, refPoint }
      : { scaleType, factorX, factorY, factorZ, refPoint };
    const label = scaleType === 'uniform'
      ? `${factor}×`
      : `${factorX}×${factorY}×${factorZ}`;
    if (editing) {
      updateFeatureParams(editing.id, params);
      setStatusMessage(`Updated scale ${label}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Scale (${label})`,
        type: 'scale',
        params,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Solid scaled ${label}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Scale' : 'Scale'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Scale Type</label>
            <select value={scaleType} onChange={(e) => setScaleType(e.target.value as 'uniform' | 'non-uniform')}>
              <option value="uniform">Uniform</option>
              <option value="non-uniform">Non-Uniform</option>
            </select>
          </div>
          {scaleType === 'uniform' ? (
            <div className="form-group">
              <label>Scale Factor</label>
              <input type="number" value={factor}
                onChange={(e) => setFactor(Math.max(0.001, parseFloat(e.target.value) || 1))}
                step={0.1} min={0.001} />
            </div>
          ) : (
            <div className="settings-grid">
              <div className="form-group">
                <label>X Factor</label>
                <input type="number" value={factorX}
                  onChange={(e) => setFactorX(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
              <div className="form-group">
                <label>Y Factor</label>
                <input type="number" value={factorY}
                  onChange={(e) => setFactorY(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
              <div className="form-group">
                <label>Z Factor</label>
                <input type="number" value={factorZ}
                  onChange={(e) => setFactorZ(Math.max(0.001, parseFloat(e.target.value) || 1))}
                  step={0.1} min={0.001} />
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Reference Point</label>
            <select value={refPoint} onChange={(e) => setRefPoint(e.target.value as 'centroid' | 'origin')}>
              <option value="centroid">Body Centroid</option>
              <option value="origin">World Origin</option>
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

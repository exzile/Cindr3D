import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const addFeature = useCADStore((s) => s.addFeature);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const solidFeatures = features.filter((f) => f.type !== 'sketch' && f.type !== 'construction-plane' && f.type !== 'construction-axis');

  const [targetFeatureId, setTargetFeatureId] = useState(solidFeatures[0]?.id ?? '');
  const [color, setColor] = useState('#B0B8C0');
  const [opacity, setOpacity] = useState(1);
  const [metalness, setMetalness] = useState(0.5);
  const [roughness, setRoughness] = useState(0.4);
  const [scope, setScope] = useState<'body' | 'face'>('body');

  const handleApply = () => {
    const feature: Feature = {
      id: crypto.randomUUID(),
      name: `Appearance (${color})`,
      type: 'import',
      params: { isAppearance: true, targetFeatureId, color, opacity, metalness, roughness, scope },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    addFeature(feature);
    setStatusMessage(`Applied appearance to ${scope}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Appearance</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Body</label>
            <select value={targetFeatureId} onChange={(e) => setTargetFeatureId(e.target.value)}>
              {solidFeatures.length === 0
                ? <option value="">— no bodies —</option>
                : solidFeatures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)
              }
            </select>
          </div>
          <div className="form-group">
            <label>Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Opacity (0–1)</label>
            <input
              type="number"
              value={opacity}
              onChange={(e) => setOpacity(Math.min(1, Math.max(0, parseFloat(e.target.value) || 1)))}
              step={0.05}
              min={0}
              max={1}
            />
          </div>
          <div className="form-group">
            <label>Metalness (0–1)</label>
            <input
              type="number"
              value={metalness}
              onChange={(e) => setMetalness(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
              step={0.05}
              min={0}
              max={1}
            />
          </div>
          <div className="form-group">
            <label>Roughness (0–1)</label>
            <input
              type="number"
              value={roughness}
              onChange={(e) => setRoughness(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
              step={0.05}
              min={0}
              max={1}
            />
          </div>
          <div className="form-group">
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'body' | 'face')}>
              <option value="body">Body</option>
              <option value="face">Face</option>
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

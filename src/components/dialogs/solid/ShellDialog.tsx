import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function ShellDialog({ onClose }: { onClose: () => void }) {
  // D186: pre-fill from feature being edited
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [thickness, setThickness] = useState(Number(p.thickness ?? 2));
  const [direction, setDirection] = useState<'inside' | 'outside' | 'both'>((p.direction as 'inside' | 'outside' | 'both') ?? 'inside');
  const [tangentChain, setTangentChain] = useState(p.tangentChain !== false);
  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { thickness, direction, tangentChain });
      setStatusMessage(`Updated shell (${thickness}mm ${direction})`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Shell (${thickness}mm ${direction})`,
        type: 'shell',
        params: { thickness, direction, tangentChain, removeFaces: '' },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${direction} shell with ${thickness}mm thickness`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Shell' : 'Shell'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'inside' | 'outside' | 'both')}>
              <option value="inside">Inside</option>
              <option value="outside">Outside</option>
              <option value="both">Both Sides</option>
            </select>
          </div>
          <div className="form-group">
            <label>Thickness (mm)</label>
            <input type="number" value={thickness} onChange={(e) => setThickness(parseFloat(e.target.value) || 2)} step={0.5} min={0.1} />
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={tangentChain} onChange={(e) => setTangentChain(e.target.checked)} />
            Tangent Chain face selection
          </label>
          <p className="dialog-hint">Select faces to remove in the viewport, or leave empty to shell all faces.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

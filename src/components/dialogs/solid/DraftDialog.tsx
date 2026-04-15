import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function DraftDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const [draftType, setDraftType] = useState<'fixed-plane' | 'parting-line'>((p.draftType as 'fixed-plane' | 'parting-line') ?? 'fixed-plane');
  const [angle, setAngle] = useState(Number(p.angle ?? 3));
  const [mode, setMode] = useState<'one-side' | 'two-side' | 'symmetric'>((p.mode as 'one-side' | 'two-side' | 'symmetric') ?? 'one-side');
  const [pullAxis, setPullAxis] = useState<'X' | 'Y' | 'Z'>((p.pullAxis as 'X' | 'Y' | 'Z') ?? 'Y');
  const [flipPull, setFlipPull] = useState(p.flipPull !== false && !!p.flipPull);

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const handleApply = () => {
    if (editing) {
      updateFeatureParams(editing.id, { draftType, angle, mode, pullAxis, flipPull });
      setStatusMessage(`Updated draft: ${angle}° (${mode})`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Draft (${angle}°)`,
        type: 'draft',
        params: { draftType, angle, mode, pullAxis, flipPull },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Draft applied: ${angle}° (${mode})`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Draft' : 'Draft'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Type</label>
            <select value={draftType} onChange={(e) => setDraftType(e.target.value as 'fixed-plane' | 'parting-line')}>
              <option value="fixed-plane">Fixed Plane</option>
              <option value="parting-line">Parting Line</option>
            </select>
          </div>
          <div className="form-group">
            <label>Pull Direction</label>
            <div className="direction-inputs" style={{ alignItems: 'center', gap: 8 }}>
              <select value={pullAxis} onChange={(e) => setPullAxis(e.target.value as 'X' | 'Y' | 'Z')}
                style={{ flex: 1 }}>
                <option value="X">+X Axis</option>
                <option value="Y">+Y Axis</option>
                <option value="Z">+Z Axis</option>
              </select>
              <label className="checkbox-label" style={{ margin: 0 }}>
                <input type="checkbox" checked={flipPull} onChange={(e) => setFlipPull(e.target.checked)} />
                Flip
              </label>
            </div>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Draft Angle (°)</label>
              <input type="number" value={angle}
                onChange={(e) => setAngle(Math.max(0.1, Math.min(89, parseFloat(e.target.value) || 3)))}
                step={0.5} min={0.1} max={89} />
            </div>
            <div className="form-group">
              <label>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'one-side' | 'two-side' | 'symmetric')}>
                <option value="one-side">One Side</option>
                <option value="two-side">Two Sides</option>
                <option value="symmetric">Symmetric</option>
              </select>
            </div>
          </div>
          <p className="dialog-hint">Select the face(s) to draft in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

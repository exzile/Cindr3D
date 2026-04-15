import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature, FeatureType } from '../../../types/cad';

export function EmbossDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState(String(p.profileId ?? ''));
  const [depth, setDepth] = useState(Number(p.depth ?? 1));
  const [direction, setDirection] = useState<'raise' | 'recess'>((p.direction as 'raise' | 'recess') ?? 'raise');
  const [angle, setAngle] = useState(Number(p.angle ?? 2));

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    if (editing) {
      updateFeatureParams(editing.id, { profileId, profileName: sketch?.name ?? '', depth, direction, angle, embossStyle: 'emboss' });
      setStatusMessage(`Updated ${direction} emboss: ${depth}mm`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Emboss (${direction}, ${depth}mm)`,
        type: 'rib' as FeatureType,
        params: { profileId, profileName: sketch?.name ?? '', depth, direction, angle, embossStyle: 'emboss' },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created ${direction} emboss: ${depth}mm`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Emboss' : 'Emboss'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Profile Sketch</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="" disabled>Select a sketch</option>
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="settings-grid">
            <div className="form-group">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'raise' | 'recess')}>
                <option value="raise">Raise</option>
                <option value="recess">Recess</option>
              </select>
            </div>
            <div className="form-group">
              <label>Depth (mm)</label>
              <input type="number" value={depth} onChange={(e) => setDepth(Math.max(0.01, parseFloat(e.target.value) || 1))} step={0.1} min={0.01} />
            </div>
          </div>
          <div className="form-group">
            <label>Draft Angle (deg)</label>
            <input type="number" value={angle} onChange={(e) => setAngle(parseFloat(e.target.value) || 0)} min={0} max={30} step={0.5} />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!profileId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

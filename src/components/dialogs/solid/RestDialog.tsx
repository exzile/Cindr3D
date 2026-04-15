import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature, FeatureType } from '../../../types/cad';

export function RestDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState(String(p.profileId ?? ''));
  const [depth, setDepth] = useState(Number(p.depth ?? 0));
  const [operation, setOperation] = useState<'join' | 'cut'>((p.operation as 'join' | 'cut') ?? 'join');

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    if (editing) {
      updateFeatureParams(editing.id, { profileId, profileName: sketch?.name ?? '', depth, operation, restStyle: 'rest' });
      setStatusMessage(`Updated rest feature from ${sketch?.name ?? 'profile'}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Rest (${sketch?.name ?? 'profile'})`,
        type: 'rib' as FeatureType,
        params: { profileId, profileName: sketch?.name ?? '', depth, operation, restStyle: 'rest' },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Created rest feature from ${sketch?.name ?? 'profile'}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Rest' : 'Rest'}</h3>
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
          <div className="form-group">
            <label>Depth (mm, 0 = flush)</label>
            <input type="number" value={depth} onChange={(e) => setDepth(parseFloat(e.target.value) || 0)} step={0.1} min={0} />
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'join' | 'cut')}>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
            </select>
          </div>
          <p className="dialog-hint">Creates a flat seating area on the solid body using the sketch profile boundary.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!profileId} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

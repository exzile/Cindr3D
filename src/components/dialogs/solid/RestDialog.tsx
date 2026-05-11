import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function RestDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const commitRest = useCADStore((s) => s.commitRest);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState(String(p.profileId ?? ''));
  const [width, setWidth] = useState(Number(p.width ?? 20));
  const [depth, setDepth] = useState(Number(p.depth ?? 20));
  const [thickness, setThickness] = useState(Number(p.thickness ?? 1));
  const [operation, setOperation] = useState<'join' | 'cut'>((p.operation as 'join' | 'cut') ?? 'join');

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    if (editing) {
      updateFeatureParams(editing.id, { profileId, profileName: sketch?.name ?? '', width, depth, thickness, operation, restStyle: 'rest' });
      setStatusMessage(`Updated rest feature`);
      onClose();
    } else {
      if (!profileId) { setStatusMessage('Rest: select a profile sketch'); return; }
      const normal = sketch?.planeNormal ?? { x: 0, y: 1, z: 0 };
      const origin = sketch?.planeOrigin ?? { x: 0, y: 0, z: 0 };
      commitRest({
        profileId,
        width, depth, thickness,
        normalX: normal.x, normalY: normal.y, normalZ: normal.z,
        centerX: origin.x, centerY: origin.y, centerZ: origin.z,
      });
      onClose();
    }
  };

  return (
    <DialogShell title={editing ? 'Edit Rest' : 'Rest'} onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!profileId && !editing}>
      <div className="form-group">
        <label>Profile Sketch</label>
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="" disabled>Select a sketch</option>
          {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Width (mm)</label>
          <input type="number" value={width} onChange={(e) => setWidth(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
        </div>
        <div className="form-group">
          <label>Depth (mm)</label>
          <input type="number" value={depth} onChange={(e) => setDepth(Math.max(0.1, parseFloat(e.target.value) || 20))} step={1} min={0.1} />
        </div>
      </div>
      <div className="form-group">
        <label>Thickness (mm)</label>
        <input type="number" value={thickness} onChange={(e) => setThickness(Math.max(0.01, parseFloat(e.target.value) || 1))} step={0.1} min={0.01} />
      </div>
      <div className="form-group">
        <label>Operation</label>
        <select value={operation} onChange={(e) => setOperation(e.target.value as 'join' | 'cut')}>
          <option value="join">Join</option>
          <option value="cut">Cut</option>
        </select>
      </div>
      <p className="dialog-hint">Creates a flat seating surface at the sketch plane origin.</p>
    </DialogShell>
  );
}

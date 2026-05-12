import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { Feature } from '../../../types/cad';

export function EmbossDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const sketches = useCADStore((s) => s.sketches);
  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitEmboss = useCADStore((s) => s.commitEmboss);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [profileId, setProfileId] = useState(String(p.profileId ?? ''));
  const [depth, setDepth] = useState(Number(p.depth ?? 1));
  const [style, setStyle] = useState<'emboss' | 'deboss'>((p.style as 'emboss' | 'deboss') ?? 'emboss');
  const [angle, setAngle] = useState(Number(p.angle ?? 2));

  const handleApply = () => {
    const sketch = sketches.find((s) => s.id === profileId);
    if (profileId && sketch) {
      if (editing) {
        updateFeatureParams(editing.id, { profileId, profileName: sketch.name, depth, style, angle, embossStyle: 'emboss' });
        commitEmboss(profileId, depth, style);
        setStatusMessage(`Updated ${style}: ${depth}mm`);
      } else {
        commitEmboss(profileId, depth, style);
        setStatusMessage(`Created ${style}: ${depth}mm`);
      }
    } else {
      // Stub with no geometry when no sketch available
      if (editing) {
        updateFeatureParams(editing.id, { profileId, profileName: sketch?.name ?? '', depth, style, angle, embossStyle: 'emboss' });
        setStatusMessage(`Updated ${style} emboss: ${depth}mm`);
      } else {
        const feature: Feature = {
          id: crypto.randomUUID(),
          name: `Emboss (${style}, ${depth}mm)`,
          type: 'emboss',
          params: { profileId, profileName: sketch?.name ?? '', depth, style, angle, embossStyle: 'emboss' },
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
        };
        addFeature(feature);
        setStatusMessage(`Created ${style} emboss: ${depth}mm`);
      }
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Emboss' : 'Emboss'} onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!profileId}>
      <div className="form-group">
        <label>Profile Sketch</label>
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
          <option value="" disabled>Select a sketch</option>
          {sketches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="settings-grid">
        <div className="form-group">
          <label>Style</label>
          <select value={style} onChange={(e) => setStyle(e.target.value as 'emboss' | 'deboss')}>
            <option value="emboss">Emboss (Raise)</option>
            <option value="deboss">Deboss (Recess)</option>
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
    </DialogShell>
  );
}

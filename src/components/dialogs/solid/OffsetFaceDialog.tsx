import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function OffsetFaceDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const bodyFeatures = features.filter((f) => !!f.mesh);

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitOffsetFace = useCADStore((s) => s.commitOffsetFace);

  const [selectedBodyId, setSelectedBodyId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [offsetDistance, setOffsetDistance] = useState(Number(p.offsetDistance ?? 1));
  const [direction, setDirection] = useState<'outward' | 'inward'>((p.direction as 'outward' | 'inward') ?? 'outward');
  const [extent, setExtent] = useState<'distance' | 'all'>((p.extent as 'distance' | 'all') ?? 'distance');

  const handleOK = () => {
    const signedDist = direction === 'inward' ? -Math.abs(offsetDistance) : Math.abs(offsetDistance);
    if (editing) {
      updateFeatureParams(editing.id, { offsetDistance, direction, extent, isOffsetFace: true, bodyId: selectedBodyId });
      if (selectedBodyId) commitOffsetFace(selectedBodyId, signedDist);
    } else if (selectedBodyId) {
      commitOffsetFace(selectedBodyId, signedDist);
    } else {
      const n = features.filter((f) => f.name.startsWith('Offset Face')).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Offset Face ${n}`,
        type: 'offset-face',
        params: { offsetDistance, direction, extent, isOffsetFace: true },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    onClose();
  };

  return (
    <DialogShell title={editing ? 'Edit Offset Face' : 'Offset Face'} onClose={onClose} onConfirm={handleOK}>
      <div className="dialog-field">
        <label className="dialog-label">Body</label>
        <select
          className="dialog-select"
          value={selectedBodyId}
          onChange={(e) => setSelectedBodyId(e.target.value)}
        >
          {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="dialog-field">
        <label className="dialog-label">Offset Distance (mm)</label>
        <input
          className="dialog-input"
          type="number"
          step={0.1}
          value={offsetDistance}
          onChange={(e) => setOffsetDistance(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="dialog-field">
        <label className="dialog-label">Direction</label>
        <select
          className="dialog-select"
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'outward' | 'inward')}
        >
          <option value="outward">Outward</option>
          <option value="inward">Inward</option>
        </select>
      </div>
      <div className="dialog-field">
        <label className="dialog-label">Extent</label>
        <select
          className="dialog-select"
          value={extent}
          onChange={(e) => setExtent(e.target.value as 'distance' | 'all')}
        >
          <option value="distance">Distance</option>
          <option value="all">All</option>
        </select>
      </div>
    </DialogShell>
  );
}

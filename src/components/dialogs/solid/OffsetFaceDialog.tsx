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
  const offsetFaceId = useCADStore((s) => s.offsetFaceId);
  const offsetOccFaceId = useCADStore((s) => s.offsetOccFaceId);
  const offsetFaceIds = useCADStore((s) => s.offsetFaceIds);
  const offsetFaceOccPairs = useCADStore((s) => s.offsetFaceOccPairs);
  const clearOffsetFace = useCADStore((s) => s.clearOffsetFace);
  const removeOffsetFace = useCADStore((s) => s.removeOffsetFace);

  const [selectedBodyId, setSelectedBodyId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [offsetDistance, setOffsetDistance] = useState(Number(p.offsetDistance ?? 1));
  const [direction, setDirection] = useState<'outward' | 'inward'>((p.direction as 'outward' | 'inward') ?? 'outward');

  const handleOK = () => {
    const signedDist = direction === 'inward' ? -Math.abs(offsetDistance) : Math.abs(offsetDistance);
    // Prefer accumulated set; fall back to legacy single pick for backward compat
    const faceIds =
      offsetFaceOccPairs.length > 0
        ? offsetFaceOccPairs.map((pair) => pair.faceId)
        : offsetOccFaceId !== null
          ? [offsetOccFaceId]
          : [];
    if (editing) {
      updateFeatureParams(editing.id, { offsetDistance, direction, isOffsetFace: true, bodyId: selectedBodyId, offsetFaceIds: faceIds });
      if (selectedBodyId) commitOffsetFace(selectedBodyId, signedDist, { faceIds });
    } else if (selectedBodyId) {
      commitOffsetFace(selectedBodyId, signedDist, { faceIds });
    } else {
      const n = features.filter((f) => f.name.startsWith('Offset Face')).length + 1;
      addFeature({
        id: crypto.randomUUID(),
        name: `Offset Face ${n}`,
        type: 'offset-face',
        params: { offsetDistance, direction, isOffsetFace: true },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      });
    }
    clearOffsetFace();
    onClose();
  };

  const faceCount = offsetFaceIds.length > 0 ? offsetFaceIds.length : (offsetFaceId ? 1 : 0);

  return (
    <DialogShell
      title={editing ? 'Edit Offset Face' : 'Offset Face'}
      onClose={onClose}
      size="sm"
      onConfirm={handleOK}
    >
      <div className="dialog-field">
        <label className="dialog-label">Body</label>
        <select
          className="dialog-select"
          value={selectedBodyId}
          onChange={(e) => setSelectedBodyId(e.target.value)}
        >
          {bodyFeatures.length === 0 && <option value="">No bodies</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <div className="dialog-field">
        <label className="dialog-label">
          Face
          {faceCount > 0 && (
            <button
              type="button"
              className="face-selector__clear face-selector__clear--inline"
              onClick={clearOffsetFace}
              aria-label="Clear selected faces"
            >
              Clear All
            </button>
          )}
        </label>
        <div className="face-selector">
          {faceCount === 0 ? (
            <span className="face-selector__chip">Click a face in the viewport</span>
          ) : offsetFaceIds.length > 0 ? (
            <>
              <span className="face-selector__chip">{faceCount} {faceCount === 1 ? 'face' : 'faces'} selected</span>
              {offsetFaceIds.map((id, idx) => (
                <span key={id} className="face-selector__chip face-selector__chip--removable">
                  Face {idx + 1}
                  <button
                    type="button"
                    className="face-selector__remove"
                    onClick={() => removeOffsetFace(id)}
                    aria-label={`Remove face ${idx + 1}`}
                  >
                    x
                  </button>
                </span>
              ))}
            </>
          ) : (
            <span className="face-selector__chip">1 face selected</span>
          )}
        </div>
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
    </DialogShell>
  );
}

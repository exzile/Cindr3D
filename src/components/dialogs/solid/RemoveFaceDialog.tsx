import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function RemoveFaceDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const removeFaceCount = features.filter((f) => f.type === 'split-body' && f.name.startsWith('Remove Face')).length;

  const [selectedId, setSelectedId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [faceDescription, setFaceDescription] = useState(String(p.faceDescription ?? 'Top'));
  const [keepShape, setKeepShape] = useState(p.keepShape !== false);

  const handleApply = () => {
    if (!selectedId) {
      setStatusMessage('Remove Face: no body selected');
      return;
    }
    if (editing) {
      updateFeatureParams(editing.id, { bodyId: selectedId, faceDescription, keepShape });
      setStatusMessage(`Updated Remove Face: "${faceDescription}" face on ${features.find((f) => f.id === selectedId)?.name ?? selectedId}`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Remove Face ${removeFaceCount + 1}`,
        type: 'split-body',
        params: { bodyId: selectedId, faceDescription, keepShape },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Remove Face applied: "${faceDescription}" face on ${features.find((f) => f.id === selectedId)?.name ?? selectedId}`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Remove Face' : 'Remove Face'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Body</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Face Description</label>
            <input
              type="text"
              value={faceDescription}
              onChange={(e) => setFaceDescription(e.target.value)}
              placeholder="e.g. Top, Bottom, Front, Back, Left, Right"
            />
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={keepShape}
                onChange={(e) => setKeepShape(e.target.checked)}
              />
              Keep Shape (extend adjacent faces)
            </label>
          </div>
          <p className="dialog-hint">Removes the specified face and extends adjacent faces to close the gap.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

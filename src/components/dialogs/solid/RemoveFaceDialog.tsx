import { useState } from 'react';
import * as THREE from 'three';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import '../FeatureDialogExtras.css';

export function RemoveFaceDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const commitRemoveFace = useCADStore((s) => s.commitRemoveFace);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  // SOL-I5: face picker state
  const removeFaceFaceId = useCADStore((s) => s.removeFaceFaceId);
  const removeFaceFaceNormal = useCADStore((s) => s.removeFaceFaceNormal);
  const removeFaceFaceCentroid = useCADStore((s) => s.removeFaceFaceCentroid);
  const clearRemoveFaceFace = useCADStore((s) => s.clearRemoveFaceFace);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [keepShape, setKeepShape] = useState(p.keepShape !== false);

  const canApply = !!selectedId && !!removeFaceFaceId;

  const handleApply = () => {
    if (!canApply || !removeFaceFaceNormal || !removeFaceFaceCentroid) {
      setStatusMessage('Remove Face: select a body and click a face in the viewport');
      return;
    }

    const faceNormal = new THREE.Vector3(...removeFaceFaceNormal);
    const faceCentroid = new THREE.Vector3(...removeFaceFaceCentroid);

    if (editing) {
      updateFeatureParams(editing.id, { bodyId: selectedId, keepShape });
      commitRemoveFace(selectedId, faceNormal, faceCentroid);
      setStatusMessage('Updated Remove Face');
    } else {
      commitRemoveFace(selectedId, faceNormal, faceCentroid);
      setStatusMessage(`Remove Face applied on ${features.find((f) => f.id === selectedId)?.name ?? selectedId}`);
    }
    clearRemoveFaceFace();
    onClose();
  };

  const handleClose = () => {
    clearRemoveFaceFace();
    onClose();
  };

  return (
    <DialogShell
      title={editing ? 'Edit Remove Face' : 'Remove Face'}
      onClose={handleClose}
      size="sm"
      overlayClassName="dialog-overlay--passthrough"
      onConfirm={handleApply}
      confirmDisabled={!canApply}
    >
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
        <label>Face to Remove</label>
        {removeFaceFaceId ? (
          <div className="face-selector">
            <span className="face-selector__chip">
              1 face selected
              <button
                type="button"
                className="face-selector__chip-clear"
                onClick={clearRemoveFaceFace}
                title="Clear face selection"
              >
                <X size={11} />
              </button>
            </span>
          </div>
        ) : (
          <p className="dialog-hint">Click a face in the viewport to select it.</p>
        )}
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={keepShape}
          onChange={(e) => setKeepShape(e.target.checked)}
        />
        Keep Shape (extend adjacent faces)
      </label>
      <p className="dialog-hint">Removes the selected face and extends adjacent faces to close the gap.</p>
    </DialogShell>
  );
}

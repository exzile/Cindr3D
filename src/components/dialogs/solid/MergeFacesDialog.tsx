import React, { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function MergeFacesDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const commitMergeFaces = useCADStore((s) => s.commitMergeFaces);

  const bodyFeatures = features.filter((f) => {
    if (f.suppressed || !f.visible) return false;
    if (f.mesh) return true;
    if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'primitive') return true;
    return false;
  });

  const defaultId =
    selectedFeatureId && bodyFeatures.some((f) => f.id === selectedFeatureId)
      ? selectedFeatureId
      : (bodyFeatures[0]?.id ?? '');

  const [selectedBodyId, setSelectedBodyId] = useState(defaultId);

  const handleApply = () => {
    if (!selectedBodyId) return;
    commitMergeFaces(selectedBodyId);
    onClose();
  };

  return (
    <DialogShell
      title="Merge Faces"
      onClose={onClose}
      size="sm"
      onConfirm={handleApply}
      confirmDisabled={!selectedBodyId}
    >
      <div className="form-group">
        <label>Body</label>
        <select
          value={selectedBodyId}
          onChange={(e) => setSelectedBodyId(e.target.value)}
        >
          {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
          {bodyFeatures.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <p className="dialog-hint">
        Merges adjacent coplanar or tangent faces into single faces, simplifying the body topology.
      </p>
    </DialogShell>
  );
}

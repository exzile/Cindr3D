import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';

export function SilhouetteSplitDialog({ onClose }: { onClose: () => void }) {
  const editingFeatureId = useCADStore((s) => s.editingFeatureId);
  const features = useCADStore((s) => s.features);
  const editing = editingFeatureId ? features.find((f) => f.id === editingFeatureId) : null;
  const p = editing?.params ?? {};

  const addFeature = useCADStore((s) => s.addFeature);
  const updateFeatureParams = useCADStore((s) => s.updateFeatureParams);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const splitCount = features.filter((f) => f.type === 'split-body' && f.name.startsWith('Silhouette Split')).length;

  // direction is stored as array [1,0,0] / [0,1,0] / [0,0,1]; decode it for the select
  const storedDir = p.direction as number[] | undefined;
  const decodedDir: 'x' | 'y' | 'z' =
    storedDir && storedDir[0] === 1 ? 'x' :
    storedDir && storedDir[1] === 1 ? 'y' : 'z';

  const [selectedId, setSelectedId] = useState<string>(String(p.bodyId ?? bodyFeatures[0]?.id ?? ''));
  const [direction, setDirection] = useState<'x' | 'y' | 'z'>(decodedDir);
  const [operation, setOperation] = useState<'split-bodies' | 'new-body'>((p.operation as 'split-bodies' | 'new-body') ?? 'split-bodies');

  const handleApply = () => {
    if (!selectedId) {
      setStatusMessage('Silhouette Split: no body selected');
      return;
    }
    const dirVec = direction === 'x' ? [1, 0, 0] : direction === 'y' ? [0, 1, 0] : [0, 0, 1];
    if (editing) {
      updateFeatureParams(editing.id, { bodyId: selectedId, direction: dirVec, operation });
      setStatusMessage(`Updated Silhouette Split along ${direction.toUpperCase()} axis`);
    } else {
      const feature: Feature = {
        id: crypto.randomUUID(),
        name: `Silhouette Split ${splitCount + 1}`,
        type: 'split-body',
        params: { bodyId: selectedId, direction: dirVec, operation },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
      };
      addFeature(feature);
      setStatusMessage(`Silhouette Split created along ${direction.toUpperCase()} axis`);
    }
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>{editing ? 'Edit Silhouette Split' : 'Silhouette Split'}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Body to Split</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Silhouette Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'x' | 'y' | 'z')}>
              <option value="x">Along X</option>
              <option value="y">Along Y</option>
              <option value="z">Along Z</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'split-bodies' | 'new-body')}>
              <option value="split-bodies">Split Bodies</option>
              <option value="new-body">New Body</option>
            </select>
          </div>
          <p className="dialog-hint">Splits a body at its silhouette edges as seen from the chosen direction.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

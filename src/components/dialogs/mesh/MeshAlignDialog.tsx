import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshAlignDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitMeshAlign = useCADStore((s) => s.commitMeshAlign);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [sourceId, setSourceId] = useState<string>(bodyFeatures[0]?.id ?? '');
  const [targetId, setTargetId] = useState<string>(bodyFeatures[1]?.id ?? bodyFeatures[0]?.id ?? '');

  const handleOK = () => {
    if (!sourceId || !targetId) {
      setStatusMessage('Mesh Align: source and target bodies required');
      return;
    }
    if (sourceId === targetId) {
      setStatusMessage('Mesh Align: source and target must be different');
      return;
    }
    commitMeshAlign(sourceId, targetId);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Mesh Align</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Source Body (to move)</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Target Body (align to)</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <p className="dialog-hint">Translates the source body so its centroid matches the target body's centroid.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!sourceId || !targetId}>OK</button>
        </div>
      </div>
    </div>
  );
}

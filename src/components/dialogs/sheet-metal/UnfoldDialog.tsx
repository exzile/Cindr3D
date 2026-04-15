import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function UnfoldDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitUnfold = useCADStore((s) => s.commitUnfold);
  const closeUnfoldDialog = useCADStore((s) => s.closeUnfoldDialog);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(bodyFeatures[0]?.id ?? '');

  const handleClose = () => { closeUnfoldDialog(); onClose(); };

  const handleOK = () => {
    if (!selectedId) {
      setStatusMessage('Unfold: no body selected');
      return;
    }
    commitUnfold(selectedId);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Unfold</h3>
          <button className="dialog-close" onClick={handleClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Sheet Metal Body</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {bodyFeatures.length === 0 && <option value="">— no bodies —</option>}
              {bodyFeatures.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <p className="dialog-hint">Projects all vertices onto the XZ plane (Y=0), approximating the unfolded flat layout.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

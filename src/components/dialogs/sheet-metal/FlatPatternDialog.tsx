import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function FlatPatternDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const commitFlatPattern = useCADStore((s) => s.commitFlatPattern);
  const closeFlatPatternDialog = useCADStore((s) => s.closeFlatPatternDialog);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const bodyFeatures = features.filter((f) => !!f.mesh);
  const [selectedId, setSelectedId] = useState<string>(bodyFeatures[0]?.id ?? '');

  const handleClose = () => { closeFlatPatternDialog(); onClose(); };

  const handleOK = () => {
    if (!selectedId) {
      setStatusMessage('Flat Pattern: no body selected');
      return;
    }
    commitFlatPattern(selectedId);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Flat Pattern</h3>
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
          <p className="dialog-hint">Creates a new flat pattern body by unfolding the selected sheet metal body. The original body is preserved.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK} disabled={!selectedId}>OK</button>
        </div>
      </div>
    </div>
  );
}

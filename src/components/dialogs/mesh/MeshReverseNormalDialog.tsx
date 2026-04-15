import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshReverseNormalDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [mode, setMode] = useState<'All Faces' | 'Selected Faces'>('All Faces');
  const [invertAll, setInvertAll] = useState(false);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Reverse Normal')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Reverse Normal ${n}`,
      type: 'import',
      params: { isMeshReverseNormal: true, mode, invertAll },
      bodyKind: 'mesh',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Mesh Reverse Normal</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="All Faces">All Faces</option>
              <option value="Selected Faces">Selected Faces</option>
            </select>
          </div>
          <div className="form-group form-group-inline">
            <label>Invert All</label>
            <input
              type="checkbox"
              checked={invertAll}
              onChange={(e) => setInvertAll(e.target.checked)}
            />
          </div>
          <p className="dialog-hint">Flips the normals on the selected mesh faces.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

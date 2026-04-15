import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function EraseAndFillDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [faceRegion, setFaceRegion] = useState('');
  const [fillType, setFillType] = useState<'Flat' | 'Curved' | 'Smooth'>('Flat');

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Erase And Fill')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Erase And Fill ${n}`,
      type: 'import',
      params: { isEraseAndFill: true, faceRegion, fillType },
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
          <span className="dialog-title">Erase And Fill</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Face Region</label>
            <input
              type="text"
              placeholder="Describe or click the region"
              value={faceRegion}
              onChange={(e) => setFaceRegion(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Fill Type</label>
            <select value={fillType} onChange={(e) => setFillType(e.target.value as typeof fillType)}>
              <option value="Flat">Flat</option>
              <option value="Curved">Curved</option>
              <option value="Smooth">Smooth</option>
            </select>
          </div>
          <p className="dialog-hint">Deletes the selected face group and rebuilds a patch over the hole.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

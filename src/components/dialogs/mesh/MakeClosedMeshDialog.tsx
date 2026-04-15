import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MakeClosedMeshDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [fillHoles, setFillHoles] = useState(true);
  const [fixNormals, setFixNormals] = useState(true);
  const [fillType, setFillType] = useState<'Flat' | 'Smooth'>('Flat');

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Closed Mesh')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Closed Mesh ${n}`,
      type: 'import',
      params: { isMakeClosedMesh: true, fillHoles, fixNormals, fillType },
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
          <span className="dialog-title">Make Closed Mesh</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group form-group-inline">
            <label>Fill Holes</label>
            <input
              type="checkbox"
              checked={fillHoles}
              onChange={(e) => setFillHoles(e.target.checked)}
            />
          </div>
          <div className="form-group form-group-inline">
            <label>Fix Normals</label>
            <input
              type="checkbox"
              checked={fixNormals}
              onChange={(e) => setFixNormals(e.target.checked)}
            />
          </div>
          <div className="form-group">
            <label>Fill Type</label>
            <select value={fillType} onChange={(e) => setFillType(e.target.value as typeof fillType)}>
              <option value="Flat">Flat</option>
              <option value="Smooth">Smooth</option>
            </select>
          </div>
          <p className="dialog-hint">Fills holes and fixes normals to produce a watertight mesh.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

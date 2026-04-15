import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshAlignDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [targetPlane, setTargetPlane] = useState<'XY' | 'XZ' | 'YZ' | 'Custom'>('XY');
  const [alignmentPoint, setAlignmentPoint] = useState<'Origin' | 'Centroid' | 'Custom'>('Origin');
  const [fixRotation, setFixRotation] = useState(false);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Mesh Align')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Mesh Align ${n}`,
      type: 'import',
      params: { isMeshAlign: true, targetPlane, alignmentPoint, fixRotation },
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
          <span className="dialog-title">Mesh Align</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Target Plane</label>
            <select value={targetPlane} onChange={(e) => setTargetPlane(e.target.value as typeof targetPlane)}>
              <option value="XY">XY</option>
              <option value="XZ">XZ</option>
              <option value="YZ">YZ</option>
              <option value="Custom">Custom</option>
            </select>
          </div>
          <div className="form-group">
            <label>Alignment Point</label>
            <select value={alignmentPoint} onChange={(e) => setAlignmentPoint(e.target.value as typeof alignmentPoint)}>
              <option value="Origin">Origin</option>
              <option value="Centroid">Centroid</option>
              <option value="Custom">Custom</option>
            </select>
          </div>
          <div className="form-group form-group-inline">
            <label>Fix Rotation</label>
            <input
              type="checkbox"
              checked={fixRotation}
              onChange={(e) => setFixRotation(e.target.checked)}
            />
          </div>
          <p className="dialog-hint">Aligns a mesh face to the specified target plane.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

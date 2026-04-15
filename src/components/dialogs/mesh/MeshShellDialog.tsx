import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshShellDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [thickness, setThickness] = useState(2);
  const [direction, setDirection] = useState<'Inside' | 'Outside'>('Inside');
  const [openFaces, setOpenFaces] = useState('');

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Mesh Shell')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Mesh Shell ${n}`,
      type: 'import',
      params: { isMeshShell: true, thickness, direction, openFaces },
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
          <span className="dialog-title">Mesh Shell</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Thickness (0.5–50 mm)</label>
            <input
              type="number"
              min={0.5}
              max={50}
              step={0.5}
              value={thickness}
              onChange={(e) => setThickness(Math.min(50, Math.max(0.5, parseFloat(e.target.value) || 2)))}
            />
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="Inside">Inside</option>
              <option value="Outside">Outside</option>
            </select>
          </div>
          <div className="form-group">
            <label>Open Faces</label>
            <input
              type="text"
              placeholder="None"
              value={openFaces}
              onChange={(e) => setOpenFaces(e.target.value)}
            />
          </div>
          <p className="dialog-hint">Hollows the interior of the mesh body to the specified wall thickness.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshSmoothDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [iterations, setIterations] = useState(5);
  const [strength, setStrength] = useState(0.5);
  const [preserveBoundary, setPreserveBoundary] = useState(true);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Mesh Smooth')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Mesh Smooth ${n}`,
      type: 'import',
      params: { isMeshSmooth: true, iterations, strength, preserveBoundary },
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
          <span className="dialog-title">Mesh Smooth</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Iterations (1–20)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={iterations}
              onChange={(e) => setIterations(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5)))}
            />
          </div>
          <div className="form-group">
            <label>Strength: {strength.toFixed(1)}</label>
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.1}
              value={strength}
              onChange={(e) => setStrength(parseFloat(e.target.value))}
            />
          </div>
          <div className="form-group form-group-inline">
            <label>Preserve Boundary</label>
            <input
              type="checkbox"
              checked={preserveBoundary}
              onChange={(e) => setPreserveBoundary(e.target.checked)}
            />
          </div>
          <p className="dialog-hint">Applies Laplacian smoothing to soften rough or creased regions.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

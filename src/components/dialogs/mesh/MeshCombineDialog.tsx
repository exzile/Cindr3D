import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function MeshCombineDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);
  const [operation, setOperation] = useState<'Union' | 'Subtract' | 'Intersect'>('Union');
  const [toolBody, setToolBody] = useState('');
  const [keepTool, setKeepTool] = useState(false);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Mesh Combine')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Mesh Combine ${n}`,
      type: 'import',
      params: { isMeshCombine: true, operation, toolBody, keepTool },
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
          <span className="dialog-title">Mesh Combine</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)}>
              <option value="Union">Union</option>
              <option value="Subtract">Subtract</option>
              <option value="Intersect">Intersect</option>
            </select>
          </div>
          <div className="form-group">
            <label>Tool Body</label>
            <input
              type="text"
              placeholder="Select mesh body"
              value={toolBody}
              onChange={(e) => setToolBody(e.target.value)}
            />
          </div>
          <div className="form-group form-group-inline">
            <label>Keep Tool Body</label>
            <input
              type="checkbox"
              checked={keepTool}
              onChange={(e) => setKeepTool(e.target.checked)}
            />
          </div>
          <p className="dialog-hint">Performs a boolean operation between two mesh bodies.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

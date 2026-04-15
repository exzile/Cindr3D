import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function SurfaceExtendDialog({ onClose }: { onClose: () => void }) {
  const commitSurfaceExtend = useCADStore((s) => s.commitSurfaceExtend);

  const [extendDistance, setExtendDistance] = useState(5);
  const [extensionType, setExtensionType] = useState<'natural' | 'linear' | 'curvature'>('natural');
  const [merge, setMerge] = useState(true);

  const handleOK = () => {
    commitSurfaceExtend({ extendDistance, extensionType, merge });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Surface Extend</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Distance (mm)</label>
            <input type="number" value={extendDistance} onChange={(e) => setExtendDistance(parseFloat(e.target.value) || 5)} step={0.5} min={0.01} />
          </div>
          <div className="form-group">
            <label>Extension Type</label>
            <select value={extensionType} onChange={(e) => setExtensionType(e.target.value as 'natural' | 'linear' | 'curvature')}>
              <option value="natural">Natural</option>
              <option value="linear">Linear</option>
              <option value="curvature">Curvature</option>
            </select>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge with adjacent faces
          </label>
          <p className="dialog-hint">Select the edge(s) to extend in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

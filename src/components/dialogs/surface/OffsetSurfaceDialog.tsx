import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function OffsetSurfaceDialog({ onClose }: { onClose: () => void }) {
  const commitOffsetSurface = useCADStore((s) => s.commitOffsetSurface);

  const [distance, setDistance] = useState(1);
  const [direction, setDirection] = useState<'outward' | 'inward' | 'both'>('outward');
  const [operation, setOperation] = useState<'new-body' | 'join'>('new-body');

  const handleOK = () => {
    commitOffsetSurface({ offsetDistance: distance, direction, operation });
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Offset Surface</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Distance (mm)</label>
            <input type="number" value={distance} onChange={(e) => setDistance(parseFloat(e.target.value) || 1)} step={0.5} min={0.01} />
          </div>
          <div className="form-group">
            <label>Direction</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'outward' | 'inward' | 'both')}>
              <option value="outward">Outward</option>
              <option value="inward">Inward</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="form-group">
            <label>Operation</label>
            <select value={operation} onChange={(e) => setOperation(e.target.value as 'new-body' | 'join')}>
              <option value="new-body">New Body</option>
              <option value="join">Join</option>
            </select>
          </div>
          <p className="dialog-hint">Select the surface face(s) to offset in the viewport.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}

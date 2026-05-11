import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Offset Surface" onClose={onClose} size="sm" onConfirm={handleOK}>
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
    </DialogShell>
  );
}

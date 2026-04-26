import { useState } from 'react';
import { X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';

export function RenameSketchDialog({ sketchId, onClose }: { sketchId: string | null; onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const renameSketch = useCADStore((s) => s.renameSketch);
  const sketch = sketches.find((s) => s.id === sketchId);
  const [draft, setDraft] = useState({ sketchId, name: sketch?.name ?? '' });
  const name = draft.sketchId === sketchId ? draft.name : sketch?.name ?? '';

  const handleApply = () => {
    if (!sketchId || !name.trim()) return;
    renameSketch(sketchId, name.trim());
    onClose();
  };

  if (!sketch) return null;

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Rename Sketch</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setDraft({ sketchId, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }} autoFocus />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={handleApply}>OK</button>
        </div>
      </div>
    </div>
  );
}

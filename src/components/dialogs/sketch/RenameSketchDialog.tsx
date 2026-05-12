import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Rename Sketch" onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!name.trim()}>
      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setDraft({ sketchId, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }} autoFocus />
      </div>
    </DialogShell>
  );
}

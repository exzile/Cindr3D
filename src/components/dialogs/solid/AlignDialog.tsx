import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function AlignDialog({ onClose }: { onClose: () => void }) {
  const addFeature = useCADStore((s) => s.addFeature);
  const features = useCADStore((s) => s.features);

  const [moveType, setMoveType] = useState<'align' | 'translate' | 'rotate'>('align');
  const [flip, setFlip] = useState(false);
  const [allowRotation, setAllowRotation] = useState(false);

  const handleOK = () => {
    const n = features.filter((f) => f.name.startsWith('Align')).length + 1;
    addFeature({
      id: crypto.randomUUID(),
      name: `Align ${n}`,
      type: 'scale',
      params: { moveType, flip, allowRotation, isAlign: true },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <DialogShell title="Align" onClose={onClose} onConfirm={handleOK}>
      <div className="dialog-field">
        <label className="dialog-label">Move Type</label>
        <select
          className="dialog-select"
          value={moveType}
          onChange={(e) => setMoveType(e.target.value as 'align' | 'translate' | 'rotate')}
        >
          <option value="align">Align</option>
          <option value="translate">Translate</option>
          <option value="rotate">Rotate</option>
        </select>
      </div>
      <div className="dialog-field dialog-field-row">
        <label className="dialog-label">Flip</label>
        <input
          type="checkbox"
          checked={flip}
          onChange={(e) => setFlip(e.target.checked)}
        />
      </div>
      <div className="dialog-field dialog-field-row">
        <label className="dialog-label">Allow Rotation</label>
        <input
          type="checkbox"
          checked={allowRotation}
          onChange={(e) => setAllowRotation(e.target.checked)}
        />
      </div>
      <p className="dialog-note">
        Select geometry pairs in the viewport (coming soon)
      </p>
    </DialogShell>
  );
}

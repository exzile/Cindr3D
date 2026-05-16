import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';
import type { AlignGeomPick } from '../../../types/cad';

export function AlignDialog({ onClose }: { onClose: () => void }) {
  const features = useCADStore((s) => s.features);
  const alignPickStage = useCADStore((s) => s.alignPickStage);
  const alignPickKind = useCADStore((s) => s.alignPickKind);
  const alignSource = useCADStore((s) => s.alignSource);
  const alignTarget = useCADStore((s) => s.alignTarget);
  const setAlignPickStage = useCADStore((s) => s.setAlignPickStage);
  const setAlignPickKind = useCADStore((s) => s.setAlignPickKind);
  const resetAlign = useCADStore((s) => s.resetAlign);
  const commitAlign = useCADStore((s) => s.commitAlign);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const [moveType, setMoveType] = useState<'align' | 'translate' | 'rotate'>('align');
  const [flip, setFlip] = useState(false);
  const [allowRotation, setAllowRotation] = useState(true);

  const describe = (pick: AlignGeomPick | null): string => {
    if (!pick) return 'none';
    const name = features.find((f) => f.id === pick.featureId)?.name ?? 'body';
    const [x, y, z] = pick.point;
    return `${pick.kind} on ${name} (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
  };

  const close = () => {
    resetAlign();
    onClose();
  };

  const handleOK = () => {
    if (!alignSource || !alignTarget) {
      setStatusMessage('Align: pick a source and a target geometry first');
      return;
    }
    commitAlign({ moveType, flip, allowRotation });
    onClose();
  };

  const startPick = (stage: 'source' | 'target') => {
    setAlignPickStage(stage);
    setStatusMessage(
      `Align: click a ${alignPickKind} in the viewport for the ${stage} geometry`,
    );
  };

  return (
    <DialogShell title="Align" onClose={close} onConfirm={handleOK}>
      <div className="dialog-field">
        <label className="dialog-label">Geometry Type</label>
        <select
          className="dialog-select"
          value={alignPickKind}
          onChange={(e) => setAlignPickKind(e.target.value as 'face' | 'edge' | 'vertex')}
        >
          <option value="face">Face</option>
          <option value="edge">Edge</option>
          <option value="vertex">Vertex</option>
        </select>
      </div>

      <div className="dialog-field">
        <label className="dialog-label">Source</label>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 11, marginBottom: 4 }}
          onClick={() => startPick('source')}
          disabled={alignPickStage === 'source'}
        >
          {alignPickStage === 'source' ? 'Picking…' : alignSource ? '✓ Re-pick Source' : 'Pick Source'}
        </button>
        <p className="dialog-note">{describe(alignSource)}</p>
      </div>

      <div className="dialog-field">
        <label className="dialog-label">Target</label>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 11, marginBottom: 4 }}
          onClick={() => startPick('target')}
          disabled={alignPickStage === 'target'}
        >
          {alignPickStage === 'target' ? 'Picking…' : alignTarget ? '✓ Re-pick Target' : 'Pick Target'}
        </button>
        <p className="dialog-note">{describe(alignTarget)}</p>
      </div>

      <div className="dialog-field">
        <label className="dialog-label">Move Type</label>
        <select
          className="dialog-select"
          value={moveType}
          onChange={(e) => setMoveType(e.target.value as 'align' | 'translate' | 'rotate')}
        >
          <option value="align">Align (rotate + move)</option>
          <option value="translate">Translate only</option>
          <option value="rotate">Rotate only</option>
        </select>
      </div>

      <div className="dialog-field dialog-field-row">
        <label className="dialog-label">Flip</label>
        <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
      </div>
      <div className="dialog-field dialog-field-row">
        <label className="dialog-label">Allow Rotation</label>
        <input
          type="checkbox"
          checked={allowRotation}
          onChange={(e) => setAllowRotation(e.target.checked)}
        />
      </div>
    </DialogShell>
  );
}

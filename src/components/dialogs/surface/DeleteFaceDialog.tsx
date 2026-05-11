import { useState } from 'react';
import { DialogShell } from '../common/DialogShell';

export interface DeleteFaceParams {
  faceIds: string[];
  healMode: 'leave-open' | 'tangent-patch' | 'curvature-patch';
}

interface DeleteFaceDialogProps {
  open: boolean;
  faceCount: number;
  onOk: (params: DeleteFaceParams) => void;
  onClose: () => void;
}

export function DeleteFaceDialog({ open, faceCount, onOk, onClose }: DeleteFaceDialogProps) {
  const [healMode, setHealMode] = useState<'leave-open' | 'tangent-patch' | 'curvature-patch'>('leave-open');

  if (!open) return null;

  return (
    <DialogShell title="Delete Face" onClose={onClose} size="sm" onConfirm={() => onOk({ faceIds: [], healMode })} confirmDisabled={faceCount === 0}>
      <div className="form-group">
            <label>Selected Faces</label>
            <span className="dialog-info">
              {faceCount > 0 ? `${faceCount} face${faceCount !== 1 ? 's' : ''} selected` : 'Click faces in the viewport'}
            </span>
          </div>
          <div className="form-group">
            <label>Heal Mode</label>
            <select
              value={healMode}
              onChange={(e) => setHealMode(e.target.value as 'leave-open' | 'tangent-patch' | 'curvature-patch')}
            >
              <option value="leave-open">Leave Open</option>
              <option value="tangent-patch">Tangent Patch (G1)</option>
              <option value="curvature-patch">Curvature Patch (G2)</option>
            </select>
          </div>
          <p className="dialog-hint">Select one or more faces to remove. Use Heal Mode to patch the resulting hole.</p>
    </DialogShell>
  );
}

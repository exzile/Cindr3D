import { X } from 'lucide-react';
import { useState } from 'react';

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
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Delete Face</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
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
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={faceCount === 0}
            onClick={() => onOk({ faceIds: [], healMode })}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

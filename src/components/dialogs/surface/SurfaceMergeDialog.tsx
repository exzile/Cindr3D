import { X } from 'lucide-react';

export interface SurfaceMergeParams {
  face1Id: string | null;
  face2Id: string | null;
}

interface SurfaceMergeDialogProps {
  open: boolean;
  onOk: (params: SurfaceMergeParams) => void;
  onClose: () => void;
  face1Id?: string | null;
  face2Id?: string | null;
}

export function SurfaceMergeDialog({ open, onOk, onClose, face1Id = null, face2Id = null }: SurfaceMergeDialogProps) {
  if (!open) return null;

  const canCommit = face1Id !== null && face2Id !== null;

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Merge (Surface)</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Face 1</label>
            <span className="dialog-info">
              {face1Id ? `Face picked (${face1Id.slice(0, 8)}…)` : 'Click a face in the viewport'}
            </span>
          </div>
          <div className="form-group">
            <label>Face 2</label>
            <span className="dialog-info">
              {face2Id ? `Face picked (${face2Id.slice(0, 8)}…)` : 'Click a second face in the viewport'}
            </span>
          </div>
          <p className="dialog-hint">Pick two tangent or coincident surface faces to merge their shared edge.</p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canCommit}
            onClick={() => onOk({ face1Id, face2Id })}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

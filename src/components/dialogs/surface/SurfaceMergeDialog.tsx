import { DialogShell } from '../common/DialogShell';

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
    <DialogShell title="Merge (Surface)" onClose={onClose} size="sm" onConfirm={() => onOk({ face1Id, face2Id })} confirmDisabled={!canCommit}>
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
    </DialogShell>
  );
}

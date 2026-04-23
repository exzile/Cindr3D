import { Check, X } from 'lucide-react';

export function ActionRow({
  canCommit,
  cancelExtrudeTool,
  commitExtrude,
  editingFeatureId,
}: {
  canCommit: boolean;
  cancelExtrudeTool: () => void;
  commitExtrude: () => void;
  editingFeatureId: string | null;
}) {
  return (
    <div className="tp-actions">
      <button className="tp-btn tp-btn-cancel" onClick={cancelExtrudeTool}>
        <X size={13} /> Cancel
      </button>
      <button className="tp-btn tp-btn-ok" onClick={commitExtrude} disabled={!canCommit}>
        <Check size={13} /> {editingFeatureId ? 'Update' : 'OK'}
      </button>
    </div>
  );
}

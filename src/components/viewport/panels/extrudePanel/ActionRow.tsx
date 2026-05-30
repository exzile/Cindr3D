import { useState } from 'react';
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
  const [committing, setCommitting] = useState(false);

  const handleOk = () => {
    if (committing || !canCommit) return;
    setCommitting(true);
    // commitExtrude is async — wrap in Promise so we can clear the guard when
    // it finishes (covers early-return failure paths where the panel stays open).
    Promise.resolve(commitExtrude()).finally(() => setCommitting(false));
  };

  return (
    <div className="tp-actions">
      <button className="tp-btn tp-btn-cancel" onClick={cancelExtrudeTool} disabled={committing}>
        <X size={13} /> Cancel
      </button>
      <button className="tp-btn tp-btn-ok" onClick={handleOk} disabled={!canCommit || committing}>
        <Check size={13} /> {committing ? 'Working…' : editingFeatureId ? 'Update' : 'OK'}
      </button>
    </div>
  );
}

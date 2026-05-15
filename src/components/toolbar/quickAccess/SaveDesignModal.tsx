import { Save, X } from 'lucide-react';
import { useId } from 'react';

/**
 * Save-Design dialog. Caller owns the draft name and overwrite-prompt state
 * so the same modal can serve both "Save" and "Save As" entry points.
 */
export function SaveDesignModal({
  draft,
  overwritePrompt,
  currentDesignFile,
  featureCount,
  sketchCount,
  onDraftChange,
  onConfirm,
  onCancelOverwrite,
  onClose,
}: {
  draft: string;
  overwritePrompt: boolean;
  currentDesignFile: string | null;
  featureCount: number;
  sketchCount: number;
  onDraftChange: (next: string) => void;
  onConfirm: () => void;
  onCancelOverwrite: () => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const draftTrim = draft.trim();
  return (
    <div className="new-doc-overlay">
      <div className="save-modal">
        <div className="save-modal-header">
          <div className="save-modal-icon"><Save size={15} /></div>
          <div className="save-modal-title">Save Design</div>
          <button className="save-modal-close" onClick={onClose} title="Cancel" aria-label="Cancel save dialog">
            <X size={14} />
          </button>
        </div>

        <div className="save-modal-body">
          <div className="save-modal-field">
            <label className="save-modal-label" htmlFor={inputId}>File name</label>
            <div className="save-modal-input-row">
              <input
                id={inputId}
                type="text"
                autoFocus
                className="save-modal-input"
                value={draft}
                placeholder="design"
                spellCheck={false}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draftTrim) onConfirm();
                  if (e.key === 'Escape') onClose();
                }}
              />
              <span className="save-modal-ext">.dznd</span>
            </div>
            {currentDesignFile && draftTrim === currentDesignFile && (
              <div className="save-modal-hint save-modal-hint-warn">
                Saves over the currently open file
              </div>
            )}
            {!currentDesignFile && (
              <div className="save-modal-hint">
                Creates a new file in your Downloads folder
              </div>
            )}
          </div>

          <div className="save-modal-info">
            <div className="save-modal-info-row">
              <span className="save-modal-info-label">Format</span>
              <span className="save-modal-info-value">Cindr3D Design (.dznd)</span>
            </div>
            <div className="save-modal-info-row">
              <span className="save-modal-info-label">Content</span>
              <span className="save-modal-info-value">
                {featureCount} feature{featureCount !== 1 ? 's' : ''},&nbsp;
                {sketchCount} sketch{sketchCount !== 1 ? 'es' : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="save-modal-footer">
          {overwritePrompt ? (
            <>
              <span className="save-modal-overwrite-msg">
                Overwrite <strong>{draftTrim}.dznd</strong>?
              </span>
              <button className="save-modal-btn save-modal-btn-cancel" onClick={onCancelOverwrite}>
                No
              </button>
              <button className="save-modal-btn save-modal-btn-overwrite" onClick={onConfirm}>
                <Save size={13} /> Overwrite
              </button>
            </>
          ) : (
            <>
              <button className="save-modal-btn save-modal-btn-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                className="save-modal-btn save-modal-btn-save"
                disabled={!draftTrim}
                onClick={onConfirm}
              >
                <Save size={13} />
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

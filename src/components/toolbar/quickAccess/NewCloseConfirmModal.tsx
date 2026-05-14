/** Confirmation modal shared by File → New and File → Close. */
export function NewCloseConfirmModal({
  mode,
  hasContent,
  onSaveThenAct,
  onDiscardAndAct,
  onCancel,
}: {
  mode: 'new' | 'close';
  hasContent: boolean;
  onSaveThenAct: () => void;
  onDiscardAndAct: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="new-doc-overlay" onClick={onCancel}>
      <div className="new-doc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-doc-title">
          {mode === 'new' ? 'Start a new document?' : 'Close the current file?'}
        </div>
        <div className="new-doc-body">
          {mode === 'new'
            ? (hasContent
              ? 'You have unsaved work. Would you like to save before starting a new document?'
              : 'Start with a fresh workspace?')
            : (hasContent
              ? 'Would you like to save before closing? Closing will reset the workspace.'
              : 'This will reset the workspace to an empty document.')}
        </div>
        <div className="new-doc-actions">
          <button className="new-doc-btn new-doc-btn-save" onClick={onSaveThenAct}>
            {mode === 'new' ? 'Save & New' : 'Save & Close'}
          </button>
          <button className="new-doc-btn new-doc-btn-discard" onClick={onDiscardAndAct}>
            {mode === 'new' ? 'Discard & New' : 'Discard & Close'}
          </button>
          <button className="new-doc-btn new-doc-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

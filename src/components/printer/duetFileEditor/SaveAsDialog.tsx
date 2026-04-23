import { editorStyles } from './styles';

export function SaveAsDialog({
  onCancel,
  onConfirm,
  saveAsPath,
  setSaveAsPath,
}: {
  onCancel: () => void;
  onConfirm: (path: string) => void;
  saveAsPath: string;
  setSaveAsPath: (path: string) => void;
}) {
  return (
    <div style={editorStyles.saveAsOverlay} onClick={onCancel}>
      <div style={editorStyles.saveAsDialog} onClick={(event) => event.stopPropagation()}>
        <div style={editorStyles.saveAsTitle}>Save As</div>
        <input
          style={editorStyles.saveAsInput}
          value={saveAsPath}
          onChange={(event) => setSaveAsPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && saveAsPath.trim()) onConfirm(saveAsPath.trim());
            if (event.key === 'Escape') onCancel();
          }}
          autoFocus
          placeholder="Full file path (e.g. 0:/sys/config.g)"
        />
        <div style={editorStyles.saveAsBtns}>
          <button style={editorStyles.btn} onClick={onCancel}>
            Cancel
          </button>
          <button
            style={editorStyles.btnPrimary}
            onClick={() => saveAsPath.trim() && onConfirm(saveAsPath.trim())}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

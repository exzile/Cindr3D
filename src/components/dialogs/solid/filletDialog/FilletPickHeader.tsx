import type { FilletDialogState } from './useFilletDialogState';

interface FilletPickHeaderProps {
  selectedEdgeCount: number;
  dialog: FilletDialogState;
}

export function FilletPickHeader({ selectedEdgeCount, dialog }: FilletPickHeaderProps) {
  const { mode, filletPickMode, setFilletPickMode } = dialog;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <p className="dialog-hint" style={{ margin: 0 }}>
        {mode === 'full-round'
          ? selectedEdgeCount > 0 ? `${selectedEdgeCount} face edge(s) selected` : 'Click a face to select all its edges'
          : `${selectedEdgeCount} edge(s) selected`}
      </p>
      {mode !== 'full-round' && (
        <button
          style={{
            background: filletPickMode === 'face' ? '#5b9bd5' : 'none',
            border: '1px solid #555',
            borderRadius: 3,
            cursor: 'pointer',
            color: filletPickMode === 'face' ? '#fff' : '#aaa',
            padding: '2px 7px',
            fontSize: 11,
          }}
          onClick={() => setFilletPickMode(filletPickMode === 'face' ? 'edge' : 'face')}
          title={filletPickMode === 'face' ? 'Switch to edge picking' : 'Switch to face picking (selects all edges of a face)'}
        >
          {filletPickMode === 'face' ? 'Face' : 'Edge'}
        </button>
      )}
    </div>
  );
}


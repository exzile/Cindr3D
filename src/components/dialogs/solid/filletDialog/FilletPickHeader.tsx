import type { FilletDialogState } from './useFilletDialogState';

interface FilletPickHeaderProps {
  selectedEdgeCount: number;
  dialog: FilletDialogState;
}

export function FilletPickHeader({ selectedEdgeCount, dialog }: FilletPickHeaderProps) {
  const { mode } = dialog;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <p className="dialog-hint" style={{ margin: 0 }}>
        {mode === 'full-round'
          ? `${selectedEdgeCount} edge(s) selected for full-round fillet`
          : `${selectedEdgeCount} edge(s) selected`}
      </p>
    </div>
  );
}

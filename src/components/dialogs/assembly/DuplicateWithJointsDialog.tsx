import type { Component } from '../../../types/cad';
import { DialogShell } from '../common/DialogShell';

interface Props {
  open: boolean;
  component: Component | null;
  jointCount: number;
  onOk: () => void;
  onClose: () => void;
}

export function DuplicateWithJointsDialog({ open, component, jointCount, onOk, onClose }: Props) {
  if (!open || !component) return null;

  const handleOk = () => {
    onOk();
    onClose();
  };

  return (
    <DialogShell title="Duplicate With Joints" onClose={onClose} size="sm" onConfirm={handleOk} confirmLabel="Duplicate">
          <p style={{ margin: 0 }}>
            Duplicate <strong>{component.name}</strong>?
          </p>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>
            {jointCount > 0
              ? `This will also copy ${jointCount} associated joint${jointCount === 1 ? '' : 's'}.`
              : 'No joints are associated with this component.'}
          </p>
    </DialogShell>
  );
}

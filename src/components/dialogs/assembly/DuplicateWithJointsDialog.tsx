import { X } from 'lucide-react';
import type { Component } from '../../../types/cad';

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
    <div className="dialog-overlay">
      <div className="dialog dialog-sm">
        <div className="dialog-header">
          <h3>Duplicate With Joints</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            Duplicate <strong>{component.name}</strong>?
          </p>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>
            {jointCount > 0
              ? `This will also copy ${jointCount} associated joint${jointCount === 1 ? '' : 's'}.`
              : 'No joints are associated with this component.'}
          </p>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOk}>Duplicate</button>
        </div>
      </div>
    </div>
  );
}

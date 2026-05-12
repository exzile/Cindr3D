import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  size?: 'sm';
  className?: string;
  overlayClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function DialogShell({
  title,
  onClose,
  onConfirm,
  confirmLabel = 'OK',
  confirmDisabled = false,
  cancelLabel = 'Cancel',
  size,
  className,
  overlayClassName,
  footer,
  children,
}: Props) {
  const dialogClass = ['dialog', size && `dialog-${size}`, className]
    .filter(Boolean)
    .join(' ');
  const overlayClass = ['dialog-overlay', overlayClassName]
    .filter(Boolean)
    .join(' ');

  const defaultFooter = (
    <div className="dialog-footer">
      <button className="btn btn-secondary" onClick={onClose}>{cancelLabel}</button>
      {onConfirm && (
        <button
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      )}
    </div>
  );

  return (
    <div className={overlayClass}>
      <div className={dialogClass}>
        <div className="dialog-header">
          <h3>{title}</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          {children}
        </div>
        {footer !== undefined ? footer : defaultFooter}
      </div>
    </div>
  );
}

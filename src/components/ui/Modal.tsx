/**
 * Reusable modal shell.
 *
 * Centralises the createPortal + overlay + chrome + Escape-key handling
 * that every per-feature modal used to re-implement. Reuses the existing
 * `.bc-modal-*` CSS so the visual styling stays identical to the old
 * inline definitions.
 *
 * Body / footer regions are sub-components so callers can compose freely
 * without learning bespoke className strings.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

/**
 * Listen for Escape (always) and optionally Enter (when not in an editable
 * field). The Enter handler is skipped when the user is typing into an
 * input/textarea/contenteditable target so submit-on-Enter never fires
 * mid-edit.
 */
export function useModalKeys(onClose: () => void, onEnter?: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Enter' && onEnter && !isEditableTarget(e.target)) {
        e.preventDefault();
        onEnter();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onEnter]);
}

export type ModalSize = 'default' | 'wide' | 'md';

export function Modal({
  open = true,
  onClose,
  onEnter,
  title,
  titleIcon,
  trailingHeader,
  size = 'default',
  className,
  ariaLabelledBy,
  closeButtonTitle = 'Close',
  children,
}: {
  /** When false, nothing renders. Defaults to true — pass conditionally for show-controlled modals. */
  open?: boolean;
  onClose: () => void;
  /** Optional Enter-key handler (skipped while typing into an input/textarea). */
  onEnter?: () => void;
  title: ReactNode;
  /** Icon shown to the left of the title (lucide icon, etc.). */
  titleIcon?: ReactNode;
  /** Extra content rendered after the title (badges, pass counters). */
  trailingHeader?: ReactNode;
  size?: ModalSize;
  className?: string;
  ariaLabelledBy?: string;
  closeButtonTitle?: string;
  children: ReactNode;
}) {
  useModalKeys(onClose, onEnter);
  if (!open) return null;

  const sizeClass = size === 'wide' ? ' bc-modal--wide' : size === 'md' ? ' bc-modal--md' : '';
  const extra     = className ? ` ${className}` : '';

  return createPortal(
    <div className="bc-modal-overlay" onClick={onClose}>
      <div
        className={`bc-modal${sizeClass}${extra}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
      >
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            {titleIcon}
            <span id={ariaLabelledBy} className="bc-modal-title">{title}</span>
            {trailingHeader}
          </div>
          <button className="bc-modal-close" onClick={onClose} title={closeButtonTitle}>
            <X size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`bc-modal-body${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`bc-modal-footer${className ? ` ${className}` : ''}`}>{children}</div>;
}

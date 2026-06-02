import { useEffect } from 'react';

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

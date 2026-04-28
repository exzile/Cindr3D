import { useEffect } from 'react';

/**
 * Subscribes a global Escape-key listener that calls `onEscape` whenever
 * the user presses Esc. Pass `enabled = false` to skip the listener (e.g.
 * for menus that only need it while open).
 *
 * Replaces the repeated `useEffect` + `window.addEventListener('keydown')`
 * idiom that several modals and overlays were duplicating verbatim.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, enabled]);
}

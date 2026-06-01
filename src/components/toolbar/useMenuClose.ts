import { useState, useCallback, useRef, useEffect } from 'react';

export const MENU_CLOSE_MS = 120;

/**
 * Drives the closing animation for popup menus.
 * Call startClose(onDone) to add the .closing CSS class, wait for the animation,
 * then call onDone() (which should unmount the menu).
 */
export function useMenuClose() {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const startClose = useCallback((onDone: () => void) => {
    if (timerRef.current) return;
    setClosing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        setClosing(false);
        onDone();
      }
    }, MENU_CLOSE_MS);
  }, []);

  return { closing, startClose };
}

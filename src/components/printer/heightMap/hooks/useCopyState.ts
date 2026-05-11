/**
 * useCopyState — small hook for the "Copied!" affordance on a copy button.
 *
 * Sets `copied=true` and resets it after `resetMs`. The reset timer is
 * cancelled on unmount so a click immediately before unmount doesn't leak
 * a setState into a dead component.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useCopyState(resetMs = 1_800): {
  copied: boolean;
  flash: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flash = useCallback(() => {
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopied(false);
    }, resetMs);
  }, [resetMs]);

  return { copied, flash };
}

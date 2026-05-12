import { useState, useEffect } from 'react';

/**
 * Returns the current timestamp (ms), refreshed every `intervalMs`.
 * Pass `enabled = false` to pause the ticker (last value is held).
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

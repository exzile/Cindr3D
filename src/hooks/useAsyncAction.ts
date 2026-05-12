import { useCallback } from 'react';
import { errorMessage } from '../utils/errorHandling';

/**
 * Returns a stable `run` function that wraps an async callback with
 * setBusy(true/false) and optional error capture.
 *
 * Usage:
 *   const run = useAsyncAction(setBusy, setError);
 *   const handleSave = useCallback(() => run(async () => {
 *     await save();
 *     setDone(true);
 *   }), [run, save]);
 */
export function useAsyncAction(
  setBusy: (v: boolean) => void,
  setError?: ((msg: string | null) => void) | null,
  fallbackMessage = 'Operation failed',
) {
  return useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setError?.(null);
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        setError?.(errorMessage(err, fallbackMessage));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setBusy, setError],
  );
}

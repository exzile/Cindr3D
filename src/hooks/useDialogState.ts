import { useCADStore } from '../store/cadStore';

/**
 * Collapses the repeated 4-selector boilerplate for dialogs that follow the
 * show / params / confirm / close pattern:
 *
 *   const showXyz = useCADStore(s => s.showXyzDialog);
 *   const xyzParams = useCADStore(s => s.xyzParams);
 *   const commitXyz = useCADStore(s => s.commitXyz);
 *   const closeXyz = useCADStore(s => s.closeXyzDialog);
 *
 * Usage:
 *   const { show, params, confirm, close } = useDialogState(
 *     'showXyzDialog', 'xyzParams', 'commitXyz', 'closeXyzDialog',
 *   );
 *
 * Note: App.tsx currently uses an `activeDialog` string-dispatch pattern
 * rather than per-dialog boolean show flags, so this hook is applied only
 * to the subset of Connected components that store per-dialog selector state.
 * The remaining Connected wrappers have non-uniform signatures (extra selectors,
 * componentStore usage, inline callbacks) that don't map cleanly to the
 * show/params/confirm/close schema.
 */
export function useDialogState<K extends string>(
  showKey: K,
  paramsKey: string,
  confirmKey: string,
  closeKey: string,
) {
  const show = useCADStore(s => (s as unknown as Record<string, unknown>)[showKey] as boolean);
  const params = useCADStore(s => (s as unknown as Record<string, unknown>)[paramsKey]);
  const confirm = useCADStore(s => (s as unknown as Record<string, unknown>)[confirmKey] as (...args: unknown[]) => void);
  const close = useCADStore(s => (s as unknown as Record<string, unknown>)[closeKey] as () => void);
  return { show, params, confirm, close };
}

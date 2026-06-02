/**
 * freeWasmException — release a C++ exception that Emscripten surfaced to JS as
 * a numeric WASM-heap pointer.
 *
 * When OCC C++ code throws (e.g. BRepFilletAPI_MakeFillet.Build() on geometry it
 * cannot solve), the exception object is allocated on the WASM heap by __cxa_throw.
 * If JS catches that value and simply drops it, the heap entry is never reclaimed —
 * each failed call leaks a few hundred KB. A live-preview probe that re-runs the
 * failing build hundreds of times (as the Fillet validity probe did) leaks tens to
 * hundreds of MB and degrades every subsequent allocation.
 *
 * The caught value is the raw pointer (a number). We try the proper destructor path
 * (`___cxa_free_exception`) first, then fall back to `_free`. Both are best-effort:
 * binding names vary across Emscripten builds, so every access is guarded. Non-numeric
 * errors (ordinary JS Error objects from embind arity mismatches etc.) are ignored.
 *
 * IMPORTANT: read any message you need from the error BEFORE calling this — the
 * pointer is invalid afterwards.
 */
export function freeWasmException(oc: unknown, err: unknown): void {
  if (typeof err !== 'number') return;
  const m = oc as Record<string, unknown>;
  try {
    const free = m['___cxa_free_exception'] as ((n: number) => void) | undefined;
    if (typeof free === 'function') { free(err); return; }
  } catch { /* binding mismatch — fall through */ }
  try {
    const free = m['_free'] as ((n: number) => void) | undefined;
    if (typeof free === 'function') free(err);
  } catch { /* best-effort */ }
}

/** Extract a human-readable message from a thrown OCC error (numeric or Error). */
export function occErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof (err as { message?: unknown })?.message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

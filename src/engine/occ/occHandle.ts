/**
 * occHandle.ts — lightweight RAII wrapper for OCCT heap objects.
 *
 * OCCT objects allocated on the C++ heap via opencascade.js expose a
 * `.delete()` method for explicit cleanup. Without it the C++ heap leaks.
 *
 * OccHandle provides:
 *   1. Explicit `.dispose()` for deterministic cleanup.
 *   2. A FinalizationRegistry safety net so GC'd handles are freed even if
 *      the caller forgets to call dispose(). The registry lives at module
 *      scope so it survives HMR reloads.
 *
 * Usage:
 *   const shape = new oc.BRepPrimAPI_MakeBox_2(w, h, d).Shape();
 *   const handle = new OccHandle(shape.ptr, 'TopoDS_Shape', () => shape.delete());
 *   // ... use shape ...
 *   handle.dispose(); // or let GC call the registry callback
 */

type DisposeFn = () => void;

// Module-scoped so it survives HMR — not re-created on module reload.
const _registry = new FinalizationRegistry<DisposeFn>((dispose) => {
  try { dispose(); } catch { /* C++ object may already be freed */ }
});

export class OccHandle<_T = unknown> {
  readonly ptr: number;
  readonly type: string;
  readonly __type?: _T;
  private _dispose: DisposeFn | null;

  constructor(ptr: number, type: string, dispose: DisposeFn) {
    this.ptr = ptr;
    this.type = type;
    this._dispose = dispose;
    _registry.register(this, dispose, this);
  }

  dispose(): void {
    if (this._dispose === null) return;
    _registry.unregister(this);
    try { this._dispose(); } catch { /* already freed */ }
    this._dispose = null;
  }

  get isDisposed(): boolean {
    return this._dispose === null;
  }
}

/**
 * Wrap an OCCT object in an OccHandle.
 * `obj` must have `.ptr: number` and `.delete(): void` (standard opencascade.js shape).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function occWrap<_T>(obj: any, type: string): OccHandle<_T> {
  return new OccHandle<_T>(obj.ptr as number, type, () => obj.delete());
}

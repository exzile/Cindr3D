/**
 * Shared "an on-canvas drag gizmo is being manipulated" flag.
 *
 * On-canvas size gizmos (EdgeOpGizmo — fillet/chamfer distance arrow, and any
 * future drag handles) flip this true for the duration of a handle drag.
 *
 * R3F's `event.stopPropagation()` on a mesh pointer handler stops propagation
 * to OTHER R3F objects, but the underlying native pointer/click events still
 * reach the DOM listeners that drive global canvas interactions. Without a
 * guard, dragging a gizmo arrow also:
 *   - starts a window/lasso marquee selection (useWindowLassoSelection), and
 *   - picks an edge on the trailing synthetic `click` (useEdgePicker).
 *
 * Those consumers check {@link isGizmoDragging} and bail while a gizmo drag is
 * in progress. Same approach as ExtrudeTool's `_gizmoDragActive`, hoisted into
 * a shared module so it's tool-agnostic.
 */
let _gizmoDragging = false;
const _dragEndListeners = new Set<() => void>();

export function setGizmoDragging(v: boolean): void {
  _gizmoDragging = v;
  if (!v) _dragEndListeners.forEach((fn) => fn());
}

export function isGizmoDragging(): boolean {
  return _gizmoDragging;
}

/** Subscribe to gizmo drag-end events. Returns an unsubscribe function. */
export function subscribeGizmoDragEnd(fn: () => void): () => void {
  _dragEndListeners.add(fn);
  return () => _dragEndListeners.delete(fn);
}

/**
 * usePanelGeometry — owns the AI Assistant panel's position/size lifecycle:
 *   • State + persistence to localStorage
 *   • Re-clamp on window resize
 *   • beginMove / beginResize pointer-gesture handlers with a single shared
 *     cleanup ref so an in-flight gesture is always torn down on unmount,
 *     pointercancel (alt-tab, system interrupt), or when a new gesture starts
 *
 * Extracted out of AiAssistantPanel so the shell can stay focused on tab
 * switching + composition.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  PANEL_GEOMETRY_KEY,
  clampPanelGeometry,
  loadPanelGeometry,
} from './panelGeometry';
import type { PanelGeometry } from './types';

export function usePanelGeometry(panelOpen: boolean) {
  const [geometry, setGeometry] = useState<PanelGeometry>(() => loadPanelGeometry());

  // Holds an in-flight drag/resize cleanup so we can flush it on unmount, on
  // pointercancel (alt-tab, system interrupt), or when a new gesture starts —
  // otherwise window listeners that only unhook on pointerup leak forever if
  // the up event never arrives.
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    localStorage.setItem(PANEL_GEOMETRY_KEY, JSON.stringify(geometry));
  }, [geometry, panelOpen]);

  useEffect(() => {
    const handleResize = () => setGeometry((g) => clampPanelGeometry(g));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => () => {
    activeGestureCleanupRef.current?.();
    activeGestureCleanupRef.current = null;
  }, []);

  const beginGesture = useCallback((
    event: PointerEvent<HTMLElement>,
    apply: (start: PanelGeometry, dx: number, dy: number) => PanelGeometry,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activeGestureCleanupRef.current?.();

    const startX = event.clientX;
    const startY = event.clientY;
    const start = geometry;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setGeometry(clampPanelGeometry(apply(start, moveEvent.clientX - startX, moveEvent.clientY - startY)));
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (activeGestureCleanupRef.current === cleanup) activeGestureCleanupRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    activeGestureCleanupRef.current = cleanup;
  }, [geometry]);

  const beginMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    beginGesture(event, (start, dx, dy) => ({ ...start, left: start.left + dx, top: start.top + dy }));
  }, [beginGesture]);

  const beginResize = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    beginGesture(event, (start, dx, dy) => ({ ...start, width: start.width + dx, height: start.height + dy }));
  }, [beginGesture]);

  return { geometry, beginMove, beginResize };
}

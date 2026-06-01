import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react';

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, [role="button"]';
const VIEWPORT_MARGIN = 8;

type PanelPosition = {
  left: number;
  top: number;
};

type DragState = {
  activeButtons: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const clampPanelPosition = (
  left: number,
  top: number,
  width: number,
  height: number,
): PanelPosition => ({
  left: clamp(left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  top: clamp(top, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
});

const stopPanelEvent = (event: SyntheticEvent) => {
  event.stopPropagation();
};

const stopPanelContextMenu = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export function useDraggablePanel() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragAbortRef = useRef<AbortController | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const latestPositionRef = useRef<PanelPosition | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyPanelPosition = useCallback((nextPosition: PanelPosition) => {
    latestPositionRef.current = nextPosition;
    const panel = panelRef.current;
    if (!panel) return;

    panel.style.position = 'fixed';
    panel.style.left = '0';
    panel.style.top = '0';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = `translate3d(${nextPosition.left}px, ${nextPosition.top}px, 0)`;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragStateRef.current = {
      activeButtons: event.buttons || (1 << event.button),
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    const initialPosition = clampPanelPosition(rect.left, rect.top, rect.width, rect.height);
    latestPositionRef.current = initialPosition;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPosition(initialPosition);
    setIsDragging(true);

    const ownerDocument = panel.ownerDocument;
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      signal: controller.signal,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopImmediatePropagation();
      const dragState = dragStateRef.current;
      if (!dragState) return;
      if ((moveEvent.buttons & dragState.activeButtons) === 0) {
        finishDrag();
        return;
      }

      applyPanelPosition(
        clampPanelPosition(
          moveEvent.clientX - dragState.offsetX,
          moveEvent.clientY - dragState.offsetY,
          dragState.width,
          dragState.height,
        ),
      );
    };

    const finishDrag = (releaseEvent?: Event) => {
      if (releaseEvent?.cancelable) {
        releaseEvent.preventDefault();
      }
      releaseEvent?.stopImmediatePropagation();
      dragStateRef.current = null;
      if (latestPositionRef.current) {
        setPosition(latestPositionRef.current);
      }
      setIsDragging(false);
      controller.abort();
      if (dragAbortRef.current === controller) {
        dragAbortRef.current = null;
      }
    };

    ownerDocument.addEventListener('pointermove', handlePointerMove, listenerOptions);
    ownerDocument.addEventListener('pointerup', finishDrag, listenerOptions);
    ownerDocument.addEventListener('pointercancel', finishDrag, listenerOptions);
    ownerDocument.addEventListener('mouseup', finishDrag, listenerOptions);
    ownerDocument.addEventListener('contextmenu', finishDrag, listenerOptions);
    ownerDocument.defaultView?.addEventListener('mouseup', finishDrag, listenerOptions);
    ownerDocument.defaultView?.addEventListener('blur', finishDrag, listenerOptions);
  }, [applyPanelPosition]);

  useEffect(() => () => {
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
  }, []);

  const panelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!position) return undefined;
    return {
      position: 'fixed',
      left: 0,
      top: 0,
      right: 'auto',
      bottom: 'auto',
      transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
    };
  }, [position]);

  const dragHandleProps = useMemo<HTMLAttributes<HTMLDivElement>>(
    () => ({
      onPointerDown: handlePointerDown,
      title: 'Drag panel',
    }),
    [handlePointerDown],
  );

  const panelEventProps = useMemo<HTMLAttributes<HTMLDivElement>>(
    () => ({
      onPointerDown: stopPanelEvent,
      onPointerMove: stopPanelEvent,
      onPointerUp: stopPanelEvent,
      onClick: stopPanelEvent,
      onContextMenu: stopPanelContextMenu,
      onDoubleClick: stopPanelEvent,
      onWheel: stopPanelEvent,
    }),
    [],
  );

  return {
    dragHandleProps,
    isDragging,
    panelEventProps,
    panelRef,
    panelStyle,
  };
}

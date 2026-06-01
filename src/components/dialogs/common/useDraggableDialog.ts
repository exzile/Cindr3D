import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from 'react';

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, [role="button"]';
const VIEWPORT_MARGIN = 8;

type DialogPosition = {
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

const clampDialogPosition = (
  left: number,
  top: number,
  width: number,
  height: number,
): DialogPosition => ({
  left: clamp(left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  top: clamp(top, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
});

const stopDialogEvent = (event: SyntheticEvent) => {
  event.stopPropagation();
};

const stopDialogContextMenu = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export function useDraggableDialog() {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dragAbortRef = useRef<AbortController | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const latestPositionRef = useRef<DialogPosition | null>(null);
  const [position, setPosition] = useState<DialogPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const applyDialogPosition = useCallback((nextPosition: DialogPosition) => {
    latestPositionRef.current = nextPosition;
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.style.position = 'fixed';
    dialog.style.left = '0';
    dialog.style.top = '0';
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.transform = `translate3d(${nextPosition.left}px, ${nextPosition.top}px, 0)`;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const rect = dialog.getBoundingClientRect();
    dragStateRef.current = {
      activeButtons: event.buttons || (1 << event.button),
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    const initialPosition = clampDialogPosition(rect.left, rect.top, rect.width, rect.height);
    latestPositionRef.current = initialPosition;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPosition(initialPosition);
    setIsDragging(true);

    const ownerDocument = dialog.ownerDocument;
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      signal: controller.signal,
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

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopImmediatePropagation();
      const dragState = dragStateRef.current;
      if (!dragState) return;
      if ((moveEvent.buttons & dragState.activeButtons) === 0) {
        finishDrag();
        return;
      }

      applyDialogPosition(
        clampDialogPosition(
          moveEvent.clientX - dragState.offsetX,
          moveEvent.clientY - dragState.offsetY,
          dragState.width,
          dragState.height,
        ),
      );
    };

    ownerDocument.addEventListener('pointermove', handlePointerMove, listenerOptions);
    ownerDocument.addEventListener('pointerup', finishDrag, listenerOptions);
    ownerDocument.addEventListener('pointercancel', finishDrag, listenerOptions);
    ownerDocument.addEventListener('mouseup', finishDrag, listenerOptions);
    ownerDocument.addEventListener('contextmenu', finishDrag, listenerOptions);
    ownerDocument.defaultView?.addEventListener('mouseup', finishDrag, listenerOptions);
    ownerDocument.defaultView?.addEventListener('blur', finishDrag, listenerOptions);
  }, [applyDialogPosition]);

  useEffect(() => () => {
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
  }, []);

  const dialogStyle = useMemo<CSSProperties | undefined>(() => {
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
      title: 'Drag dialog',
    }),
    [handlePointerDown],
  );

  const dialogEventProps = useMemo<HTMLAttributes<HTMLDivElement>>(
    () => ({
      onPointerDown: stopDialogEvent,
      onPointerMove: stopDialogEvent,
      onPointerUp: stopDialogEvent,
      onClick: stopDialogEvent,
      onContextMenu: stopDialogContextMenu,
      onDoubleClick: stopDialogEvent,
      onWheel: stopDialogEvent,
    }),
    [],
  );

  return {
    dialogEventProps,
    dialogRef,
    dialogStyle,
    dragHandleProps,
    isDragging,
  };
}

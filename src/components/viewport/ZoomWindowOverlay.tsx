import { useState, useRef, useCallback } from 'react';
import { useCADStore } from '../../store/cadStore';

/**
 * NAV-5: Zoom Window overlay.
 * Renders a transparent div on top of the Canvas when cameraNavMode === 'zoom-window'.
 * User drags a rectangle; on release, triggerZoomWindow fires with pixel rect + viewport size.
 */
export default function ZoomWindowOverlay() {
  const cameraNavMode = useCADStore((s) => s.cameraNavMode);
  const setCameraNavMode = useCADStore((s) => s.setCameraNavMode);
  const triggerZoomWindow = useCADStore((s) => s.triggerZoomWindow);

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = cameraNavMode === 'zoom-window';

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!active || e.button !== 0) return;
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setDragStart(p);
      setDragEnd(null);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [active],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDragEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [dragStart],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const dx = end.x - dragStart.x;
      const dy = end.y - dragStart.y;
      if (Math.abs(dx) > 5 && Math.abs(dy) > 5) {
        triggerZoomWindow({
          x1: Math.min(dragStart.x, end.x),
          y1: Math.min(dragStart.y, end.y),
          x2: Math.max(dragStart.x, end.x),
          y2: Math.max(dragStart.y, end.y),
          vpW: rect.width,
          vpH: rect.height,
        });
        setCameraNavMode(null);
      }
      setDragStart(null);
      setDragEnd(null);
    },
    [dragStart, triggerZoomWindow, setCameraNavMode],
  );

  if (!active) return null;

  const selRect =
    dragStart && dragEnd
      ? {
          left: Math.min(dragStart.x, dragEnd.x),
          top: Math.min(dragStart.y, dragEnd.y),
          width: Math.abs(dragEnd.x - dragStart.x),
          height: Math.abs(dragEnd.y - dragStart.y),
        }
      : null;

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 10 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {selRect && (
        <div
          style={{
            position: 'absolute',
            ...selRect,
            border: '1px dashed #4af',
            background: 'rgba(64,160,255,0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

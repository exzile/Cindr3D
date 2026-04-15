import { useCADStore } from '../../store/cadStore';

/**
 * D204 — Window Selection Overlay
 *
 * Renders a selection rectangle on top of the canvas while windowSelecting is true.
 * A solid rectangle indicates full-enclosure (include) mode;
 * a dashed rectangle indicates crossing-select mode (crossing=any side of rect was crossed).
 * The distinction is driven purely by which direction the user drags:
 *   left-to-right → solid blue  (include only)
 *   right-to-left → dashed green (crossing)
 */
export default function WindowSelectOverlay() {
  const windowSelecting = useCADStore((s) => s.windowSelecting);
  const start = useCADStore((s) => s.windowSelectStart);
  const end = useCADStore((s) => s.windowSelectEnd);

  if (!windowSelecting || !start || !end) return null;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  // Crossing select = dragging right-to-left
  const crossing = end.x < start.x;

  const borderStyle = crossing
    ? '1px dashed #4ade80'   // green dashed — crossing select
    : '1px solid #60a5fa';   // blue solid  — include select

  const bgColor = crossing
    ? 'rgba(74, 222, 128, 0.08)'
    : 'rgba(96, 165, 250, 0.1)';

  return (
    <div
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        left: x,
        top: y,
        width: w,
        height: h,
        border: borderStyle,
        background: bgColor,
        zIndex: 20,
      }}
    />
  );
}

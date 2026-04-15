import { useCADStore } from '../../store/cadStore';

/**
 * D205 — Freeform (Lasso) Selection Overlay
 *
 * Renders an SVG polyline representing the freehand selection polygon
 * while lassoSelecting is true. The polyline is drawn with a dashed
 * blue stroke. A closing line is drawn from the last point back to
 * the first point to show what area will be selected on release.
 */
export default function LassoSelectOverlay() {
  const lassoSelecting = useCADStore((s) => s.lassoSelecting);
  const points = useCADStore((s) => s.lassoPoints);

  if (!lassoSelecting || points.length < 2) return null;

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Closing segment from last point back to first
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 20,
        overflow: 'visible',
      }}
    >
      <polyline
        points={polylinePoints}
        fill="rgba(96,165,250,0.1)"
        stroke="#60a5fa"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Closing line */}
      <line
        x1={last.x}
        y1={last.y}
        x2={first.x}
        y2={first.y}
        stroke="#60a5fa"
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.5}
      />
    </svg>
  );
}

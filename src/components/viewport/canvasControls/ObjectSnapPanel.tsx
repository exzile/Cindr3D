/**
 * NAV-24: Object Snaps settings panel.
 * Shown in a popover from the CanvasControls snap button.
 * Provides a master toggle + per-type toggles for all 6 snap modes.
 */
import { useCADStore } from '../../../store/cadStore';

export default function ObjectSnapPanel({ onClose }: { onClose: () => void }) {
  void onClose;

  const objectSnapEnabled = useCADStore((s) => s.objectSnapEnabled);
  const setObjectSnapEnabled = useCADStore((s) => s.setObjectSnapEnabled);
  const snapToEndpoint = useCADStore((s) => s.snapToEndpoint);
  const setSnapToEndpoint = useCADStore((s) => s.setSnapToEndpoint);
  const snapToMidpoint = useCADStore((s) => s.snapToMidpoint);
  const setSnapToMidpoint = useCADStore((s) => s.setSnapToMidpoint);
  const snapToCenter = useCADStore((s) => s.snapToCenter);
  const setSnapToCenter = useCADStore((s) => s.setSnapToCenter);
  const snapToIntersection = useCADStore((s) => s.snapToIntersection);
  const setSnapToIntersection = useCADStore((s) => s.setSnapToIntersection);
  const snapToPerpendicular = useCADStore((s) => s.snapToPerpendicular);
  const setSnapToPerpendicular = useCADStore((s) => s.setSnapToPerpendicular);
  const snapToTangent = useCADStore((s) => s.snapToTangent);
  const setSnapToTangent = useCADStore((s) => s.setSnapToTangent);

  const snapTypes = [
    { label: 'Endpoint', value: snapToEndpoint, set: setSnapToEndpoint, color: '#f97316' },
    { label: 'Midpoint', value: snapToMidpoint, set: setSnapToMidpoint, color: '#eab308' },
    { label: 'Center', value: snapToCenter, set: setSnapToCenter, color: '#0ea5e9' },
    { label: 'Intersection', value: snapToIntersection, set: setSnapToIntersection, color: '#22c55e' },
    { label: 'Perpendicular', value: snapToPerpendicular, set: setSnapToPerpendicular, color: '#a855f7' },
    { label: 'Tangent', value: snapToTangent, set: setSnapToTangent, color: '#ec4899' },
  ] as const;

  return (
    <div className="cc-panel cc-panel--snaps">
      <div className="cc-panel-title">Object Snaps</div>
      <div className="cc-panel-section">
        <label className="cc-panel-check cc-panel-check--master">
          <input
            type="checkbox"
            checked={objectSnapEnabled}
            onChange={(e) => setObjectSnapEnabled(e.target.checked)}
          />
          <span>Enable Object Snaps</span>
        </label>
        <div className="cc-panel-snap-grid">
          {snapTypes.map(({ label, value, set, color }) => (
            <label
              key={label}
              className={`cc-panel-snap${objectSnapEnabled ? '' : ' is-disabled'}`}
            >
              <input
                type="checkbox"
                checked={value}
                disabled={!objectSnapEnabled}
                onChange={(e) => set(e.target.checked)}
              />
              <span className="cc-panel-snap-dot" style={{ background: color }} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

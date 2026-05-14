import type { PlateObject } from '../../../../types/slicer';
import { objectApproxFilament, type ObjectStatus } from './helpers';

interface PrintabilityIssue { message: string }
interface PrintabilityEntry { issues: PrintabilityIssue[] }

/**
 * DOM tooltip shown when the user hovers an ObjectSilhouette. Driven by the
 * RAF-throttled hover state owned by the host so this stays presentational.
 */
export function ObjectHoverTooltip({
  obj,
  position,
  filamentWeight,
  plateObjectCount,
  isCurrent,
  isCancelled,
  status,
  report,
}: {
  obj: PlateObject;
  position: { x: number; y: number };
  filamentWeight: number | undefined;
  plateObjectCount: number;
  isCurrent: boolean;
  isCancelled: boolean;
  status: ObjectStatus;
  report: PrintabilityEntry | null;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        minWidth: 180,
        padding: '6px 8px',
        border: '1px solid var(--border, #2a2a4a)',
        borderRadius: 6,
        background: 'rgba(10, 10, 20, 0.9)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        color: 'var(--text-primary, #f0f0f5)',
        fontSize: 11,
        pointerEvents: 'none',
        zIndex: 40,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: isCurrent ? '#44aaff' : 'var(--text-primary, #f0f0f5)' }}>
        {obj.name || obj.id.slice(0, 8)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-muted, #aaa)' }}>
        <span>{(obj.boundingBox.max.x - obj.boundingBox.min.x).toFixed(1)} x {(obj.boundingBox.max.y - obj.boundingBox.min.y).toFixed(1)} mm</span>
        <span>{isCancelled ? 'cancelled' : isCurrent ? 'printing' : 'queued'}</span>
      </div>
      <div style={{ marginTop: 3, display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-muted, #aaa)' }}>
        <span>{objectApproxFilament(filamentWeight, plateObjectCount)}</span>
        <span>{status.label}</span>
      </div>
      {report?.issues[0] && (
        <div style={{ marginTop: 4, color: '#facc15' }}>
          {report.issues[0].message}
        </div>
      )}
    </div>
  );
}

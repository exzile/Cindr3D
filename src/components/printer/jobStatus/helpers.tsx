import { formatDurationClock, formatFileSize, formatFilamentLength } from '../../../utils/printerFormat';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export const formatTime = (seconds: number | undefined | null) =>
  formatDurationClock(seconds, '--:--:--');

export const formatBytes = (bytes: number | undefined | null) =>
  formatFileSize(bytes, '0 B');

export const formatFilament = (mm: number | undefined | null) =>
  formatFilamentLength(mm, '0 mm');

export function estimatedCompletion(remainingSeconds: number | undefined | null): string {
  if (!remainingSeconds || remainingSeconds <= 0) return '--:--';
  const completionDate = new Date(Date.now() + remainingSeconds * 1000);
  return completionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

export function JobDetailRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 0', fontSize: 12,
    }}>
      <span style={{ color: '#888899' }}>{label}</span>
      <span style={{
        color: highlight ? '#44cc88' : '#e0e0ff',
        fontWeight: highlight ? 600 : 400,
        fontFamily: 'monospace',
      }}>
        {value}
      </span>
    </div>
  );
}

export function SliderRow({
  label, value, min, max, unit, onChange, onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0',
    }}>
      <span style={{ fontSize: 12, color: '#888899', width: 44, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        style={{ flex: 1, accentColor: '#44aaff' }}
      />
      <span style={{
        fontSize: 13, color: '#e0e0ff', fontFamily: 'monospace', width: 52, textAlign: 'right',
      }}>
        {value}{unit}
      </span>
    </div>
  );
}

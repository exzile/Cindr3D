export function formatFileSize(bytes: number | undefined | null, empty = '--'): string {
  if (bytes == null || bytes <= 0) return empty;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatFilamentLength(mm: number | undefined | null, empty = '--'): string {
  if (mm == null || mm <= 0) return empty;
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  return `${mm.toFixed(1)} mm`;
}

export function formatDurationWords(
  seconds: number | undefined | null,
  empty = '--',
  includeSecondsWhenHours = true,
): string {
  if (!seconds || seconds <= 0) return empty;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return includeSecondsWhenHours ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDurationClock(seconds: number | undefined | null, empty = '--:--:--'): string {
  if (!seconds || seconds <= 0) return empty;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimeOfDay(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

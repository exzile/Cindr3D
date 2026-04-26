export function formatSlicerTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatSlicerLength(mm: number): string {
  if (mm > 1000) return `${(mm / 1000).toFixed(2)}m`;
  return `${mm.toFixed(0)}mm`;
}

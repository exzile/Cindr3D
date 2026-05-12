import type { DayOfWeek, SolarProvider, TOUTier } from '../../../store/schedulingStore';

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

export const TIER_LABELS: Record<TOUTier, string> = {
  'off-peak': 'Off-peak',
  shoulder: 'Shoulder',
  peak: 'Peak',
};

export const SOLAR_PROVIDER_LABELS: Record<SolarProvider, string> = {
  'tesla-powerwall': 'Tesla Powerwall',
  'enphase-envoy': 'Enphase Envoy',
  solaredge: 'SolarEdge',
  custom: 'Custom',
};

export function parseTimestamp(ts: string): Date | null {
  // "YYYY-MM-DD HH:MM:SS" — convert to ISO. Locale-free so Safari is happy.
  const iso = ts.replace(' ', 'T');
  const d = new Date(iso);
  return isFinite(d.getTime()) ? d : null;
}

export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtMoney(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

export function fmtWeight(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(0)} g`;
}

export function fmtLocalDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function readStoredNumber(key: string, fallback: number, isValid: (value: number) => boolean): number {
  try {
    const saved = Number(window.localStorage.getItem(key));
    return isValid(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function parseTimeParts(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? filePath;
}

export function topN<T>(arr: T[], n: number, key: (x: T) => number): T[] {
  return [...arr].sort((a, b) => key(b) - key(a)).slice(0, n);
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

import type { PrintHistoryEntry } from '../types/printer.types';

export interface PrintHistoryJob {
  file: string;
  profile: string | null;
  material: string | null;
  printer: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  outcome: 'completed' | 'cancelled' | 'in-progress';
}

export interface PrintHistoryGroup {
  key: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
  failureRate: number;
  lastSuccess: PrintHistoryJob | null;
  lastFailure: PrintHistoryJob | null;
}

export interface PrintHistoryInsight {
  title: string;
  detail: string;
}

export interface PrintHistoryAnalytics {
  jobs: PrintHistoryJob[];
  byFile: PrintHistoryGroup[];
  byProfile: PrintHistoryGroup[];
  byMaterial: PrintHistoryGroup[];
  byPrinter: PrintHistoryGroup[];
  insights: PrintHistoryInsight[];
}

function parseTimestamp(ts: string): Date | null {
  const d = new Date(ts.replace(' ', 'T'));
  return isFinite(d.getTime()) ? d : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/[",;]+$/, '');
  }
  return null;
}

export function inferMaterialLabel(entry: Pick<PrintHistoryEntry, 'file' | 'message'>): string | null {
  const explicit = firstMatch(entry.message, [
    /\b(?:material|filament)\s*[:=]\s*"?([A-Za-z0-9_+ .-]+?)(?=\s+(?:material|filament|profile)\s*=|[,;\n"]|$)/i,
    /\b(?:material|filament)\s+([A-Za-z0-9_+.-]+)/i,
  ]);
  if (explicit) return explicit;
  const source = `${entry.message} ${entry.file ?? ''}`;
  const known = source.match(/\b(PLA|PETG|ABS|ASA|TPU|PC|PA|NYLON|PCTG|HIPS)\b/i);
  return known ? known[1].toUpperCase() : null;
}

export function inferProfileLabel(entry: Pick<PrintHistoryEntry, 'file' | 'message'>): string | null {
  const explicit = firstMatch(entry.message, [
    /\b(?:print\s*)?profile\s*[:=]\s*"?([A-Za-z0-9_+ .-]+?)(?=\s+(?:material|filament|profile)\s*=|[,;\n"]|$)/i,
    /\bprofile\s+([A-Za-z0-9_+ .-]+?)(?=\s+(?:material|filament|profile)\s*=|[,;\n"]|$)/i,
  ]);
  if (explicit) return explicit;
  const source = `${entry.message} ${entry.file ?? ''}`;
  const quality = source.match(/\b(draft|standard|normal|fine|extra[-_ ]?fine|quality|strong|fast|vase|spiral)\b/i);
  if (quality) return quality[1].replace(/[-_]/g, ' ');
  const height = source.match(/\b(0\.\d+mm)\b/i);
  return height ? height[1] : null;
}

export function buildPrintHistoryJobs(history: PrintHistoryEntry[], printerName = 'Current printer'): PrintHistoryJob[] {
  const jobs: PrintHistoryJob[] = [];
  const openByFile = new Map<string, PrintHistoryJob>();

  for (const entry of history) {
    const when = parseTimestamp(entry.timestamp);
    if (!when) continue;
    const key = entry.file ?? '';

    if (entry.kind === 'start') {
      openByFile.set(key, {
        file: key || '(unknown)',
        profile: inferProfileLabel(entry),
        material: inferMaterialLabel(entry),
        printer: printerName,
        startedAt: when,
        endedAt: null,
        durationSec: 0,
        outcome: 'in-progress',
      });
    } else if (entry.kind === 'finish' || entry.kind === 'cancel') {
      let job = openByFile.get(key);
      if (!job && openByFile.size > 0) {
        const keys = [...openByFile.keys()];
        const lastKey = keys[keys.length - 1];
        job = openByFile.get(lastKey);
        if (job) openByFile.delete(lastKey);
      } else if (job) {
        openByFile.delete(key);
      }
      if (!job) continue;
      job.endedAt = when;
      const duration = (when.getTime() - job.startedAt.getTime()) / 1000;
      job.durationSec = entry.durationSec ?? Math.max(0, Math.floor(duration));
      job.outcome = entry.kind === 'finish' ? 'completed' : 'cancelled';
      job.profile = job.profile ?? inferProfileLabel(entry);
      job.material = job.material ?? inferMaterialLabel(entry);
      jobs.push(job);
    }
  }

  jobs.push(...openByFile.values());
  jobs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return jobs;
}

function groupJobs(
  jobs: PrintHistoryJob[],
  keyFor: (job: PrintHistoryJob) => string | null,
): PrintHistoryGroup[] {
  const groups = new Map<string, PrintHistoryJob[]>();
  for (const job of jobs) {
    if (job.outcome === 'in-progress') continue;
    const key = keyFor(job);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.entries()]
    .map(([key, entries]) => {
      const completed = entries.filter((job) => job.outcome === 'completed').length;
      const cancelled = entries.filter((job) => job.outcome === 'cancelled').length;
      const sorted = [...entries].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      return {
        key,
        label: key,
        total: completed + cancelled,
        completed,
        cancelled,
        failureRate: completed + cancelled > 0 ? (cancelled / (completed + cancelled)) * 100 : 0,
        lastSuccess: sorted.find((job) => job.outcome === 'completed') ?? null,
        lastFailure: sorted.find((job) => job.outcome === 'cancelled') ?? null,
      };
    })
    .sort((a, b) => b.failureRate - a.failureRate || b.total - a.total);
}

function buildInsights(groups: PrintHistoryGroup[]): PrintHistoryInsight[] {
  const insights: PrintHistoryInsight[] = [];
  const risky = groups.find((group) => group.total >= 3 && group.failureRate >= 40);
  if (risky) {
    const working = risky.lastSuccess?.profile ?? risky.lastSuccess?.material ?? risky.lastSuccess?.startedAt.toLocaleDateString();
    insights.push({
      title: `${risky.label} is failing often`,
      detail: `${risky.cancelled}/${risky.total} recent runs failed. Last working ${risky.lastSuccess?.profile ? 'profile' : risky.lastSuccess?.material ? 'material' : 'run'} was ${working ?? 'not found in history'}.`,
    });
  }
  const clean = groups.find((group) => group.total >= 3 && group.failureRate === 0);
  if (clean) {
    insights.push({
      title: `${clean.label} looks stable`,
      detail: `${clean.total} recent runs completed without cancellation.`,
    });
  }
  return insights.slice(0, 3);
}

export function buildPrintHistoryAnalytics(
  history: PrintHistoryEntry[],
  printerName = 'Current printer',
): PrintHistoryAnalytics {
  const jobs = buildPrintHistoryJobs(history, printerName);
  const byFile = groupJobs(jobs, (job) => job.file);
  const byProfile = groupJobs(jobs, (job) => job.profile);
  const byMaterial = groupJobs(jobs, (job) => job.material);
  const byPrinter = groupJobs(jobs, (job) => job.printer);
  return {
    jobs,
    byFile,
    byProfile,
    byMaterial,
    byPrinter,
    insights: buildInsights([...byFile, ...byProfile, ...byMaterial, ...byPrinter]),
  };
}

import {
  DEFAULT_SPOOL_COST_PER_KG,
  estimateSpoolFilamentCost,
  spoolCostPerKg,
  type Spool,
} from '../store/spoolStore';
import type { PrintHistoryJob } from './printHistoryAnalytics';

export interface PrintCostSettings {
  printerWatts: number;
  electricityRatePerKwh: number;
  electricityRateAt?: (epochMs: number) => number | null | undefined;
  filamentGramsPerHour: number;
  co2KgPerKwh: number;
  nowMs?: number;
}

export interface PrintCostEstimate {
  job: PrintHistoryJob;
  durationSec: number;
  filamentG: number;
  filamentCost: number;
  filamentCostPerKg: number;
  energyKwh: number;
  energyCost: number;
  co2Kg: number;
  totalCost: number;
}

export interface PrintCostRollup {
  key: string;
  label: string;
  runs: number;
  filamentG: number;
  filamentCost: number;
  energyKwh: number;
  energyCost: number;
  co2Kg: number;
  totalCost: number;
}

export interface PrintCostSummary {
  estimates: PrintCostEstimate[];
  totals: Omit<PrintCostRollup, 'key' | 'label' | 'runs'> & { runs: number };
  byProject: PrintCostRollup[];
  byMaterial: PrintCostRollup[];
  byPrinter: PrintCostRollup[];
  byMonth: PrintCostRollup[];
  byPrinterMonth: PrintCostRollup[];
}

function clampFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function materialKey(material: string | null | undefined): string | null {
  const trimmed = material?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function estimateEnergyKwh(durationSec: number, printerWatts: number): number {
  const hours = clampFinite(durationSec) / 3600;
  return (hours * clampFinite(printerWatts)) / 1000;
}

export function estimateElectricityCost(
  durationSec: number,
  printerWatts: number,
  ratePerKwh: number,
  startMs?: number,
  electricityRateAt?: (epochMs: number) => number | null | undefined,
): number {
  if (!electricityRateAt || !Number.isFinite(startMs)) {
    return estimateEnergyKwh(durationSec, printerWatts) * clampFinite(ratePerKwh);
  }

  const safeWatts = clampFinite(printerWatts);
  const fallbackRate = clampFinite(ratePerKwh);
  const safeStartMs = Number(startMs);
  const endMs = safeStartMs + clampFinite(durationSec) * 1000;
  let cursor = safeStartMs;
  let cost = 0;
  while (cursor < endMs) {
    const next = Math.min(cursor + 60_000, endMs);
    const sampledRate = electricityRateAt(cursor);
    const rate = Number.isFinite(sampledRate) ? clampFinite(Number(sampledRate)) : fallbackRate;
    cost += (safeWatts / 1000) * ((next - cursor) / 3_600_000) * rate;
    cursor = next;
  }
  return cost;
}

export function averageSpoolCostPerKg(spools: Spool[], material?: string | null): number {
  const wanted = materialKey(material);
  const candidates = wanted
    ? spools.filter((spool) => materialKey(spool.material) === wanted)
    : spools;
  const priced = (candidates.length > 0 ? candidates : spools)
    .map((spool) => spoolCostPerKg(spool))
    .filter((cost) => Number.isFinite(cost) && cost >= 0);
  if (priced.length === 0) return DEFAULT_SPOOL_COST_PER_KG;
  return priced.reduce((sum, cost) => sum + cost, 0) / priced.length;
}

export function effectiveJobDurationSec(job: PrintHistoryJob, nowMs = Date.now()): number {
  if (job.outcome === 'in-progress') {
    return Math.max(0, Math.floor((nowMs - job.startedAt.getTime()) / 1000));
  }
  return clampFinite(job.durationSec);
}

export function printJobCostKey(job: PrintHistoryJob): string {
  return [
    job.printer,
    job.file,
    job.startedAt.getTime(),
    job.endedAt?.getTime() ?? 'open',
    job.outcome,
  ].join('|');
}

export function estimatePrintJobCost(
  job: PrintHistoryJob,
  spools: Spool[],
  settings: PrintCostSettings,
): PrintCostEstimate {
  const durationSec = effectiveJobDurationSec(job, settings.nowMs);
  const hours = durationSec / 3600;
  const filamentG = hours * clampFinite(settings.filamentGramsPerHour);
  const filamentCostPerKg = averageSpoolCostPerKg(spools, job.material);
  const filamentCost = estimateSpoolFilamentCost({ costPerKg: filamentCostPerKg }, filamentG);
  const energyKwh = estimateEnergyKwh(durationSec, settings.printerWatts);
  const energyCost = estimateElectricityCost(
    durationSec,
    settings.printerWatts,
    settings.electricityRatePerKwh,
    job.startedAt.getTime(),
    settings.electricityRateAt,
  );
  const co2Kg = energyKwh * clampFinite(settings.co2KgPerKwh);
  return {
    job,
    durationSec,
    filamentG,
    filamentCost,
    filamentCostPerKg,
    energyKwh,
    energyCost,
    co2Kg,
    totalCost: filamentCost + energyCost,
  };
}

function rollupBy(
  estimates: PrintCostEstimate[],
  keyFor: (estimate: PrintCostEstimate) => string,
  labelFor: (estimate: PrintCostEstimate) => string,
): PrintCostRollup[] {
  const groups = new Map<string, PrintCostRollup>();
  for (const estimate of estimates) {
    const key = keyFor(estimate);
    const current = groups.get(key) ?? {
      key,
      label: labelFor(estimate),
      runs: 0,
      filamentG: 0,
      filamentCost: 0,
      energyKwh: 0,
      energyCost: 0,
      co2Kg: 0,
      totalCost: 0,
    };
    current.runs += 1;
    current.filamentG += estimate.filamentG;
    current.filamentCost += estimate.filamentCost;
    current.energyKwh += estimate.energyKwh;
    current.energyCost += estimate.energyCost;
    current.co2Kg += estimate.co2Kg;
    current.totalCost += estimate.totalCost;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.totalCost - a.totalCost || b.runs - a.runs);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function summarizePrintCosts(
  jobs: PrintHistoryJob[],
  spools: Spool[],
  settings: PrintCostSettings,
): PrintCostSummary {
  const estimates = jobs.map((job) => estimatePrintJobCost(job, spools, settings));
  const totals = estimates.reduce(
    (sum, estimate) => ({
      runs: sum.runs + 1,
      filamentG: sum.filamentG + estimate.filamentG,
      filamentCost: sum.filamentCost + estimate.filamentCost,
      energyKwh: sum.energyKwh + estimate.energyKwh,
      energyCost: sum.energyCost + estimate.energyCost,
      co2Kg: sum.co2Kg + estimate.co2Kg,
      totalCost: sum.totalCost + estimate.totalCost,
    }),
    { runs: 0, filamentG: 0, filamentCost: 0, energyKwh: 0, energyCost: 0, co2Kg: 0, totalCost: 0 },
  );
  return {
    estimates,
    totals,
    byProject: rollupBy(estimates, (estimate) => estimate.job.file, (estimate) => estimate.job.file),
    byMaterial: rollupBy(
      estimates,
      (estimate) => estimate.job.material ?? 'Unknown material',
      (estimate) => estimate.job.material ?? 'Unknown material',
    ),
    byPrinter: rollupBy(estimates, (estimate) => estimate.job.printer, (estimate) => estimate.job.printer),
    byMonth: rollupBy(estimates, (estimate) => monthKey(estimate.job.startedAt), (estimate) => monthKey(estimate.job.startedAt)),
    byPrinterMonth: rollupBy(
      estimates,
      (estimate) => `${estimate.job.printer}|${monthKey(estimate.job.startedAt)}`,
      (estimate) => `${estimate.job.printer} - ${monthKey(estimate.job.startedAt)}`,
    ),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportPrintCostSummaryCsv(summary: PrintCostSummary): string {
  const rows = [
    ['startedAt', 'printer', 'file', 'material', 'status', 'durationSec', 'filamentG', 'energyKwh', 'co2Kg', 'totalCost'],
    ...summary.estimates.map((estimate) => [
      estimate.job.startedAt.toISOString(),
      estimate.job.printer,
      estimate.job.file,
      estimate.job.material ?? '',
      estimate.job.outcome,
      estimate.durationSec.toFixed(0),
      estimate.filamentG.toFixed(3),
      estimate.energyKwh.toFixed(4),
      estimate.co2Kg.toFixed(4),
      estimate.totalCost.toFixed(4),
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function exportPrintCostSummaryJson(summary: PrintCostSummary): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    totals: summary.totals,
    byProject: summary.byProject,
    byMaterial: summary.byMaterial,
    byPrinter: summary.byPrinter,
    byMonth: summary.byMonth,
    byPrinterMonth: summary.byPrinterMonth,
    jobs: summary.estimates.map((estimate) => ({
      startedAt: estimate.job.startedAt.toISOString(),
      endedAt: estimate.job.endedAt?.toISOString() ?? null,
      printer: estimate.job.printer,
      file: estimate.job.file,
      profile: estimate.job.profile,
      material: estimate.job.material,
      status: estimate.job.outcome,
      durationSec: estimate.durationSec,
      filamentG: estimate.filamentG,
      filamentCost: estimate.filamentCost,
      filamentCostPerKg: estimate.filamentCostPerKg,
      energyKwh: estimate.energyKwh,
      energyCost: estimate.energyCost,
      co2Kg: estimate.co2Kg,
      totalCost: estimate.totalCost,
    })),
  }, null, 2);
}

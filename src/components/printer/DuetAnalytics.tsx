import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, Clock, Package, CheckCircle2, XCircle, Calendar,
  Award, Activity, Info, AlertTriangle, Zap, Leaf, Receipt, Download,
  CalendarPlus, Trash2,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  useSchedulingStore,
  type DayOfWeek,
  type SolarProvider,
  type TOUTier,
} from '../../store/schedulingStore';
import { useSpoolStore } from '../../store/spoolStore';
import { buildPrintHistoryAnalytics, type PrintHistoryGroup } from '../../utils/printHistoryAnalytics';
import {
  effectiveJobDurationSec,
  exportPrintCostSummaryCsv,
  exportPrintCostSummaryJson,
  printJobCostKey,
  summarizePrintCosts,
  type PrintCostRollup,
} from '../../utils/printCost';
import { colors as COLORS } from '../../utils/theme';

// ---------------------------------------------------------------------------
// Parsing & aggregation
// ---------------------------------------------------------------------------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
const TIER_LABELS: Record<TOUTier, string> = {
  'off-peak': 'Off-peak',
  shoulder: 'Shoulder',
  peak: 'Peak',
};
const SOLAR_PROVIDER_LABELS: Record<SolarProvider, string> = {
  'tesla-powerwall': 'Tesla Powerwall',
  'enphase-envoy': 'Enphase Envoy',
  solaredge: 'SolarEdge',
  custom: 'Custom',
};

function parseTimestamp(ts: string): Date | null {
  // "YYYY-MM-DD HH:MM:SS" — convert to ISO. Locale-free so Safari is happy.
  const iso = ts.replace(' ', 'T');
  const d = new Date(iso);
  return isFinite(d.getTime()) ? d : null;
}

function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMoney(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function fmtWeight(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams.toFixed(0)} g`;
}

function fmtLocalDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readStoredNumber(key: string, fallback: number, isValid: (value: number) => boolean): number {
  try {
    const saved = Number(window.localStorage.getItem(key));
    return isValid(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function parseTimeParts(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? filePath;
}

function topN<T>(arr: T[], n: number, key: (x: T) => number): T[] {
  return [...arr].sort((a, b) => key(b) - key(a)).slice(0, n);
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetAnalytics() {
  const history = usePrinterStore((s) => s.printHistory);
  const loading = usePrinterStore((s) => s.printHistoryLoading);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const spools = useSpoolStore((s) => s.spools);
  const touWindows = useSchedulingStore((s) => s.touWindows);
  const utilityRateConfigs = useSchedulingStore((s) => s.utilityRateConfigs);
  const solarIntegrationConfigs = useSchedulingStore((s) => s.solarIntegrationConfigs);
  const addTOUWindow = useSchedulingStore((s) => s.addTOUWindow);
  const removeTOUWindow = useSchedulingStore((s) => s.removeTOUWindow);
  const findCheapestStart = useSchedulingStore((s) => s.findCheapestStart);
  const schedulePrintAtCheapestWindow = useSchedulingStore((s) => s.schedulePrintAtCheapestWindow);
  const upsertUtilityRateConfig = useSchedulingStore((s) => s.upsertUtilityRateConfig);
  const upsertSolarIntegrationConfig = useSchedulingStore((s) => s.upsertSolarIntegrationConfig);
  const canStartWithSolarSurplus = useSchedulingStore((s) => s.canStartWithSolarSurplus);
  const rateAt = useSchedulingStore((s) => s.rateAt);

  const [windowDays, setWindowDays] = useState<number>(() => {
    return readStoredNumber('cindr3d-analytics-window', 30, (saved) => isFinite(saved) && saved > 0);
  });
  const [printerWatts, setPrinterWatts] = useState<number>(() => {
    return readStoredNumber('cindr3d-cost-watts', 250, (saved) => isFinite(saved) && saved >= 0);
  });
  const [electricityRate, setElectricityRate] = useState<number>(() => {
    return readStoredNumber('cindr3d-cost-rate', 0.16, (saved) => isFinite(saved) && saved >= 0);
  });
  const [filamentGPerHour, setFilamentGPerHour] = useState<number>(() => {
    return readStoredNumber('cindr3d-cost-filament-gph', 18, (saved) => isFinite(saved) && saved >= 0);
  });
  const [co2KgPerKwh, setCo2KgPerKwh] = useState<number>(() => {
    return readStoredNumber('cindr3d-cost-co2', 0.386, (saved) => isFinite(saved) && saved >= 0);
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [touTier, setTouTier] = useState<TOUTier>('off-peak');
  const [touLabel, setTouLabel] = useState('Off-peak');
  const [touRate, setTouRate] = useState(0.08);
  const [touStart, setTouStart] = useState('22:00');
  const [touEnd, setTouEnd] = useState('06:00');
  const [touDays, setTouDays] = useState<DayOfWeek[]>(ALL_DAYS);
  const [plannerFilePath, setPlannerFilePath] = useState('0:/gcodes/next-print.gcode');
  const [plannerDurationHours, setPlannerDurationHours] = useState(4);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  const activePrinterName = useMemo(
    () => printers.find((printer) => printer.id === activePrinterId)?.name ?? 'Current printer',
    [printers, activePrinterId],
  );
  const planningPrinterId = activePrinterId ?? printers[0]?.id ?? null;
  const planningPrinterName = useMemo(
    () => printers.find((printer) => printer.id === planningPrinterId)?.name ?? 'Any printer',
    [printers, planningPrinterId],
  );
  const printerTouWindows = useMemo(
    () => touWindows.filter((window) => window.printerId === null || window.printerId === planningPrinterId),
    [touWindows, planningPrinterId],
  );
  const utilityConfig = useMemo(
    () => utilityRateConfigs.find((config) => config.printerId === planningPrinterId) ?? null,
    [utilityRateConfigs, planningPrinterId],
  );
  const solarConfig = useMemo(
    () => solarIntegrationConfigs.find((config) => config.printerId === planningPrinterId) ?? null,
    [solarIntegrationConfigs, planningPrinterId],
  );
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - windowDays);
    return d;
  }, [windowDays]);
  const historyInWindow = useMemo(
    () => history.filter((entry) => {
      const when = parseTimestamp(entry.timestamp);
      return !!when && when >= cutoff;
    }),
    [history, cutoff],
  );
  const analytics = useMemo(
    () => buildPrintHistoryAnalytics(historyInWindow, activePrinterName),
    [historyInWindow, activePrinterName],
  );
  const jobsInWindow = analytics.jobs;

  const stats = useMemo(() => {
    let completed = 0;
    let cancelled = 0;
    let totalSec = 0;
    const byFile = new Map<string, { count: number; time: number }>();
    const byDay = new Map<string, number>();
    for (const j of jobsInWindow) {
      const durationSec = effectiveJobDurationSec(j, nowMs);
      if (j.outcome === 'completed') completed++;
      if (j.outcome === 'cancelled') cancelled++;
      totalSec += durationSec;
      const f = byFile.get(j.file) ?? { count: 0, time: 0 };
      f.count++;
      f.time += durationSec;
      byFile.set(j.file, f);
      const day = localDateKey(j.startedAt);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const total = completed + cancelled;
    const successRate = total > 0 ? (completed / total) * 100 : 0;
    const avgSec = completed > 0 ? totalSec / completed : 0;
    const topFiles = topN([...byFile.entries()], 5, ([, v]) => v.count);
    return { completed, cancelled, total, successRate, totalSec, avgSec, topFiles, byDay };
  }, [jobsInWindow, nowMs]);

  // Build a 14-column (or windowDays) spark bar of jobs/day.
  const spark = useMemo(() => {
    const arr: { label: string; value: number }[] = [];
    const now = new Date();
    const days = Math.min(windowDays, 30);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      arr.push({ label: fmtDate(d), value: stats.byDay.get(key) ?? 0 });
    }
    return arr;
  }, [stats.byDay, windowDays]);

  const sparkMax = Math.max(1, ...spark.map((s) => s.value));

  const costSummary = useMemo(
    () => summarizePrintCosts(jobsInWindow, spools, {
      printerWatts,
      electricityRatePerKwh: electricityRate,
      electricityRateAt: (epochMs) => rateAt(planningPrinterId, epochMs).ratePerKwh,
      filamentGramsPerHour: filamentGPerHour,
      co2KgPerKwh,
      nowMs,
    }),
    [jobsInWindow, spools, printerWatts, electricityRate, rateAt, planningPrinterId, touWindows, filamentGPerHour, co2KgPerKwh, nowMs],
  );
  const liveEstimate = costSummary.estimates.find((estimate) => estimate.job.outcome === 'in-progress') ?? null;
  const recentEstimatesByJob = useMemo(() => {
    const map = new Map<string, typeof costSummary.estimates[number]>();
    for (const estimate of costSummary.estimates) {
      map.set(printJobCostKey(estimate.job), estimate);
    }
    return map;
  }, [costSummary.estimates]);
  const cheapestWindow = useMemo(
    () => findCheapestStart(
      planningPrinterId,
      nowMs,
      Math.max(0, plannerDurationHours) * 3_600_000,
      printerWatts,
      168,
    ),
    [findCheapestStart, planningPrinterId, nowMs, plannerDurationHours, printerWatts, printerTouWindows],
  );
  const solarGate = useMemo(
    () => planningPrinterId ? canStartWithSolarSurplus(planningPrinterId, printerWatts) : null,
    [canStartWithSolarSurplus, planningPrinterId, printerWatts, solarIntegrationConfigs],
  );

  const onWindowChange = (v: number) => {
    setWindowDays(v);
    try { localStorage.setItem('cindr3d-analytics-window', String(v)); } catch { /* ignore */ }
  };

  const saveNumber = (key: string, value: number, setter: (next: number) => void) => {
    const next = Math.max(0, Number(value) || 0);
    setter(next);
    try { localStorage.setItem(key, String(next)); } catch { /* ignore */ }
  };

  const exportCsv = () => {
    downloadText(`cindr3d-cost-energy-${windowDays}d.csv`, exportPrintCostSummaryCsv(costSummary), 'text/csv;charset=utf-8');
  };

  const exportJson = () => {
    downloadText(`cindr3d-cost-energy-${windowDays}d.json`, exportPrintCostSummaryJson(costSummary), 'application/json;charset=utf-8');
  };

  const toggleTouDay = (day: DayOfWeek) => {
    setTouDays((prev) => (
      prev.includes(day)
        ? prev.filter((candidate) => candidate !== day)
        : [...prev, day].sort()
    ));
  };

  const addTouRateWindow = () => {
    if (touDays.length === 0) return;
    const [startHour, startMinute] = parseTimeParts(touStart);
    const [endHour, endMinute] = parseTimeParts(touEnd);
    addTOUWindow({
      printerId: planningPrinterId,
      label: touLabel.trim() || TIER_LABELS[touTier],
      tier: touTier,
      ratePerKwh: Math.max(0, touRate),
      days: touDays,
      startHour,
      startMinute,
      endHour,
      endMinute,
    });
  };

  const scheduleCheapestPrint = () => {
    const filePath = plannerFilePath.trim();
    if (!filePath || !cheapestWindow) return;
    schedulePrintAtCheapestWindow({
      jobId: null,
      filePath,
      fileName: fileNameFromPath(filePath),
      printerId: planningPrinterId,
      earliestStart: nowMs,
      estimatedDurationMs: Math.max(0, plannerDurationHours) * 3_600_000,
      note: `Auto-scheduled for ${cheapestWindow.label} at ${fmtMoney(cheapestWindow.ratePerKwh)}/kWh.`,
      status: 'scheduled',
      printerWatts,
      horizonHours: 168,
    });
  };

  return (
    <div className="duet-analytics">
      <div className="duet-analytics__toolbar">
        <div className="duet-analytics__toolbar-title">
          <TrendingUp size={14} /> Print statistics
        </div>
        <div className="duet-analytics__toolbar-actions">
          <button type="button" className="duet-analytics__export" onClick={exportCsv} disabled={costSummary.estimates.length === 0}>
            <Download size={11} /> CSV
          </button>
          <button type="button" className="duet-analytics__export" onClick={exportJson} disabled={costSummary.estimates.length === 0}>
            <Download size={11} /> JSON
          </button>
          <label className="duet-analytics__window">
            <Calendar size={11} />
            <select value={windowDays} onChange={(e) => onWindowChange(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>12 months</option>
            </select>
          </label>
        </div>
      </div>

      {loading && (
        <div className="duet-analytics__hint">
          <Activity size={13} /> Loading history…
        </div>
      )}

      {!loading && history.length === 0 && (
        <div className="duet-analytics__empty">
          <Info size={18} />
          <div>No print history recorded yet. Once a print starts or
          finishes, it will show up here.</div>
        </div>
      )}

      {!loading && history.length > 0 && (
        <>
          {/* Headline KPI cards */}
          <div className="duet-analytics__cards">
            <Card
              icon={<CheckCircle2 size={14} />}
              value={stats.completed}
              label="Completed"
              color={COLORS.success}
            />
            <Card
              icon={<XCircle size={14} />}
              value={stats.cancelled}
              label="Cancelled"
              color={COLORS.error ?? '#d94545'}
            />
            <Card
              icon={<TrendingUp size={14} />}
              value={`${stats.successRate.toFixed(0)}%`}
              label="Success rate"
              color={COLORS.accent}
            />
            <Card
              icon={<Clock size={14} />}
              value={fmtDuration(stats.totalSec)}
              label="Total print time"
            />
            <Card
              icon={<Clock size={14} />}
              value={fmtDuration(stats.avgSec)}
              label="Avg per print"
            />
            <Card
              icon={<Package size={14} />}
              value={fmtMoney(costSummary.totals.totalCost)}
              label="Total cost"
              color={COLORS.accent}
            />
            <Card
              icon={<Package size={14} />}
              value={fmtMoney(costSummary.totals.filamentCost)}
              label="Filament"
              hint={fmtWeight(costSummary.totals.filamentG)}
            />
            <Card
              icon={<Zap size={14} />}
              value={`${costSummary.totals.energyKwh.toFixed(2)} kWh`}
              label="Energy"
              hint={fmtMoney(costSummary.totals.energyCost)}
            />
            <Card
              icon={<Leaf size={14} />}
              value={`${costSummary.totals.co2Kg.toFixed(2)} kg`}
              label="CO2 estimate"
            />
          </div>

          {liveEstimate && (
            <div className="duet-analytics__receipt duet-analytics__receipt--live">
              <div>
                <div className="duet-analytics__receipt-title">
                  <Receipt size={12} /> Live cost ticker
                </div>
                <div className="duet-analytics__receipt-file" title={liveEstimate.job.file}>{liveEstimate.job.file}</div>
              </div>
              <div className="duet-analytics__receipt-grid">
                <span>{fmtDuration(liveEstimate.durationSec)}</span>
                <span>{fmtWeight(liveEstimate.filamentG)}</span>
                <span>{liveEstimate.energyKwh.toFixed(2)} kWh</span>
                <strong>{fmtMoney(liveEstimate.totalCost)}</strong>
              </div>
            </div>
          )}

          {analytics.insights.length > 0 && (
            <>
              <div className="duet-analytics__section-title">
                <AlertTriangle size={11} /> Patterns
              </div>
              <div className="duet-analytics__insights">
                {analytics.insights.map((insight) => (
                  <div className="duet-analytics__insight" key={insight.title}>
                    <div className="duet-analytics__insight-title">{insight.title}</div>
                    <div className="duet-analytics__insight-detail">{insight.detail}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Jobs-per-day sparkline */}
          <div className="duet-analytics__section-title">Jobs per day</div>
          <div className="duet-analytics__sparkline" role="img" aria-label="Jobs per day bar chart">
            {spark.map((d, i) => (
              <div
                key={i}
                className="duet-analytics__spark-col"
                title={`${d.label}: ${d.value} job${d.value === 1 ? '' : 's'}`}
              >
                <div
                  className="duet-analytics__spark-bar"
                  style={{ height: `${(d.value / sparkMax) * 100}%` }}
                />
              </div>
            ))}
          </div>

          {/* Top files */}
          <div className="duet-analytics__section-title">
            <Award size={11} /> Most-printed files
          </div>
          <table className="duet-analytics__table">
            <thead>
              <tr>
                <th>File</th>
                <th>Runs</th>
                <th>Total time</th>
              </tr>
            </thead>
            <tbody>
              {stats.topFiles.length === 0 && (
                <tr><td colSpan={3} className="duet-analytics__empty-row">No jobs in window.</td></tr>
              )}
              {stats.topFiles.map(([file, v]) => (
                <tr key={file}>
                  <td title={file} className="duet-analytics__file-cell">{file}</td>
                  <td>{v.count}</td>
                  <td>{fmtDuration(v.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="duet-analytics__section-title">
            <Receipt size={11} /> Cost rollups
          </div>
          <CostRollupTable rows={costSummary.byProject.slice(0, 5)} empty="No project cost data in window." label="Projects" />
          <CostRollupTable rows={costSummary.byMaterial.slice(0, 5)} empty="No filament cost data in window." label="Filament" />
          <CostRollupTable rows={costSummary.byPrinter.slice(0, 5)} empty="No printer cost data in window." label="Printers" />
          <CostRollupTable rows={costSummary.byMonth.slice(0, 12)} empty="No monthly sustainability data in window." label="Months" />
          <CostRollupTable rows={costSummary.byPrinterMonth.slice(0, 12)} empty="No printer-month sustainability data in window." label="Printer months" />

          <div className="duet-analytics__section-title">
            <AlertTriangle size={11} /> Failure patterns
          </div>
          <PatternTable groups={analytics.byFile.filter((group) => group.total >= 2).slice(0, 5)} empty="No repeated file patterns in window." />
          <PatternTable groups={analytics.byProfile.filter((group) => group.total >= 2).slice(0, 5)} empty="No profile metadata found in history." label="Profiles" />
          <PatternTable groups={analytics.byMaterial.filter((group) => group.total >= 2).slice(0, 5)} empty="No material metadata found in history." label="Materials" />

          {/* Recent jobs */}
          <div className="duet-analytics__section-title">Recent jobs</div>
          <table className="duet-analytics__table">
            <thead>
              <tr>
                <th>Started</th>
                <th>File</th>
                <th>Duration</th>
                <th>Receipt</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobsInWindow.slice(0, 20).map((j, i) => {
                const receipt = recentEstimatesByJob.get(printJobCostKey(j));
                return (
                  <tr key={printJobCostKey(j) || `${j.file}-${i}`}>
                    <td>{fmtDate(j.startedAt)} {j.startedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="duet-analytics__file-cell" title={j.file}>{j.file}</td>
                    <td>{fmtDuration(receipt?.durationSec ?? j.durationSec)}</td>
                    <td>
                      {receipt ? `${fmtMoney(receipt.totalCost)} · ${fmtWeight(receipt.filamentG)} · ${receipt.energyKwh.toFixed(2)} kWh` : '--'}
                    </td>
                    <td>
                      <span className={`duet-analytics__status duet-analytics__status--${j.outcome}`}>
                        {j.outcome}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Cost config */}
          <div className="duet-analytics__cost">
            <label>
              Printer draw
              <input
                type="number"
                min={0}
                step={10}
                value={printerWatts}
                onChange={(e) => saveNumber('cindr3d-cost-watts', Number(e.target.value), setPrinterWatts)}
              />
              <span>W</span>
            </label>
            <label>
              Rate
              <input
                type="number"
                min={0}
                step={0.01}
                value={electricityRate}
                onChange={(e) => saveNumber('cindr3d-cost-rate', Number(e.target.value), setElectricityRate)}
              />
              <span>$/kWh</span>
            </label>
            <label>
              Filament
              <input
                type="number"
                min={0}
                step={1}
                value={filamentGPerHour}
                onChange={(e) => saveNumber('cindr3d-cost-filament-gph', Number(e.target.value), setFilamentGPerHour)}
              />
              <span>g/h</span>
            </label>
            <label>
              CO2
              <input
                type="number"
                min={0}
                step={0.01}
                value={co2KgPerKwh}
                onChange={(e) => saveNumber('cindr3d-cost-co2', Number(e.target.value), setCo2KgPerKwh)}
              />
              <span>kg/kWh</span>
            </label>
            <span className="duet-analytics__cost-value">
              {fmtMoney(costSummary.totals.totalCost)} over {windowDays} days
            </span>
          </div>
        </>
      )}

      <div className="duet-analytics__tou">
        <div className="duet-analytics__section-title">
          <CalendarPlus size={11} /> Off-peak scheduling
        </div>

        <div className="duet-analytics__tou-grid">
          <div className="duet-analytics__tou-panel">
            <div className="duet-analytics__tou-heading">{planningPrinterName} TOU windows</div>
            <div className="duet-analytics__tou-form">
              <input
                type="text"
                value={touLabel}
                onChange={(e) => setTouLabel(e.target.value)}
                placeholder="Window label"
              />
              <select value={touTier} onChange={(e) => setTouTier(e.target.value as TOUTier)}>
                {Object.entries(TIER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={0.01}
                value={touRate}
                onChange={(e) => setTouRate(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Rate per kWh"
              />
              <span>$/kWh</span>
              <input type="time" value={touStart} onChange={(e) => setTouStart(e.target.value)} />
              <input type="time" value={touEnd} onChange={(e) => setTouEnd(e.target.value)} />
            </div>
            <div className="duet-analytics__day-chips">
              {DAY_LABELS.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className={touDays.includes(index as DayOfWeek) ? 'active' : ''}
                  onClick={() => toggleTouDay(index as DayOfWeek)}
                >
                  {day.slice(0, 2)}
                </button>
              ))}
              <button type="button" className="duet-analytics__tou-add" onClick={addTouRateWindow}>
                Add
              </button>
            </div>

            <div className="duet-analytics__tou-list">
              {printerTouWindows.length === 0 && (
                <div className="duet-analytics__empty-row">No TOU windows configured for this printer.</div>
              )}
              {printerTouWindows.map((window) => (
                <div key={window.id} className={`duet-analytics__tou-row duet-analytics__tou-row--${window.tier}`}>
                  <span>{window.label}</span>
                  <span>{TIER_LABELS[window.tier]}</span>
                  <span>{fmtMoney(window.ratePerKwh)}/kWh</span>
                  <span>{String(window.startHour).padStart(2, '0')}:{String(window.startMinute).padStart(2, '0')} - {String(window.endHour).padStart(2, '0')}:{String(window.endMinute).padStart(2, '0')}</span>
                  <button type="button" onClick={() => removeTOUWindow(window.id)} title="Remove TOU window">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="duet-analytics__tou-panel">
            <div className="duet-analytics__tou-heading">Cheapest-window planner</div>
            <div className="duet-analytics__planner">
              <input
                type="text"
                value={plannerFilePath}
                onChange={(e) => setPlannerFilePath(e.target.value)}
                placeholder="0:/gcodes/file.gcode"
              />
              <label>
                Duration
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={plannerDurationHours}
                  onChange={(e) => setPlannerDurationHours(Math.max(0, Number(e.target.value) || 0))}
                />
                h
              </label>
            </div>
            <div className="duet-analytics__planner-result">
              {cheapestWindow ? (
                <>
                  <strong>{fmtLocalDateTime(cheapestWindow.start)}</strong>
                  <span>{cheapestWindow.label} · {fmtMoney(cheapestWindow.ratePerKwh)}/kWh · est. {fmtMoney(cheapestWindow.estimatedEnergyCost)}</span>
                </>
              ) : (
                <span>No valid start window found.</span>
              )}
            </div>
            <button
              type="button"
              className="duet-analytics__schedule-btn"
              onClick={scheduleCheapestPrint}
              disabled={!plannerFilePath.trim() || !cheapestWindow}
            >
              <CalendarPlus size={12} /> Schedule cheapest start
            </button>

            <div className="duet-analytics__utility-config">
              <label>
                <input
                  type="checkbox"
                  checked={utilityConfig?.enabled ?? false}
                  onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { enabled: e.target.checked })}
                  disabled={!planningPrinterId}
                />
                Utility API
              </label>
              <input
                type="url"
                value={utilityConfig?.url ?? ''}
                onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { url: e.target.value })}
                placeholder="https://utility.example/rates"
                disabled={!planningPrinterId}
              />
              <select
                value={utilityConfig?.format ?? 'json'}
                onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { format: e.target.value as 'json' | 'csv' })}
                disabled={!planningPrinterId}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
              <input
                type="text"
                value={utilityConfig?.ratePath ?? 'rates'}
                onChange={(e) => planningPrinterId && upsertUtilityRateConfig(planningPrinterId, { ratePath: e.target.value })}
                placeholder="rate path"
                disabled={!planningPrinterId}
              />
            </div>
          </div>

          <div className="duet-analytics__tou-panel">
            <div className="duet-analytics__tou-heading">Solar-aware gate</div>
            <div className={`duet-analytics__solar-gate${solarGate?.allowed ? ' allowed' : ' blocked'}`}>
              <Leaf size={14} />
              <div>
                <strong>{solarGate?.allowed ? 'Ready on surplus' : 'Waiting for surplus'}</strong>
                <span>{solarGate?.reason ?? 'Select a printer to configure solar gating.'}</span>
              </div>
            </div>
            <div className="duet-analytics__utility-config">
              <label>
                <input
                  type="checkbox"
                  checked={solarConfig?.enabled ?? false}
                  onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { enabled: e.target.checked })}
                  disabled={!planningPrinterId}
                />
                Solar gate
              </label>
              <select
                value={solarConfig?.provider ?? 'custom'}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { provider: e.target.value as SolarProvider })}
                disabled={!planningPrinterId}
              >
                {Object.entries(SOLAR_PROVIDER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                type="url"
                value={solarConfig?.endpointUrl ?? ''}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { endpointUrl: e.target.value })}
                placeholder="Solar API URL"
                disabled={!planningPrinterId}
              />
              <input
                type="password"
                value={solarConfig?.apiKey ?? ''}
                onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, { apiKey: e.target.value })}
                placeholder="API key"
                disabled={!planningPrinterId}
              />
            </div>
            <div className="duet-analytics__planner">
              <label>
                Current surplus
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={solarConfig?.currentSurplusW ?? 0}
                  onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, {
                    currentSurplusW: Math.max(0, Number(e.target.value) || 0),
                    lastReadAt: Date.now(),
                  })}
                  disabled={!planningPrinterId}
                />
                W
              </label>
              <label>
                Minimum
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={solarConfig?.minSurplusW ?? 500}
                  onChange={(e) => planningPrinterId && upsertSolarIntegrationConfig(planningPrinterId, {
                    minSurplusW: Math.max(0, Number(e.target.value) || 0),
                  })}
                  disabled={!planningPrinterId}
                />
                W
              </label>
            </div>
            <div className="duet-analytics__planner-result">
              <strong>{solarGate ? `${solarGate.surplusW.toFixed(0)} W / ${solarGate.requiredW.toFixed(0)} W` : '--'}</strong>
              <span>{solarConfig?.lastReadAt ? `Last surplus read ${fmtLocalDateTime(solarConfig.lastReadAt)}` : 'No live surplus reading yet.'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatternTable({
  groups,
  empty,
  label,
}: {
  groups: PrintHistoryGroup[];
  empty: string;
  label?: string;
}) {
  return (
    <table className="duet-analytics__table duet-analytics__table--compact">
      {label && (
        <caption className="duet-analytics__caption">{label}</caption>
      )}
      <thead>
        <tr>
          <th>Name</th>
          <th>Runs</th>
          <th>Failures</th>
          <th>Last working</th>
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 && (
          <tr><td colSpan={4} className="duet-analytics__empty-row">{empty}</td></tr>
        )}
        {groups.map((group) => (
          <tr key={group.key}>
            <td className="duet-analytics__file-cell" title={group.label}>{group.label}</td>
            <td>{group.total}</td>
            <td>{group.failureRate.toFixed(0)}%</td>
            <td className="duet-analytics__file-cell" title={group.lastSuccess?.profile ?? group.lastSuccess?.material ?? undefined}>
              {group.lastSuccess?.profile ?? group.lastSuccess?.material ?? '--'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CostRollupTable({
  rows,
  empty,
  label,
}: {
  rows: PrintCostRollup[];
  empty: string;
  label: string;
}) {
  return (
    <table className="duet-analytics__table duet-analytics__table--compact">
      <caption className="duet-analytics__caption">{label}</caption>
      <thead>
        <tr>
          <th>Name</th>
          <th>Runs</th>
          <th>Filament</th>
          <th>Energy</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={5} className="duet-analytics__empty-row">{empty}</td></tr>
        )}
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="duet-analytics__file-cell" title={row.label}>{row.label}</td>
            <td>{row.runs}</td>
            <td>{fmtWeight(row.filamentG)}</td>
            <td>{row.energyKwh.toFixed(2)} kWh</td>
            <td>{fmtMoney(row.totalCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Card({
  icon, value, label, color, hint,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="duet-analytics__card">
      <div className="duet-analytics__card-icon" style={color ? { color } : undefined}>{icon}</div>
      <div>
        <div className="duet-analytics__card-value">{value}</div>
        <div className="duet-analytics__card-label">
          {label}
          {hint && <span className="duet-analytics__card-hint"> · {hint}</span>}
        </div>
      </div>
    </div>
  );
}

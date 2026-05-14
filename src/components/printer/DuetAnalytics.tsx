import { useMemo, useState } from 'react';
import { useNow } from '../../hooks/useNow';
import {
  TrendingUp, Clock, Package, CheckCircle2, XCircle, Calendar,
  Award, Activity, Info, AlertTriangle, Zap, Leaf, Receipt, Download,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  useSchedulingStore,
} from '../../store/schedulingStore';
import { useSpoolStore } from '../../store/spoolStore';
import { buildPrintHistoryAnalytics } from '../../utils/printHistoryAnalytics';
import {
  effectiveJobDurationSec,
  exportPrintCostSummaryCsv,
  exportPrintCostSummaryJson,
  printJobCostKey,
  summarizePrintCosts,
} from '../../utils/printCost';
import { colors as COLORS } from '../../utils/theme';
import {
  downloadText,
  fmtDate,
  fmtDuration,
  fmtMoney,
  fmtWeight,
  localDateKey,
  parseTimestamp,
  readStoredNumber,
  topN,
} from './duetAnalytics/helpers';
import { Card } from './duetAnalytics/Card';
import { CostConfigInputs } from './duetAnalytics/CostConfigInputs';
import { CostRollupTable } from './duetAnalytics/CostRollupTable';
import { OffPeakSchedulingSection } from './duetAnalytics/OffPeakSchedulingSection';
import { PatternTable } from './duetAnalytics/PatternTable';
import { RecentJobsTable } from './duetAnalytics/RecentJobsTable';

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
  const nowMs = useNow(15000);

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
    [jobsInWindow, spools, printerWatts, electricityRate, rateAt, planningPrinterId, filamentGPerHour, co2KgPerKwh, nowMs],
  );
  const liveEstimate = costSummary.estimates.find((estimate) => estimate.job.outcome === 'in-progress') ?? null;
  const recentEstimatesByJob = useMemo(() => {
    const map = new Map<string, typeof costSummary.estimates[number]>();
    for (const estimate of costSummary.estimates) {
      map.set(printJobCostKey(estimate.job), estimate);
    }
    return map;
  }, [costSummary]);
  const onWindowChange = (v: number) => {
    setWindowDays(v);
    try { localStorage.setItem('cindr3d-analytics-window', String(v)); } catch { /* ignore */ }
  };

  const exportCsv = () => {
    downloadText(`cindr3d-cost-energy-${windowDays}d.csv`, exportPrintCostSummaryCsv(costSummary), 'text/csv;charset=utf-8');
  };

  const exportJson = () => {
    downloadText(`cindr3d-cost-energy-${windowDays}d.json`, exportPrintCostSummaryJson(costSummary), 'application/json;charset=utf-8');
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

          <RecentJobsTable jobs={jobsInWindow} receiptsByJob={recentEstimatesByJob} />

          <CostConfigInputs
            printerWatts={printerWatts}
            setPrinterWatts={setPrinterWatts}
            electricityRate={electricityRate}
            setElectricityRate={setElectricityRate}
            filamentGPerHour={filamentGPerHour}
            setFilamentGPerHour={setFilamentGPerHour}
            co2KgPerKwh={co2KgPerKwh}
            setCo2KgPerKwh={setCo2KgPerKwh}
            totalCost={costSummary.totals.totalCost}
            windowDays={windowDays}
          />
        </>
      )}

      <OffPeakSchedulingSection
        planningPrinterId={planningPrinterId}
        planningPrinterName={planningPrinterName}
        printerTouWindows={printerTouWindows}
        utilityConfig={utilityConfig}
        solarConfig={solarConfig}
        printerWatts={printerWatts}
        nowMs={nowMs}
        addTOUWindow={addTOUWindow}
        removeTOUWindow={removeTOUWindow}
        upsertUtilityRateConfig={upsertUtilityRateConfig}
        upsertSolarIntegrationConfig={upsertSolarIntegrationConfig}
        schedulePrintAtCheapestWindow={schedulePrintAtCheapestWindow}
        findCheapestStart={findCheapestStart}
        canStartWithSolarSurplus={canStartWithSolarSurplus}
      />
    </div>
  );
}


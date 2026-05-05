import { useMemo, useState } from 'react';
import {
  TrendingUp, Clock, Package, CheckCircle2, XCircle, Calendar,
  Award, Activity, Info, AlertTriangle,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import type { PrintHistoryEntry } from '../../store/printerStore';
import { buildPrintHistoryAnalytics, type PrintHistoryGroup } from '../../utils/printHistoryAnalytics';
import { colors as COLORS } from '../../utils/theme';

// ---------------------------------------------------------------------------
// Parsing & aggregation
// ---------------------------------------------------------------------------

interface JobRow {
  file: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  outcome: 'completed' | 'cancelled' | 'in-progress';
}

function parseTimestamp(ts: string): Date | null {
  // "YYYY-MM-DD HH:MM:SS" — convert to ISO. Locale-free so Safari is happy.
  const iso = ts.replace(' ', 'T');
  const d = new Date(iso);
  return isFinite(d.getTime()) ? d : null;
}

// Pair each `start` entry with the nearest subsequent `finish` or `cancel`.
// Entries are in chronological order (oldest first).
function buildJobs(history: PrintHistoryEntry[]): JobRow[] {
  const jobs: JobRow[] = [];
  const openByFile = new Map<string, JobRow>();

  for (const e of history) {
    const when = parseTimestamp(e.timestamp);
    if (!when) continue;
    const key = e.file ?? '';

    if (e.kind === 'start') {
      openByFile.set(key, {
        file: key || '(unknown)',
        startedAt: when,
        endedAt: null,
        durationSec: 0,
        outcome: 'in-progress',
      });
    } else if (e.kind === 'finish' || e.kind === 'cancel') {
      // Prefer matching by file name, otherwise close the most recent open job.
      let job = openByFile.get(key);
      if (!job && openByFile.size > 0) {
        // Fallback: close the most recently opened job regardless of file.
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
      job.durationSec = e.durationSec ?? Math.max(0, Math.floor(duration));
      job.outcome = e.kind === 'finish' ? 'completed' : 'cancelled';
      jobs.push(job);
    }
  }
  for (const job of openByFile.values()) jobs.push(job);
  // Most recent first.
  jobs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return jobs;
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

function topN<T>(arr: T[], n: number, key: (x: T) => number): T[] {
  return [...arr].sort((a, b) => key(b) - key(a)).slice(0, n);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetAnalytics() {
  const history = usePrinterStore((s) => s.printHistory);
  const loading = usePrinterStore((s) => s.printHistoryLoading);
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);

  const [windowDays, setWindowDays] = useState<number>(() => {
    const saved = Number(localStorage.getItem('cindr3d-analytics-window'));
    return isFinite(saved) && saved > 0 ? saved : 30;
  });
  const [hourlyCost, setHourlyCost] = useState<number>(() => {
    const saved = Number(localStorage.getItem('cindr3d-analytics-hourly'));
    return isFinite(saved) && saved >= 0 ? saved : 0;
  });

  const activePrinterName = useMemo(
    () => printers.find((printer) => printer.id === activePrinterId)?.name ?? 'Current printer',
    [printers, activePrinterId],
  );
  const analytics = useMemo(
    () => buildPrintHistoryAnalytics(history, activePrinterName),
    [history, activePrinterName],
  );
  const jobs = useMemo(() => buildJobs(history), [history]);

  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - windowDays);
    return d;
  }, [windowDays]);

  const jobsInWindow = useMemo(
    () => jobs.filter((j) => j.startedAt >= cutoff),
    [jobs, cutoff],
  );

  const stats = useMemo(() => {
    let completed = 0;
    let cancelled = 0;
    let totalSec = 0;
    const byFile = new Map<string, { count: number; time: number }>();
    const byDay = new Map<string, number>();
    for (const j of jobsInWindow) {
      if (j.outcome === 'completed') completed++;
      if (j.outcome === 'cancelled') cancelled++;
      totalSec += j.durationSec;
      const f = byFile.get(j.file) ?? { count: 0, time: 0 };
      f.count++;
      f.time += j.durationSec;
      byFile.set(j.file, f);
      const day = j.startedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const total = completed + cancelled;
    const successRate = total > 0 ? (completed / total) * 100 : 0;
    const avgSec = completed > 0 ? totalSec / completed : 0;
    const topFiles = topN([...byFile.entries()], 5, ([, v]) => v.count);
    return { completed, cancelled, total, successRate, totalSec, avgSec, topFiles, byDay };
  }, [jobsInWindow]);

  // Build a 14-column (or windowDays) spark bar of jobs/day.
  const spark = useMemo(() => {
    const arr: { label: string; value: number }[] = [];
    const now = new Date();
    const days = Math.min(windowDays, 30);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      arr.push({ label: fmtDate(d), value: stats.byDay.get(key) ?? 0 });
    }
    return arr;
  }, [stats.byDay, windowDays]);

  const sparkMax = Math.max(1, ...spark.map((s) => s.value));

  const hours = stats.totalSec / 3600;
  const totalCost = hours * hourlyCost;

  const onWindowChange = (v: number) => {
    setWindowDays(v);
    try { localStorage.setItem('cindr3d-analytics-window', String(v)); } catch { /* ignore */ }
  };

  const onHourlyChange = (v: number) => {
    setHourlyCost(v);
    try { localStorage.setItem('cindr3d-analytics-hourly', String(v)); } catch { /* ignore */ }
  };

  return (
    <div className="duet-analytics">
      <div className="duet-analytics__toolbar">
        <div className="duet-analytics__toolbar-title">
          <TrendingUp size={14} /> Print statistics
        </div>
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
              value={hourlyCost > 0 ? `$${totalCost.toFixed(2)}` : '—'}
              label="Operating cost"
              hint={hourlyCost === 0 ? 'set $/h below' : undefined}
            />
          </div>

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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {jobsInWindow.slice(0, 20).map((j, i) => (
                <tr key={`${j.file}-${i}`}>
                  <td>{fmtDate(j.startedAt)} {j.startedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="duet-analytics__file-cell" title={j.file}>{j.file}</td>
                  <td>{fmtDuration(j.durationSec)}</td>
                  <td>
                    <span className={`duet-analytics__status duet-analytics__status--${j.outcome}`}>
                      {j.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Cost config */}
          <div className="duet-analytics__cost">
            <label>
              Hourly operating cost:
              <input
                type="number"
                min={0}
                step={0.5}
                value={hourlyCost}
                onChange={(e) => onHourlyChange(Math.max(0, Number(e.target.value) || 0))}
              />
              <span>$/h</span>
            </label>
            <span className="duet-analytics__cost-value">
              = ${totalCost.toFixed(2)} over {windowDays} days
            </span>
          </div>
        </>
      )}
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

/**
 * JobsPerDaySparkline — the jobs/day bar chart. Bars cap at 30 columns
 * even on a long window so the strip stays scannable.
 *
 * Receives the by-day count map (built once on the host) plus the
 * current window size; computes its own column list + max-scale so
 * the strip can stand on its own.
 */
import { useMemo } from 'react';
import { fmtDate, localDateKey } from './helpers';

export interface JobsPerDaySparklineProps {
  byDay: Map<string, number>;
  windowDays: number;
}

export function JobsPerDaySparkline({ byDay, windowDays }: JobsPerDaySparklineProps) {
  const spark = useMemo(() => {
    const arr: { label: string; value: number }[] = [];
    const now = new Date();
    const days = Math.min(windowDays, 30);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      arr.push({ label: fmtDate(d), value: byDay.get(key) ?? 0 });
    }
    return arr;
  }, [byDay, windowDays]);

  const sparkMax = Math.max(1, ...spark.map((s) => s.value));

  return (
    <>
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
    </>
  );
}

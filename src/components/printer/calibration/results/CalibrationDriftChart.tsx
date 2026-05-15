import { useId, useMemo, useState } from 'react';
import './CalibrationDriftChart.css';

export interface CalibrationDriftPoint {
  value: number;
  recordedAt: number;
}

export interface CalibrationDriftChartProps {
  /**
   * Already-filtered series — caller drops nulls and orders oldest first,
   * newest last. We don't re-sort here so callers stay in control of order.
   */
  points: CalibrationDriftPoint[];
  /** Short axis-style label, e.g. "PA", "Z-offset (mm)", "°C". */
  valueLabel: string;
  width?: number;
  height?: number;
}

/** Threshold below which the variation is treated as flat (no real drift). */
const STABLE_RATIO = 0.05;
/** Absolute floor used when the median is ~0, so we don't divide by zero. */
const STABLE_FLOOR = 1e-4;

function formatTooltipDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatValue(v: number): string {
  return Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2);
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Drift sparkline for a calibration metric across past runs.
 *
 * - Pure SVG (no chart lib).
 * - Renders nothing for fewer than 2 numeric points (no trend yet).
 * - Renders a flat baseline + "stable" pill when the spread between min and
 *   max is below ~5% of the median, so users don't read drift into noise.
 * - Line + dots, with a tooltip on hover for each point (date + value).
 */
export function CalibrationDriftChart({
  points,
  valueLabel,
  width = 220,
  height = 56,
}: CalibrationDriftChartProps) {
  const tooltipId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.value);
    const sortedAsc = [...values].sort((a, b) => a - b);
    const min = sortedAsc[0];
    const max = sortedAsc[sortedAsc.length - 1];
    const med = median(sortedAsc);
    const spread = Math.abs(max - min);
    const denom = Math.max(Math.abs(med), STABLE_FLOOR);
    const stable = spread / denom < STABLE_RATIO;
    return { min, max, med, spread, stable };
  }, [points]);

  if (points.length < 2 || !stats) return null;

  // Layout: leave a right-edge gutter for the current-value chip.
  const padX = 6;
  const padY = 6;
  const chipWidth = 56;
  const plotLeft = padX;
  const plotRight = width - chipWidth - padX;
  const plotTop = padY;
  const plotBottom = height - padY;
  const plotW = Math.max(plotRight - plotLeft, 1);
  const plotH = Math.max(plotBottom - plotTop, 1);

  const last = points[points.length - 1];
  const currentLabel = formatValue(last.value);

  // X positions evenly spaced; Y mapped between min and max with a small
  // vertical inset so dots don't sit on the edge.
  const yRange = stats.stable ? 1 : Math.max(stats.max - stats.min, STABLE_FLOOR);
  const xOf = (i: number) => {
    if (points.length === 1) return plotLeft;
    return plotLeft + (i / (points.length - 1)) * plotW;
  };
  const yOf = (v: number) => {
    if (stats.stable) return plotTop + plotH / 2;
    const t = (v - stats.min) / yRange;
    // Higher value -> smaller y (top of SVG).
    return plotBottom - t * plotH;
  };

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(p.value).toFixed(2)}`)
    .join(' ');

  const gridYs = stats.stable
    ? [plotTop + plotH / 2]
    : [yOf(stats.max), yOf(stats.med), yOf(stats.min)];

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="calib-results__chart" role="img" aria-label={`${valueLabel} drift chart`}>
      <svg
        className="calib-results__chart-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="presentation"
      >
        {gridYs.map((y, i) => (
          <line
            key={i}
            className="calib-results__chart-grid"
            x1={plotLeft}
            x2={plotRight}
            y1={y}
            y2={y}
          />
        ))}
        <path className="calib-results__chart-line" d={linePath} fill="none" />
        {points.map((p, i) => {
          const cx = xOf(i);
          const cy = yOf(p.value);
          const active = hoverIdx === i;
          return (
            <g key={`${p.recordedAt}-${i}`}>
              <circle
                className={
                  active
                    ? 'calib-results__chart-dot calib-results__chart-dot--active'
                    : 'calib-results__chart-dot'
                }
                cx={cx}
                cy={cy}
                r={active ? 3.2 : 2.2}
              />
              {/* Larger transparent hit-target for easier hover. */}
              <circle
                className="calib-results__chart-hit"
                cx={cx}
                cy={cy}
                r={Math.max(plotW / Math.max(points.length - 1, 1) / 2, 6)}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                onFocus={() => setHoverIdx(i)}
                onBlur={() => setHoverIdx((cur) => (cur === i ? null : cur))}
                tabIndex={0}
                aria-describedby={tooltipId}
              >
                <title>{`${formatTooltipDate(p.recordedAt)} — ${formatValue(p.value)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="calib-results__chart-side">
        {stats.stable ? (
          <span className="calib-results__chart-pill" title="Spread under 5% of median — values are stable.">
            stable
          </span>
        ) : (
          <span className="calib-results__chart-current" title={`Latest ${valueLabel || 'value'}`}>
            <span className="calib-results__chart-current-value">{currentLabel}</span>
            {valueLabel && (
              <span className="calib-results__chart-current-label">{valueLabel}</span>
            )}
          </span>
        )}
      </div>
      {hoverPoint && (
        <div
          id={tooltipId}
          className="calib-results__chart-tooltip"
          role="tooltip"
        >
          <span className="calib-results__chart-tooltip-date">
            {formatTooltipDate(hoverPoint.recordedAt)}
          </span>
          <span className="calib-results__chart-tooltip-value">
            {formatValue(hoverPoint.value)}
            {valueLabel && <span className="calib-results__chart-tooltip-unit"> {valueLabel}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

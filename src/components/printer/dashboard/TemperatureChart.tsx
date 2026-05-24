import { useCallback, useMemo } from "react";
import type { TemperatureSample } from "../../../types/duet";
import { colors as COLORS } from "../../../utils/theme";
import type { HeaterRow } from "./helpers";
import { heaterRowColor, heaterRowKey } from "./temperaturePanelHelpers";

interface TemperatureChartProps {
  rows: HeaterRow[];
  temperatureHistory: TemperatureSample[];
  heaters: { current: number; active: number; standby: number; state: string }[];
}

export function TemperatureChart({
  rows,
  temperatureHistory,
  heaters,
}: TemperatureChartProps) {
  const W = 600;
  const H = 190;
  const legendWidth = rows.length > 0 ? 136 : 0;
  const padTop = 14;
  const padRight = legendWidth + 10;
  const padBottom = 28;
  const padLeft = 42;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const history = temperatureHistory.filter((sample) => sample.heaters?.length);
  const allTemps: number[] = [];
  history.forEach((sample) => {
    sample.heaters?.forEach((heater) => {
      allTemps.push(heater.current);
      if (heater.active > 0) allTemps.push(heater.active);
      if (heater.standby > 0) allTemps.push(heater.standby);
    });
  });
  heaters.forEach((heater) => {
    allTemps.push(heater.current);
    if (heater.active > 0) allTemps.push(heater.active);
    if (heater.standby > 0) allTemps.push(heater.standby);
  });

  const maxTemp = Math.ceil((Math.max(50, ...allTemps) + 10) / 10) * 10;
  const minTemp = 0;
  const lastSampleTime = history.at(-1)?.timestamp ?? 0;
  const firstSampleTime = history[0]?.timestamp ?? lastSampleTime;
  const visibleWindowMs = 10 * 60 * 1000;
  const tEnd = lastSampleTime;
  const tStart = Math.max(firstSampleTime, tEnd - visibleWindowMs);
  const visibleHistory = history.filter((sample) => sample.timestamp >= tStart);
  const tRange = Math.max(tEnd - tStart, 1);

  const xScale = useCallback(
    (timestamp: number) => padLeft + ((timestamp - tStart) / tRange) * plotW,
    [padLeft, plotW, tRange, tStart],
  );

  const yScale = useCallback(
    (v: number) => padTop + plotH - ((v - minTemp) / (maxTemp - minTemp)) * plotH,
    [padTop, plotH, minTemp, maxTemp],
  );

  const lines = useMemo(() => {
    const result: { id: string; index: number; color: string; points: string }[] = [];
    rows.forEach((row) => {
      const pts: string[] = [];
      visibleHistory.forEach((sample) => {
        const heater = sample.heaters?.find((item) => item.index === row.index);
        if (heater) {
          pts.push(`${xScale(sample.timestamp).toFixed(1)},${yScale(heater.current).toFixed(1)}`);
        }
      });
      if (pts.length > 0) {
        result.push({
          id: heaterRowKey(row),
          index: row.index,
          color: heaterRowColor(row),
          points: pts.join(" "),
        });
      }
    });
    return result;
  }, [rows, visibleHistory, xScale, yScale]);

  const latestPoints = useMemo(() => {
    const latest = visibleHistory.at(-1);
    if (!latest) return [];
    return rows.flatMap((row) => {
      const heater = latest.heaters?.find((item) => item.index === row.index);
      if (!heater) return [];
      return [{
        id: heaterRowKey(row),
        index: row.index,
        color: heaterRowColor(row),
        x: xScale(latest.timestamp),
        y: yScale(heater.current),
      }];
    });
  }, [rows, visibleHistory, xScale, yScale]);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = maxTemp <= 100 ? 20 : maxTemp <= 200 ? 50 : 100;
    for (let v = 0; v <= maxTemp; v += step) ticks.push(v);
    return ticks;
  }, [maxTemp]);

  const xTicks = useMemo(() => {
    const tickCount = 4;
    return Array.from({ length: tickCount + 1 }, (_, i) => {
      const timestamp = tStart + (tRange / tickCount) * i;
      const secondsAgo = Math.max(0, Math.round((tEnd - timestamp) / 1000));
      const label = secondsAgo < 60 ? `-${secondsAgo}s` : `-${Math.round(secondsAgo / 60)}m`;
      return { timestamp, label: i === tickCount ? "now" : label };
    });
  }, [tEnd, tRange, tStart]);

  if (rows.length === 0 || heaters.length === 0) {
    return (
      <div className="duet-dash-tempchart-empty">
        No heaters reported by this printer yet.
      </div>
    );
  }

  const legendX = W - legendWidth + 4;
  const legendRowH = 15;

  return (
    <div className="duet-dash-tempchart-shell">
      <div className="duet-dash-tempchart-meta">
        <span>Live temperature history</span>
        <span>{visibleHistory.length} samples / 10 min</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="duet-dash-tempchart">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padLeft} y1={yScale(v)} x2={W - padRight} y2={yScale(v)} stroke={COLORS.panelBorder} strokeWidth={0.5} />
            <text x={padLeft - 4} y={yScale(v) + 3} fill={COLORS.textDim} fontSize={9} textAnchor="end">{v}</text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <g key={tick.timestamp}>
            <line x1={xScale(tick.timestamp)} y1={padTop} x2={xScale(tick.timestamp)} y2={padTop + plotH} stroke={COLORS.panelBorder} strokeWidth={0.35} />
            <text x={xScale(tick.timestamp)} y={H - 9} fill={COLORS.textDim} fontSize={9} textAnchor="middle">{tick.label}</text>
          </g>
        ))}

        <line x1={padLeft} y1={padTop + plotH} x2={W - padRight} y2={padTop + plotH} stroke={COLORS.panelBorder} strokeWidth={0.8} />

        {lines.map((line) => (
          <polyline key={line.id} fill="none" stroke={line.color} strokeWidth={2} points={line.points} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {latestPoints.map((point) => (
          <circle
            key={`latest-${point.id}`}
            cx={point.x}
            cy={point.y}
            r={3}
            fill={point.color}
            stroke={COLORS.bg}
            strokeWidth={1.5}
          />
        ))}

        {rows.map((row) => {
          const heater = heaters[row.index];
          if (!heater?.active || heater.active <= 0) return null;
          const y = yScale(heater.active);
          const color = heaterRowColor(row);
          return (
            <line
              key={`target-${heaterRowKey(row)}`}
              x1={padLeft}
              y1={y}
              x2={W - padRight}
              y2={y}
              stroke={color}
              strokeWidth={0.8}
              strokeDasharray="4 5"
              opacity={0.55}
            />
          );
        })}

        {lines.length === 0 && (
          <text x={padLeft + plotW / 2} y={padTop + plotH / 2} fill={COLORS.textDim} fontSize={11} textAnchor="middle">
            Waiting for live temperature samples
          </text>
        )}

        {rows.map((row, i) => {
          const color = heaterRowColor(row);
          const current = heaters[row.index]?.current;
          const ly = padTop + 4 + i * legendRowH;
          return (
            <g key={heaterRowKey(row)}>
              <line x1={legendX} y1={ly + 4} x2={legendX + 14} y2={ly + 4} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
              <text x={legendX + 18} y={ly + 8} fill={COLORS.textDim} fontSize={9}>{row.label}</text>
              {current !== undefined && (
                <text x={W - 4} y={ly + 8} fill={color} fontSize={9} textAnchor="end" fontWeight="700">
                  {current.toFixed(1)}&deg;
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

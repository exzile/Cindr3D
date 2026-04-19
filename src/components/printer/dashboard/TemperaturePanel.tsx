import { Fragment, useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Thermometer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';
import {
  HEATER_CHART_COLORS,
  heaterStateColor,
  tempBarGradient,
  useHeaterRows,
  type HeaterRow,
} from './helpers';

export default function TemperaturePanel() {
  const model = usePrinterStore((s) => s.model);
  const temperatureHistory = usePrinterStore((s) => s.temperatureHistory);
  const setToolTemp = usePrinterStore((s) => s.setToolTemp);
  const setBedTemp = usePrinterStore((s) => s.setBedTemp);
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);
  const heaters = model.heat?.heaters ?? [];
  const rows = useHeaterRows();

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleTempSubmit = useCallback((row: HeaterRow, field: 'active' | 'standby') => {
    const key = `${row.index}-${field}`;
    const val = parseFloat(editingTemps[key] ?? '');
    if (isNaN(val)) return;
    if (row.kind === 'bed') {
      setBedTemp(val);
    } else if (row.kind === 'chamber') {
      setChamberTemp(val);
    } else if (row.kind === 'tool' && row.toolIndex !== undefined) {
      setToolTemp(row.toolIndex, row.heaterIndexInTool ?? 0, val);
    }
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, setBedTemp, setChamberTemp, setToolTemp]);

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Thermometer size={14} /> Temperatures
      </div>

      <div className="duet-dash-heater-grid">
        <span className="duet-dash-heater-col">Heater</span>
        <span className="duet-dash-heater-col">Current</span>
        <span className="duet-dash-heater-col">Active</span>
        <span className="duet-dash-heater-col">Standby</span>
        <span className="duet-dash-heater-col">Bar</span>
        <span className="duet-dash-heater-col">State</span>

        {rows.map((row) => {
          const h = heaters[row.index];
          if (!h) return null;
          const current = h.current;
          const activeKey = `${row.index}-active`;
          const standbyKey = `${row.index}-standby`;
          const barPct = Math.min(100, Math.max(0, (current / 300) * 100));

          return (
            <Fragment key={row.index}>
              <span
                className="duet-dash-heater-label"
                style={{ '--duet-heater-color': HEATER_CHART_COLORS[row.index % HEATER_CHART_COLORS.length] } as CSSProperties}
              >
                {row.label}
              </span>
              <span className="duet-dash-heater-current">{current.toFixed(1)}&deg;C</span>

              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[activeKey] ?? h.active.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'active')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(row, 'active'); }}
              />

              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[standbyKey] ?? h.standby.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'standby')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat(editingTemps[standbyKey] ?? '');
                    if (!isNaN(val) && row.kind === 'tool' && row.toolIndex !== undefined) {
                      usePrinterStore.getState().sendGCode(`G10 P${row.toolIndex} R${val}`);
                    }
                    setEditingTemps((prev) => { const n = { ...prev }; delete n[standbyKey]; return n; });
                  }
                }}
              />

              <div className="duet-dash-tempbar-wrap">
                <div style={{
                  height: '100%', width: `${barPct}%`, borderRadius: 4,
                  background: tempBarGradient(current),
                  transition: 'width 0.3s ease',
                }} />
              </div>

              <div
                className="duet-dash-heater-state"
                style={{
                  '--duet-heater-state': heaterStateColor(h.state),
                  '--duet-heater-glow': h.state !== 'off' ? `0 0 6px ${heaterStateColor(h.state)}` : 'none',
                } as CSSProperties}
                title={h.state}
              />
            </Fragment>
          );
        })}
      </div>

      <TemperatureChart rows={rows} temperatureHistory={temperatureHistory} heaters={heaters} />
    </div>
  );
}

function TemperatureChart({
  rows,
  temperatureHistory,
  heaters,
}: {
  rows: HeaterRow[];
  temperatureHistory: unknown[];
  heaters: { current: number; active: number; standby: number; state: string }[];
}) {
  const W = 600;
  const H = 160;
  // Reserve right space for the legend when heaters exist
  const LEGEND_W = rows.length > 0 ? 130 : 0;
  const PAD = { top: 10, right: LEGEND_W + 10, bottom: 20, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allTemps: number[] = [];
  const history = temperatureHistory as Array<{ timestamp: number; bed?: { current: number }; tools?: { current: number }[] }>;
  history.forEach((s) => {
    if (s.bed) allTemps.push(s.bed.current);
    s.tools?.forEach((t) => allTemps.push(t.current));
  });
  heaters.forEach((h) => { allTemps.push(h.current); allTemps.push(h.active); });
  const maxTemp = Math.max(50, ...allTemps) + 10;
  const minTemp = Math.max(0, Math.min(0, ...allTemps) - 5);

  const yScale = (v: number) => PAD.top + plotH - ((v - minTemp) / (maxTemp - minTemp)) * plotH;

  const lines = useMemo(() => {
    const result: { index: number; color: string; points: string }[] = [];
    rows.forEach((row) => {
      const pts: string[] = [];
      history.forEach((sample, i) => {
        let val: number | undefined;
        if (row.index === 0 && sample.bed) {
          val = sample.bed.current;
        } else if (sample.tools && row.index > 0 && sample.tools[row.index - 1]) {
          val = sample.tools[row.index - 1].current;
        }
        if (val !== undefined) {
          const x = PAD.left + (i / Math.max(1, history.length - 1)) * plotW;
          const y = yScale(val);
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
      });
      if (pts.length > 0) {
        result.push({ index: row.index, color: HEATER_CHART_COLORS[row.index % HEATER_CHART_COLORS.length], points: pts.join(' ') });
      }
    });
    return result;
  }, [rows, history, plotW, yScale]); // eslint-disable-line react-hooks/exhaustive-deps

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = maxTemp <= 100 ? 20 : maxTemp <= 200 ? 50 : 100;
    for (let v = 0; v <= maxTemp; v += step) ticks.push(v);
    return ticks;
  }, [maxTemp]);

  // Legend positioned in right margin: line swatch + label + current temp
  const legendX = W - LEGEND_W + 4;
  const legendRowH = 15;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="duet-dash-tempchart">
      {/* y-axis grid lines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke={COLORS.panelBorder} strokeWidth={0.5} />
          <text x={PAD.left - 4} y={yScale(v) + 3} fill={COLORS.textDim} fontSize={9} textAnchor="end">{v}</text>
        </g>
      ))}

      {/* data lines */}
      {lines.map((line) => (
        <polyline key={line.index} fill="none" stroke={line.color} strokeWidth={1.5} points={line.points} strokeLinejoin="round" />
      ))}

      {/* legend — always rendered inside the SVG when heaters are present */}
      {rows.map((row, i) => {
        const color = HEATER_CHART_COLORS[row.index % HEATER_CHART_COLORS.length];
        const current = heaters[row.index]?.current;
        const ly = PAD.top + 4 + i * legendRowH;
        return (
          <g key={row.index}>
            {/* colored line swatch */}
            <line x1={legendX} y1={ly + 4} x2={legendX + 14} y2={ly + 4} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
            {/* label */}
            <text x={legendX + 18} y={ly + 8} fill={COLORS.textDim} fontSize={9}>{row.label}</text>
            {/* current temperature */}
            {current !== undefined && (
              <text x={W - 4} y={ly + 8} fill={color} fontSize={9} textAnchor="end" fontWeight="700">
                {current.toFixed(1)}°
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

import { Fragment, useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Flame, Play, Snowflake, Square, Thermometer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useChamberControlStore } from '../../../store/chamberControlStore';
import { resolveChamberReading } from '../../../services/integrations/chamberControl';
import type { TemperatureSample } from '../../../types/duet';
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

function heaterRowKey(row: HeaterRow): string {
  return `${row.kind}-${row.index}-${row.toolIndex ?? 'machine'}-${row.heaterIndexInTool ?? 0}`;
}

function heaterRowColor(row: HeaterRow): string {
  if (row.kind === 'bed') return '#ef4444';
  if (row.kind === 'chamber') return '#a855f7';
  if (row.kind === 'heater') return '#22c55e';
  return HEATER_CHART_COLORS[(row.index + 1) % HEATER_CHART_COLORS.length];
}

export default function TemperaturePanel() {
  const model = usePrinterStore((s) => s.model);
  const temperatureHistory = usePrinterStore((s) => s.temperatureHistory);
  const setToolTemp = usePrinterStore((s) => s.setToolTemp);
  const setBedTemp = usePrinterStore((s) => s.setBedTemp);
  const setChamberTemp = usePrinterStore((s) => s.setChamberTemp);
  const chamberControl = useChamberControlStore();
  const heaters = model.heat?.heaters ?? [];
  const rows = useHeaterRows();
  const chamberReading = useMemo(() => resolveChamberReading(model, chamberControl), [model, chamberControl]);
  const showChamberControls = chamberControl.enabled || rows.some((row) => row.kind === 'chamber') || chamberReading.source !== 'none';

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleTempSubmit = useCallback((row: HeaterRow, field: 'active' | 'standby') => {
    const key = `${row.index}-${field}`;
    const val = parseFloat(editingTemps[key] ?? '');
    if (Number.isNaN(val)) return;
    if (row.kind === 'bed') {
      setBedTemp(val);
    } else if (row.kind === 'chamber') {
      setChamberTemp(val);
    } else if (row.kind === 'tool' && row.toolIndex !== undefined) {
      setToolTemp(row.toolIndex, row.heaterIndexInTool ?? 0, val);
    }
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, setBedTemp, setChamberTemp, setToolTemp]);

  const updateChamberControl = chamberControl.updateChamberControl;
  const targetInput = editingTemps.chamberTarget ?? chamberControl.targetTemperatureC.toString();
  const rampStartInput = editingTemps.chamberRampStart ?? chamberControl.rampStartTemperatureC.toString();
  const rampStepInput = editingTemps.chamberRampStep ?? chamberControl.rampStepC.toString();
  const rampMinutesInput = editingTemps.chamberRampMinutes ?? chamberControl.rampStepMinutes.toString();

  const commitChamberNumber = useCallback((
    key: string,
    fallback: number,
    onValue: (value: number) => void,
  ) => {
    const value = Number(editingTemps[key] ?? fallback);
    if (Number.isFinite(value)) onValue(value);
    setEditingTemps((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, [editingTemps]);

  const applyChamberTarget = useCallback(() => {
    commitChamberNumber('chamberTarget', chamberControl.targetTemperatureC, (value) => {
      updateChamberControl({ targetTemperatureC: value });
      void setChamberTemp(value);
    });
  }, [chamberControl.targetTemperatureC, commitChamberNumber, setChamberTemp, updateChamberControl]);

  const coolDownChamber = useCallback(() => {
    chamberControl.stopRamp();
    updateChamberControl({ targetTemperatureC: 0 });
    void setChamberTemp(0);
  }, [chamberControl, setChamberTemp, updateChamberControl]);

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
            <Fragment key={heaterRowKey(row)}>
              <span
                className="duet-dash-heater-label"
                style={{ '--duet-heater-color': heaterRowColor(row) } as CSSProperties}
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
                    if (!Number.isNaN(val) && row.kind === 'tool' && row.toolIndex !== undefined) {
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

      {showChamberControls && (
        <div className="duet-dash-chamber">
          <div className="duet-dash-chamber__header">
            <div>
              <span>Chamber</span>
              <strong>
                {chamberReading.temperatureC !== null ? `${chamberReading.temperatureC.toFixed(1)}C` : '--'}
              </strong>
            </div>
            <label className="duet-dash-toggle">
              <input
                type="checkbox"
                checked={chamberControl.enabled}
                onChange={(event) => updateChamberControl({ enabled: event.target.checked })}
              />
              <span>Control</span>
            </label>
          </div>

          <div className="duet-dash-chamber__grid">
            <label>
              <span>Source</span>
              <select
                value={chamberControl.source}
                onChange={(event) => updateChamberControl({ source: event.target.value as typeof chamberControl.source })}
              >
                <option value="auto">Auto</option>
                <option value="rrf">RRF heater</option>
                <option value="klipper">Klipper sensor</option>
                <option value="mqtt">MQTT topic</option>
              </select>
            </label>
            <label>
              <span>MQTT topic</span>
              <input
                value={chamberControl.mqttTopic}
                onChange={(event) => updateChamberControl({ mqttTopic: event.target.value })}
                placeholder="shop/printer/chamber"
              />
            </label>
            <label>
              <span>Target</span>
              <input
                type="number"
                step={1}
                value={targetInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberTarget: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberTarget', chamberControl.targetTemperatureC, (value) => updateChamberControl({ targetTemperatureC: value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') applyChamberTarget(); }}
              />
            </label>
            <button className="duet-dash-chamber__button" type="button" onClick={applyChamberTarget}>
              <Flame size={13} /> Apply
            </button>
          </div>

          <div className="duet-dash-chamber__grid duet-dash-chamber__grid--ramp">
            <label>
              <span>Ramp start</span>
              <input
                type="number"
                step={1}
                value={rampStartInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampStart: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampStart', chamberControl.rampStartTemperatureC, (value) => updateChamberControl({ rampStartTemperatureC: value }))}
              />
            </label>
            <label>
              <span>Step C</span>
              <input
                type="number"
                step={1}
                value={rampStepInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampStep: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampStep', chamberControl.rampStepC, (value) => updateChamberControl({ rampStepC: value }))}
              />
            </label>
            <label>
              <span>Step min</span>
              <input
                type="number"
                step={1}
                value={rampMinutesInput}
                onChange={(event) => setEditingTemps((prev) => ({ ...prev, chamberRampMinutes: event.target.value }))}
                onBlur={() => commitChamberNumber('chamberRampMinutes', chamberControl.rampStepMinutes, (value) => updateChamberControl({ rampStepMinutes: value }))}
              />
            </label>
            <button
              className="duet-dash-chamber__button"
              type="button"
              onClick={() => chamberControl.rampActive ? chamberControl.stopRamp() : chamberControl.startRamp()}
            >
              {chamberControl.rampActive ? <Square size={13} /> : <Play size={13} />}
              {chamberControl.rampActive ? 'Stop' : 'Ramp'}
            </button>
          </div>

          <div className="duet-dash-chamber__policies">
            <span title={chamberReading.label}>{chamberReading.label}</span>
            <label><input type="checkbox" checked={chamberControl.preheatBeforePrint} onChange={(event) => updateChamberControl({ preheatBeforePrint: event.target.checked })} /> Preheat</label>
            <label><input type="checkbox" checked={chamberControl.cooldownOnDone} onChange={(event) => updateChamberControl({ cooldownOnDone: event.target.checked })} /> Cooldown done</label>
            <label><input type="checkbox" checked={chamberControl.cooldownOnDoorOpen} onChange={(event) => updateChamberControl({ cooldownOnDoorOpen: event.target.checked })} /> Door safety</label>
            <label><input type="checkbox" checked={chamberControl.doorOpen} onChange={(event) => updateChamberControl({ doorOpen: event.target.checked })} /> Door open</label>
            <button className="duet-dash-chamber__cool" type="button" onClick={coolDownChamber}>
              <Snowflake size={13} /> Cool
            </button>
          </div>
        </div>
      )}

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
  temperatureHistory: TemperatureSample[];
  heaters: { current: number; active: number; standby: number; state: string }[];
}) {
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
          points: pts.join(' '),
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
      return { timestamp, label: i === tickCount ? 'now' : label };
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

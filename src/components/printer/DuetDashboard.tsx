import React, { useState, useMemo, useCallback } from 'react';
import {
  Thermometer, Home, ArrowUp, ArrowDown, Power, Play, Fan,
  Gauge, Droplets, Cpu, Clock, ChevronUp, ChevronDown,
  MoveHorizontal, Zap, FileText, Server, HardDrive, Wifi, MonitorSmartphone,
  Wrench, XCircle, Package,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

// ---------------------------------------------------------------------------
// Theme — shared CSS-var tokens so all pages follow the active theme
// ---------------------------------------------------------------------------
import { colors as COLORS } from '../../utils/theme';
import DuetCustomButtons from './DuetCustomButtons';

// Semantic heater-state colors (not theme-dependent — always meaningful)
const HEATER_STATE = {
  off:     '#555577',
  standby: 'var(--warning)',
  active:  'var(--error)',
  tuning:  '#a855f7',
  fault:   'var(--error)',
} as const;

const HEATER_CHART_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

function panelStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 8,
    padding: 16,
    ...extra,
  };
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 11, color: COLORS.textDim, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 8, fontWeight: 600 };
}

function btnStyle(variant: 'default' | 'accent' | 'danger' | 'success' = 'default', small = false): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: small ? 11 : 12, fontWeight: 500, transition: 'background 0.15s, opacity 0.15s',
    padding: small ? '3px 6px' : '6px 12px', color: '#fff',
  };
  if (variant === 'accent') return { ...base, background: COLORS.accent };
  if (variant === 'danger') return { ...base, background: COLORS.danger };
  if (variant === 'success') return { ...base, background: COLORS.success };
  return { ...base, background: COLORS.surface, color: COLORS.text };
}

function inputStyle(width = 60): React.CSSProperties {
  return {
    background: COLORS.inputBg, border: `1px solid ${COLORS.inputBorder}`, borderRadius: 4,
    color: COLORS.text, padding: '4px 6px', fontSize: 12, width, fontFamily: 'inherit', outline: 'none',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function statusColor(status: string): string {
  switch (status) {
    case 'idle': return COLORS.success;
    case 'processing': case 'simulating': return COLORS.accent;
    case 'paused': case 'pausing': case 'resuming': case 'changingTool': return COLORS.warning;
    case 'halted': case 'off': case 'cancelling': return COLORS.danger;
    case 'busy': return '#a855f7';
    default: return COLORS.textDim;
  }
}

function heaterStateColor(state: string): string {
  switch (state) {
    case 'active': return COLORS.heaterActive;
    case 'standby': return COLORS.heaterStandby;
    case 'fault': return COLORS.fault;
    case 'tuning': return COLORS.heaterTuning;
    default: return COLORS.heaterOff;
  }
}

function tempBarGradient(current: number, max = 300): string {
  const pct = Math.min(1, Math.max(0, current / max));
  // Blue at 0, yellow at 50%, red at 100%
  if (pct < 0.5) {
    const t = pct / 0.5;
    const r = Math.round(59 + t * (245 - 59));
    const g = Math.round(130 + t * (158 - 130));
    const b = Math.round(246 + t * (11 - 246));
    return `rgb(${r},${g},${b})`;
  }
  const t = (pct - 0.5) / 0.5;
  const r = Math.round(245 + t * (239 - 245));
  const g = Math.round(158 + t * (68 - 158));
  const b = Math.round(11 + t * (68 - 11));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// 1. Machine Status Header
// ---------------------------------------------------------------------------

function MachineStatusHeader() {
  const model = usePrinterStore((s) => s.model);
  const status = model.state?.status ?? 'disconnected';
  const board = model.boards?.[0];
  const upTime = model.state?.upTime ?? 0;

  return (
    <div style={{
      ...panelStyle(), display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%', background: statusColor(status),
          boxShadow: `0 0 8px ${statusColor(status)}`,
        }} />
        <span style={{ fontSize: 16, fontWeight: 600, textTransform: 'capitalize' }}>{status}</span>
      </div>
      {board && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: COLORS.textDim, fontSize: 12 }}>
            <Cpu size={13} />
            <span>{board.name || board.shortName}</span>
          </div>
          <div style={{ color: COLORS.textDim, fontSize: 12 }}>
            {board.firmwareName} {board.firmwareVersion}
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: COLORS.textDim, fontSize: 12, marginLeft: 'auto' }}>
        <Clock size={13} />
        <span>{formatUptime(upTime)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Temperature Panel
// ---------------------------------------------------------------------------

interface HeaterRow {
  label: string;
  index: number;
  kind: 'bed' | 'chamber' | 'tool';
  toolIndex?: number;
  heaterIndexInTool?: number;
}

function useHeaterRows(): HeaterRow[] {
  const model = usePrinterStore((s) => s.model);
  return useMemo(() => {
    const rows: HeaterRow[] = [];
    const bedHeaters = model.heat?.bedHeaters ?? [];
    bedHeaters.forEach((idx) => {
      if (idx >= 0) rows.push({ label: `Bed${bedHeaters.length > 1 ? ` ${idx}` : ''}`, index: idx, kind: 'bed' });
    });
    const chamberHeaters = model.heat?.chamberHeaters ?? [];
    chamberHeaters.forEach((idx) => {
      if (idx >= 0) rows.push({ label: `Chamber${chamberHeaters.length > 1 ? ` ${idx}` : ''}`, index: idx, kind: 'chamber' });
    });
    const tools = model.tools ?? [];
    tools.forEach((tool) => {
      tool.heaters.forEach((hIdx, hi) => {
        rows.push({
          label: tool.name || `Tool ${tool.number}${tool.heaters.length > 1 ? ` H${hi}` : ''}`,
          index: hIdx,
          kind: 'tool',
          toolIndex: tool.number,
          heaterIndexInTool: hi,
        });
      });
    });
    return rows;
  }, [model.heat, model.tools]);
}

function TemperaturePanel() {
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
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Thermometer size={14} /> Temperatures
      </div>

      {/* Heater table */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 80px 80px 1fr 40px', gap: '6px 8px', alignItems: 'center', fontSize: 12, marginBottom: 12 }}>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>Heater</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>Current</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>Active</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>Standby</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>Bar</span>
        <span style={{ color: COLORS.textDim, fontSize: 10 }}>State</span>

        {rows.map((row) => {
          const h = heaters[row.index];
          if (!h) return null;
          const current = h.current;
          const activeKey = `${row.index}-active`;
          const standbyKey = `${row.index}-standby`;
          const barPct = Math.min(100, Math.max(0, (current / 300) * 100));

          return (
            <React.Fragment key={row.index}>
              <span style={{ fontWeight: 500, color: HEATER_CHART_COLORS[row.index % HEATER_CHART_COLORS.length] }}>{row.label}</span>
              <span style={{ fontWeight: 600 }}>{current.toFixed(1)}&deg;C</span>

              {/* Active temp input */}
              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[activeKey] ?? h.active.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'active')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(row, 'active'); }}
              />

              {/* Standby temp input */}
              <input
                style={inputStyle(70)}
                type="number"
                step={1}
                value={editingTemps[standbyKey] ?? h.standby.toString()}
                onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                onBlur={() => handleTempSubmit(row, 'standby')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Standby temp uses G10 R param; for simplicity, we send the same action
                    const val = parseFloat(editingTemps[standbyKey] ?? '');
                    if (!isNaN(val) && row.kind === 'tool' && row.toolIndex !== undefined) {
                      usePrinterStore.getState().sendGCode(`G10 P${row.toolIndex} R${val}`);
                    }
                    setEditingTemps((prev) => { const n = { ...prev }; delete n[standbyKey]; return n; });
                  }
                }}
              />

              {/* Temperature bar */}
              <div style={{ height: 8, borderRadius: 4, background: COLORS.inputBg, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%', width: `${barPct}%`, borderRadius: 4,
                  background: tempBarGradient(current),
                  transition: 'width 0.3s ease',
                }} />
              </div>

              {/* Heater state indicator */}
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: heaterStateColor(h.state),
                boxShadow: h.state !== 'off' ? `0 0 6px ${heaterStateColor(h.state)}` : 'none',
                margin: '0 auto',
              }} title={h.state} />
            </React.Fragment>
          );
        })}
      </div>

      {/* Temperature Chart (SVG) */}
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
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Determine Y range from data
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

  // Build polylines per heater index
  const lines = useMemo(() => {
    const result: { index: number; color: string; points: string }[] = [];
    rows.forEach((row) => {
      const pts: string[] = [];
      history.forEach((sample, i) => {
        let val: number | undefined;
        // bed is heater 0 in the store's connect() logic; tools are heaters[1..N]
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

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = maxTemp <= 100 ? 20 : maxTemp <= 200 ? 50 : 100;
    for (let v = 0; v <= maxTemp; v += step) ticks.push(v);
    return ticks;
  }, [maxTemp]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 180 }}>
      {/* Grid lines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke={COLORS.panelBorder} strokeWidth={0.5} />
          <text x={PAD.left - 4} y={yScale(v) + 3} fill={COLORS.textDim} fontSize={9} textAnchor="end">{v}</text>
        </g>
      ))}

      {/* Data lines */}
      {lines.map((line) => (
        <polyline key={line.index} fill="none" stroke={line.color} strokeWidth={1.5} points={line.points} strokeLinejoin="round" />
      ))}

      {/* Axis labels */}
      <text x={W / 2} y={H - 2} fill={COLORS.textDim} fontSize={9} textAnchor="middle">Samples (last 200)</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 3. Axis Position & Movement
// ---------------------------------------------------------------------------

function AxisMovementPanel() {
  const model = usePrinterStore((s) => s.model);
  const moveAxis = usePrinterStore((s) => s.moveAxis);
  const homeAxes = usePrinterStore((s) => s.homeAxes);
  const setBabyStep = usePrinterStore((s) => s.setBabyStep);
  const jogDistance = usePrinterStore((s) => s.jogDistance);
  const setJogDistance = usePrinterStore((s) => s.setJogDistance);

  const axes = model.move?.axes ?? [];
  const jogDistances = [0.05, 0.1, 0.5, 1, 5, 10, 50, 100];
  const jogButtons = [-100, -10, -1, -0.1, 0.1, 1, 10, 100];

  const [babyStepValue, setBabyStepValue] = useState(0);

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <MoveHorizontal size={14} /> Axes &amp; Movement
      </div>

      {/* Current positions with endstop indicators */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        {axes.map((ax, axIdx) => {
          const endstops = model.sensors?.endstops ?? [];
          const endstop = endstops[axIdx];
          let endstopColor = '#555577';
          let endstopTitle = 'No endstop configured';
          if (endstop) {
            if (endstop.type === 'unknown' || endstop.type === '') {
              endstopColor = '#555577';
              endstopTitle = 'No endstop configured';
            } else if (endstop.triggered) {
              endstopColor = COLORS.danger;
              endstopTitle = 'Endstop triggered';
            } else {
              endstopColor = COLORS.success;
              endstopTitle = 'Endstop not triggered';
            }
          }
          return (
            <div key={ax.letter} style={{
              background: COLORS.surface, borderRadius: 6, padding: '8px 14px', minWidth: 80, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {ax.letter}
                {!ax.homed && <span style={{ color: COLORS.warning, fontSize: 9 }}>?</span>}
                <div
                  style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: endstopColor,
                    boxShadow: endstop?.triggered ? `0 0 5px ${endstopColor}` : 'none',
                    flexShrink: 0,
                  }}
                  title={endstopTitle}
                />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>
                {ax.userPosition.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compensation status badge */}
      {(() => {
        const compType = model.move?.compensation?.type;
        const hasComp = compType && compType !== 'none' && compType !== '';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: hasComp ? 'rgba(34,197,94,0.15)' : 'rgba(136,136,170,0.15)',
              color: hasComp ? COLORS.success : COLORS.textDim,
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
              border: `1px solid ${hasComp ? 'rgba(34,197,94,0.3)' : 'rgba(136,136,170,0.2)'}`,
            }}>
              Mesh Comp: {hasComp ? 'Active' : 'Off'}
            </span>
          </div>
        );
      })()}

      {/* Home buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button style={btnStyle('accent')} onClick={() => homeAxes()}>
          <Home size={13} /> Home All
        </button>
        {axes.map((ax) => (
          <button key={ax.letter} style={btnStyle()} onClick={() => homeAxes([ax.letter])}>
            <Home size={11} /> {ax.letter}
          </button>
        ))}
      </div>

      {/* Step size selector */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Step Size (mm)</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {jogDistances.map((d) => (
            <button
              key={d}
              style={{
                ...btnStyle(d === jogDistance ? 'accent' : 'default', true),
                fontFamily: 'monospace',
              }}
              onClick={() => setJogDistance(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Jog buttons per axis */}
      {axes.map((ax) => (
        <div key={ax.letter} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <span style={{ width: 24, fontWeight: 600, fontSize: 13 }}>{ax.letter}</span>
          {jogButtons.map((j) => (
            <button
              key={j}
              style={{
                ...btnStyle(j < 0 ? 'default' : 'default', true),
                fontFamily: 'monospace', minWidth: 44,
                background: j < 0 ? '#1a1a3a' : '#1a2a1a',
                color: j < 0 ? '#8888cc' : '#88cc88',
              }}
              onClick={() => moveAxis(ax.letter, j)}
            >
              {j > 0 ? `+${j}` : j}
            </button>
          ))}
        </div>
      ))}

      {/* Baby stepping */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${COLORS.panelBorder}`, paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 6 }}>Baby Stepping (Z offset)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={btnStyle()} onClick={() => { setBabyStep(-0.02); setBabyStepValue((v) => v - 0.02); }}>
            <ChevronDown size={12} /> -0.02
          </button>
          <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
            {babyStepValue.toFixed(3)} mm
          </span>
          <button style={btnStyle()} onClick={() => { setBabyStep(0.02); setBabyStepValue((v) => v + 0.02); }}>
            <ChevronUp size={12} /> +0.02
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Extruder Controls
// ---------------------------------------------------------------------------

function ExtruderControlPanel() {
  const model = usePrinterStore((s) => s.model);
  const extrudeAction = usePrinterStore((s) => s.extrude);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const extrudeAmount = usePrinterStore((s) => s.extrudeAmount);
  const extrudeFeedrate = usePrinterStore((s) => s.extrudeFeedrate);
  const tools = model.tools ?? [];
  const currentTool = model.state?.currentTool ?? -1;

  const [amount, setAmount] = useState(extrudeAmount);
  const [feedrate, setFeedrate] = useState(extrudeFeedrate);
  const [selectedTool, setSelectedTool] = useState(currentTool);

  const amounts = [5, 10, 20, 50, 100];

  const handleExtrude = (direction: number) => {
    // Select the tool first if needed
    if (selectedTool >= 0 && selectedTool !== currentTool) {
      sendGCode(`T${selectedTool}`);
    }
    extrudeAction(amount * direction, feedrate);
  };

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Droplets size={14} /> Extruder
      </div>

      {/* Tool selector */}
      {tools.length > 1 && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>Tool:</span>
          <select
            style={{ ...inputStyle(120), cursor: 'pointer' }}
            value={selectedTool}
            onChange={(e) => setSelectedTool(Number(e.target.value))}
          >
            {tools.map((t) => (
              <option key={t.number} value={t.number}>{t.name || `Tool ${t.number}`}</option>
            ))}
          </select>
        </div>
      )}

      {/* Amount presets */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Amount (mm)</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {amounts.map((a) => (
            <button
              key={a}
              style={btnStyle(a === amount ? 'accent' : 'default', true)}
              onClick={() => setAmount(a)}
            >
              {a}
            </button>
          ))}
          <input
            type="number"
            style={inputStyle(60)}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            min={0}
          />
        </div>
      </div>

      {/* Feedrate */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: COLORS.textDim }}>Feedrate (mm/min):</span>
        <input
          type="number"
          style={inputStyle(80)}
          value={feedrate}
          onChange={(e) => setFeedrate(Number(e.target.value))}
          min={1}
        />
      </div>

      {/* Extrude / Retract */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnStyle('success')} onClick={() => handleExtrude(1)}>
          <ArrowDown size={13} /> Extrude
        </button>
        <button style={btnStyle('danger')} onClick={() => handleExtrude(-1)}>
          <ArrowUp size={13} /> Retract
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Speed & Flow Overrides
// ---------------------------------------------------------------------------

function SpeedFlowPanel() {
  const model = usePrinterStore((s) => s.model);
  const setSpeedFactor = usePrinterStore((s) => s.setSpeedFactor);
  const setExtrusionFactor = usePrinterStore((s) => s.setExtrusionFactor);

  const speedFactor = model.move?.speedFactor ?? 1;
  const extruders = model.move?.extruders ?? [];

  const [speedInput, setSpeedInput] = useState<string>('');
  const [extFactors, setExtFactors] = useState<Record<number, string>>({});

  const currentSpeedPct = Math.round(speedFactor * 100);

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Gauge size={14} /> Speed &amp; Flow
      </div>

      {/* Speed factor */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 4 }}>Speed Factor</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={50} max={200} step={1}
            value={speedInput !== '' ? speedInput : currentSpeedPct}
            onChange={(e) => setSpeedInput(e.target.value)}
            onMouseUp={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            onTouchEnd={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            style={{ flex: 1, accentColor: COLORS.accent }}
          />
          <input
            type="number"
            style={inputStyle(55)}
            value={speedInput !== '' ? speedInput : currentSpeedPct}
            onChange={(e) => setSpeedInput(e.target.value)}
            onBlur={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
          />
          <span style={{ fontSize: 12, color: COLORS.textDim }}>%</span>
        </div>
      </div>

      {/* Extrusion factor per extruder */}
      {extruders.map((ext, i) => {
        const pct = Math.round(ext.factor * 100);
        const localVal = extFactors[i];
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 4 }}>Extruder {i} Flow</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min={50} max={150} step={1}
                value={localVal ?? pct}
                onChange={(e) => setExtFactors((p) => ({ ...p, [i]: e.target.value }))}
                onMouseUp={() => { if (localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                onTouchEnd={() => { if (localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                style={{ flex: 1, accentColor: COLORS.accent }}
              />
              <input
                type="number"
                style={inputStyle(55)}
                value={localVal ?? pct}
                onChange={(e) => setExtFactors((p) => ({ ...p, [i]: e.target.value }))}
                onBlur={() => {
                  if (localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); }
                }}
              />
              <span style={{ fontSize: 12, color: COLORS.textDim }}>%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Fan Control
// ---------------------------------------------------------------------------

function FanControlPanel() {
  const model = usePrinterStore((s) => s.model);
  const setFanSpeed = usePrinterStore((s) => s.setFanSpeed);
  const fans = model.fans ?? [];

  const [localFanValues, setLocalFanValues] = useState<Record<number, string>>({});

  if (fans.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Fan size={14} /> Fans
      </div>

      {fans.map((fan, i) => {
        const pct = Math.round(fan.actualValue * 100);
        const localVal = localFanValues[i];
        return (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{fan.name || `Fan ${i}`}</span>
              {fan.rpm > 0 && (
                <span style={{ fontSize: 10, color: COLORS.textDim }}>{fan.rpm} RPM</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="range"
                min={0} max={100} step={1}
                value={localVal ?? pct}
                onChange={(e) => setLocalFanValues((p) => ({ ...p, [i]: e.target.value }))}
                onMouseUp={() => { if (localVal !== undefined) { setFanSpeed(i, Number(localVal)); setLocalFanValues((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                onTouchEnd={() => { if (localVal !== undefined) { setFanSpeed(i, Number(localVal)); setLocalFanValues((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                style={{ flex: 1, accentColor: COLORS.accent }}
              />
              <span style={{ fontSize: 12, fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>
                {localVal ?? pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. System Info Panel
// ---------------------------------------------------------------------------

function tempColorIndicator(temp: number): string {
  if (temp < 50) return COLORS.success;
  if (temp < 70) return COLORS.warning;
  return COLORS.danger;
}

function vinColorIndicator(voltage: number): string {
  // For 24V systems: green 22-26V, yellow within 20-28V, red otherwise
  if (voltage >= 22 && voltage <= 26) return COLORS.success;
  if (voltage >= 20 && voltage <= 28) return COLORS.warning;
  return COLORS.danger;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function SystemInfoPanel() {
  const model = usePrinterStore((s) => s.model);
  const board = model.boards?.[0];
  const network = model.network;
  const volumes = model.volumes ?? [];
  const upTime = model.state?.upTime ?? 0;

  if (!board) return null;

  const mcuTemp = board.mcuTemp;
  const vIn = board.vIn;
  const v12 = board.v12;
  const iface = network?.interfaces?.[0];

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <Server size={14} /> System Info
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
        {/* Board Info */}
        <div style={{ gridColumn: '1 / -1', background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Board</div>
          <div style={{ fontWeight: 600 }}>{board.name || board.shortName}</div>
          <div style={{ color: COLORS.textDim, fontSize: 11, marginTop: 2 }}>
            {board.firmwareName} {board.firmwareVersion}
          </div>
          {board.firmwareDate && (
            <div style={{ color: COLORS.textDim, fontSize: 10, marginTop: 1 }}>
              Built: {board.firmwareDate}
            </div>
          )}
        </div>

        {/* MCU Temperature */}
        {mcuTemp && (
          <div style={{ background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Cpu size={10} /> MCU Temp
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: tempColorIndicator(mcuTemp.current),
                boxShadow: `0 0 6px ${tempColorIndicator(mcuTemp.current)}`,
              }} />
              <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}>
                {mcuTemp.current.toFixed(1)}&deg;C
              </span>
            </div>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
              Min: {mcuTemp.min.toFixed(1)}&deg;C / Max: {mcuTemp.max.toFixed(1)}&deg;C
            </div>
          </div>
        )}

        {/* Input Voltage */}
        {vIn && (
          <div style={{ background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap size={10} /> Vin
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: vinColorIndicator(vIn.current),
                boxShadow: `0 0 6px ${vinColorIndicator(vIn.current)}`,
              }} />
              <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}>
                {vIn.current.toFixed(1)}V
              </span>
            </div>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
              Min: {vIn.min.toFixed(1)}V / Max: {vIn.max.toFixed(1)}V
            </div>
          </div>
        )}

        {/* 5V Rail (v12) */}
        {v12 && (
          <div style={{ background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap size={10} /> 5V Rail
            </div>
            <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 16 }}>
              {v12.current.toFixed(2)}V
            </div>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 4 }}>
              Min: {v12.min.toFixed(2)}V / Max: {v12.max.toFixed(2)}V
            </div>
          </div>
        )}

        {/* Uptime */}
        <div style={{ background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} /> Uptime
          </div>
          <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>
            {formatUptime(upTime)}
          </div>
        </div>

        {/* Network */}
        {network && (
          <div style={{ background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Wifi size={10} /> Network
            </div>
            <div style={{ fontWeight: 600, fontSize: 11 }}>{network.hostname || network.name}</div>
            {iface && (
              <>
                <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                  {iface.actualIP}
                </div>
                <div style={{ fontSize: 10, color: COLORS.textDim }}>
                  {iface.type} {iface.speed > 0 ? `(${iface.speed}Mbps)` : ''}
                </div>
              </>
            )}
          </div>
        )}

        {/* Free Space */}
        {volumes.length > 0 && (
          <div style={{ gridColumn: '1 / -1', background: COLORS.surface, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <HardDrive size={10} /> Storage
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {volumes.filter((v) => v.mounted).map((vol, i) => {
                const usedPct = vol.totalSpace > 0 ? ((vol.totalSpace - vol.freeSpace) / vol.totalSpace) * 100 : 0;
                return (
                  <div key={i} style={{ minWidth: 100 }}>
                    <div style={{ fontSize: 11, fontWeight: 500 }}>{vol.path || vol.name || `Volume ${i}`}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                      {formatBytes(vol.freeSpace)} free / {formatBytes(vol.totalSpace)}
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: COLORS.inputBg, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{
                        height: '100%', width: `${usedPct}%`, borderRadius: 2,
                        background: usedPct > 90 ? COLORS.danger : usedPct > 75 ? COLORS.warning : COLORS.accent,
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. ATX Power Toggle
// ---------------------------------------------------------------------------

function AtxPowerPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const atxPower = model.state?.atxPower ?? false;

  return (
    <div style={panelStyle({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Zap size={14} color={atxPower ? COLORS.success : COLORS.textDim} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>ATX Power</span>
      </div>
      <button
        style={{
          ...btnStyle(atxPower ? 'danger' : 'success'),
          minWidth: 60,
        }}
        onClick={() => sendGCode(atxPower ? 'M81' : 'M80')}
      >
        <Power size={13} />
        {atxPower ? 'Off' : 'On'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Quick Macro Buttons
// ---------------------------------------------------------------------------

function MacroPanel() {
  const macros = usePrinterStore((s) => s.macros);
  const runMacro = usePrinterStore((s) => s.runMacro);

  if (macros.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileText size={14} /> Macros
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {macros
          .filter((m) => m.type === 'f')
          .map((macro) => (
            <button
              key={macro.name}
              style={btnStyle()}
              onClick={() => runMacro(macro.name)}
              title={macro.name}
            >
              <Play size={11} /> {macro.name.replace(/\.g$/i, '')}
            </button>
          ))}
        {macros
          .filter((m) => m.type === 'd')
          .map((dir) => (
            <button
              key={dir.name}
              style={{ ...btnStyle(), opacity: 0.7 }}
              title={`Folder: ${dir.name}`}
              disabled
            >
              {dir.name}/
            </button>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. Tool Selector Panel
// ---------------------------------------------------------------------------

function toolStateColor(state: string): string {
  switch (state) {
    case 'active': return COLORS.success;
    case 'standby': return COLORS.warning;
    default: return COLORS.textDim;
  }
}

function ToolSelectorPanel() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const filaments = usePrinterStore((s) => s.filaments);
  const loadFilament = usePrinterStore((s) => s.loadFilament);
  const unloadFilament = usePrinterStore((s) => s.unloadFilament);
  const changeFilament = usePrinterStore((s) => s.changeFilament);
  const tools = model.tools ?? [];
  const heaters = model.heat?.heaters ?? [];
  const fans = model.fans ?? [];
  const extrudersModel = model.move?.extruders ?? [];
  const currentTool = model.state?.currentTool ?? -1;

  const [editingTemps, setEditingTemps] = useState<Record<string, string>>({});

  const handleSelectTool = useCallback((toolNumber: number) => {
    sendGCode(`T${toolNumber}`);
  }, [sendGCode]);

  const handleDeselectTool = useCallback(() => {
    sendGCode('T-1');
  }, [sendGCode]);

  const handleTempChange = useCallback((toolNumber: number, heaterIdx: number, value: number, standby: boolean) => {
    const tool = (usePrinterStore.getState().model.tools ?? []).find((t) => t.number === toolNumber);
    if (!tool) return;
    const letter = standby ? 'R' : 'S';
    const temps = standby ? [...tool.standby] : [...tool.active];
    temps[heaterIdx] = value;
    const tempStr = temps.join(':');
    sendGCode(`G10 P${toolNumber} ${letter}${tempStr}`);
  }, [sendGCode]);

  const handleTempSubmit = useCallback((key: string, toolNumber: number, heaterIdx: number, standby: boolean) => {
    const val = parseFloat(editingTemps[key] ?? '');
    if (isNaN(val)) return;
    handleTempChange(toolNumber, heaterIdx, val, standby);
    setEditingTemps((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [editingTemps, handleTempChange]);

  if (tools.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={{ ...labelStyle(), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Wrench size={14} /> Tools
        </div>
        {currentTool >= 0 && (
          <button
            style={{
              ...btnStyle('default', true),
              fontSize: 10,
              textTransform: 'uppercase' as React.CSSProperties['textTransform'],
              letterSpacing: '0.04em',
            }}
            onClick={handleDeselectTool}
            title="Deselect current tool (T-1)"
          >
            <XCircle size={11} /> Deselect
          </button>
        )}
      </div>

      {tools.map((tool) => {
        const isActive = tool.number === currentTool;
        const toolName = tool.name || `Tool ${tool.number}`;

        return (
          <div
            key={tool.number}
            style={{
              background: isActive ? 'rgba(80, 120, 255, 0.12)' : COLORS.surface,
              border: `1px solid ${isActive ? COLORS.accent : COLORS.panelBorder}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              transition: 'border-color 0.2s, background 0.2s',
            }}
          >
            {/* Tool header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                style={{
                  ...btnStyle(isActive ? 'accent' : 'default', true),
                  fontWeight: 700,
                  fontSize: 12,
                  minWidth: 36,
                }}
                onClick={() => handleSelectTool(tool.number)}
                title={`Select ${toolName}`}
              >
                T{tool.number}
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{toolName}</span>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: toolStateColor(tool.state),
                  boxShadow: tool.state !== 'off' ? `0 0 6px ${toolStateColor(tool.state)}` : 'none',
                }} />
                <span style={{
                  fontSize: 11,
                  color: toolStateColor(tool.state),
                  textTransform: 'capitalize',
                  fontWeight: 500,
                }}>
                  {tool.state}
                </span>
              </div>
            </div>

            {/* Heaters with temperature inputs */}
            {tool.heaters.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Heaters</div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 65px 65px 65px',
                  gap: '4px 6px',
                  alignItems: 'center',
                  fontSize: 11,
                }}>
                  <span style={{ color: COLORS.textDim, fontSize: 9 }}>Heater</span>
                  <span style={{ color: COLORS.textDim, fontSize: 9 }}>Current</span>
                  <span style={{ color: COLORS.textDim, fontSize: 9 }}>Active</span>
                  <span style={{ color: COLORS.textDim, fontSize: 9 }}>Standby</span>

                  {tool.heaters.map((hIdx, hi) => {
                    const h = heaters[hIdx];
                    if (!h) return null;
                    const activeKey = `t${tool.number}-h${hi}-active`;
                    const standbyKey = `t${tool.number}-h${hi}-standby`;

                    return (
                      <React.Fragment key={hIdx}>
                        <span style={{
                          fontWeight: 500,
                          color: HEATER_CHART_COLORS[hIdx % HEATER_CHART_COLORS.length],
                          fontSize: 11,
                        }}>
                          H{hIdx}
                          <span style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: heaterStateColor(h.state),
                            marginLeft: 4,
                            verticalAlign: 'middle',
                          }} />
                        </span>
                        <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                          {h.current.toFixed(1)}&deg;
                        </span>
                        <input
                          style={inputStyle(58)}
                          type="number"
                          step={1}
                          value={editingTemps[activeKey] ?? (tool.active[hi] ?? h.active).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [activeKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(activeKey, tool.number, hi, false)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(activeKey, tool.number, hi, false); }}
                          title="Active temperature"
                        />
                        <input
                          style={inputStyle(58)}
                          type="number"
                          step={1}
                          value={editingTemps[standbyKey] ?? (tool.standby[hi] ?? h.standby).toString()}
                          onChange={(e) => setEditingTemps((p) => ({ ...p, [standbyKey]: e.target.value }))}
                          onBlur={() => handleTempSubmit(standbyKey, tool.number, hi, true)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleTempSubmit(standbyKey, tool.number, hi, true); }}
                          title="Standby temperature"
                        />
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tool Offsets */}
            {tool.offsets && tool.offsets.some((o) => o !== 0) && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Offsets</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {tool.offsets.map((offset, idx) => {
                    const axisLetter = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'][idx] ?? `#${idx}`;
                    return (
                      <div key={idx} style={{
                        background: COLORS.inputBg,
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}>
                        <span style={{ color: COLORS.textDim }}>{axisLetter}:</span>{' '}
                        <span style={{ fontWeight: 600 }}>{offset.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filament management — current filament + load/unload */}
            {tool.extruders.length > 0 && (() => {
              const extruderIdx = tool.filamentExtruder >= 0
                ? tool.filamentExtruder
                : tool.extruders[0];
              const loaded = extrudersModel[extruderIdx]?.filament ?? '';
              return (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Filament</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Package size={12} color={COLORS.textDim} />
                    <select
                      style={{
                        ...inputStyle(),
                        flex: 1,
                        minWidth: 0,
                        width: 'auto',
                      }}
                      value={loaded}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) return;
                        // If a filament is already loaded, swap via M702+M701.
                        // Otherwise fresh-load with M701.
                        if (loaded) changeFilament(tool.number, name);
                        else loadFilament(tool.number, name);
                      }}
                      title={loaded ? `Loaded: ${loaded} (pick another to swap)` : 'No filament loaded'}
                    >
                      <option value="">{loaded ? loaded : '— none —'}</option>
                      {filaments
                        .filter((n) => n !== loaded)
                        .map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                    <button
                      style={btnStyle('default', true)}
                      onClick={() => unloadFilament(tool.number)}
                      disabled={!loaded}
                      title="Unload filament (M702)"
                    >
                      Unload
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Assigned extruders and fans */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
              {tool.extruders.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Droplets size={11} color={COLORS.textDim} />
                  <span style={{ color: COLORS.textDim }}>Extruders:</span>
                  <span>{tool.extruders.join(', ')}</span>
                </div>
              )}
              {tool.fans.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Fan size={11} color={COLORS.textDim} />
                  <span style={{ color: COLORS.textDim }}>Fans:</span>
                  <span>
                    {tool.fans.map((fIdx) => {
                      const f = fans[fIdx];
                      return f?.name || `Fan ${fIdx}`;
                    }).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

export default function DuetDashboard() {
  const error = usePrinterStore((s) => s.error);
  const setError = usePrinterStore((s) => s.setError);

  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      background: COLORS.bg,
      padding: 16,
    }}>
      {/* Error banner */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.15)', border: `1px solid ${COLORS.danger}`, borderRadius: 6,
          padding: '8px 14px', marginBottom: 12, fontSize: 12, color: COLORS.danger,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button
            style={{ background: 'none', border: 'none', color: COLORS.danger, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
            onClick={() => setError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        maxWidth: 1400,
        margin: '0 auto',
      }}>
        {/* Full-width status header */}
        <div style={{ gridColumn: '1 / -1' }}>
          <MachineStatusHeader />
        </div>

        {/* Full-width tool selector */}
        <div style={{ gridColumn: '1 / -1' }}>
          <ToolSelectorPanel />
        </div>

        {/* Left column: temperatures, speed/flow */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TemperaturePanel />
          <SpeedFlowPanel />
          <FanControlPanel />
        </div>

        {/* Right column: axes, extruder, power, macros */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AxisMovementPanel />
          <ExtruderControlPanel />
          <AtxPowerPanel />
          <MacroPanel />
        </div>

        {/* Full-width custom buttons */}
        <div style={{ gridColumn: '1 / -1' }}>
          <DuetCustomButtons />
        </div>

        {/* Full-width system info */}
        <div style={{ gridColumn: '1 / -1' }}>
          <SystemInfoPanel />
        </div>
      </div>
    </div>
  );
}

import { Fragment, useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  Thermometer, Home, ArrowUp, ArrowDown, Power, Play, Fan,
  Gauge, Droplets, Cpu, Clock, ChevronUp, ChevronDown,
  MoveHorizontal, Zap, FileText, Server, HardDrive, Wifi,
  Wrench, XCircle, Package,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

// ---------------------------------------------------------------------------
// Theme — shared CSS-var tokens so all pages follow the active theme
// ---------------------------------------------------------------------------
import { colors as COLORS } from '../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../utils/printerPanelStyles';
import DuetCustomButtons from './DuetCustomButtons';

const HEATER_CHART_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

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
    case 'active': return COLORS.success;
    case 'standby': return COLORS.warning;
    case 'fault': return COLORS.danger;
    case 'tuning': return COLORS.accent;
    default: return COLORS.textDim;
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
    <div style={panelStyle()} className="duet-dash-status-header">
      <div className="duet-dash-status-main">
        <div
          className="duet-dash-status-dot"
          style={{
            '--duet-status-dot': statusColor(status),
          } as CSSProperties}
        />
        <span className="duet-dash-status-text">{status}</span>
      </div>
      {board && (
        <>
          <div className="duet-dash-muted-row">
            <Cpu size={13} />
            <span>{board.name || board.shortName}</span>
          </div>
          <div className="duet-dash-muted-text">
            {board.firmwareName} {board.firmwareVersion}
          </div>
        </>
      )}
      <div className="duet-dash-muted-row duet-dash-uptime">
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Thermometer size={14} /> Temperatures
      </div>

      {/* Heater table */}
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
                <div className="duet-dash-tempbar-wrap">
                <div style={{
                  height: '100%', width: `${barPct}%`, borderRadius: 4,
                  background: tempBarGradient(current),
                  transition: 'width 0.3s ease',
                }} />
              </div>

              {/* Heater state indicator */}
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
    <svg viewBox={`0 0 ${W} ${H}`} className="duet-dash-tempchart">
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <MoveHorizontal size={14} /> Axes &amp; Movement
      </div>

      {/* Current positions with endstop indicators */}
      <div className="duet-dash-axis-pos-wrap">
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
            <div key={ax.letter} className="duet-dash-axis-card" style={{ background: COLORS.surface }}>
              <div className="duet-dash-axis-card-head">
                {ax.letter}
                {!ax.homed && <span className="duet-dash-axis-unhomed" style={{ color: COLORS.warning }}>?</span>}
                <div
                  className="duet-dash-axis-endstop-dot"
                  style={{
                    '--duet-axis-endstop': endstopColor,
                    '--duet-axis-endstop-glow': endstop?.triggered ? `0 0 5px ${endstopColor}` : 'none',
                  } as CSSProperties}
                  title={endstopTitle}
                />
              </div>
              <div className="duet-dash-axis-value">
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
          <div className="duet-dash-comp-row">
            <span
              className="duet-dash-comp-badge"
              style={{
                '--duet-comp-bg': hasComp ? 'rgba(34,197,94,0.15)' : 'rgba(136,136,170,0.15)',
                '--duet-comp-color': hasComp ? COLORS.success : COLORS.textDim,
                '--duet-comp-border': hasComp ? 'rgba(34,197,94,0.3)' : 'rgba(136,136,170,0.2)',
              } as CSSProperties}
            >
              Mesh Comp: {hasComp ? 'Active' : 'Off'}
            </span>
          </div>
        );
      })()}

      {/* Home buttons */}
      <div className="duet-dash-home-row">
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
      <div className="duet-dash-step-block">
        <div className="duet-dash-label-xs">Step Size (mm)</div>
        <div className="duet-dash-step-options">
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
        <div key={ax.letter} className="duet-dash-jog-row">
          <span className="duet-dash-jog-axis">{ax.letter}</span>
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
      <div className="duet-dash-baby-block" style={{ borderTopColor: COLORS.panelBorder }}>
        <div className="duet-dash-label-xs duet-dash-baby-label">Baby Stepping (Z offset)</div>
        <div className="duet-dash-baby-row">
          <button style={btnStyle()} onClick={() => { setBabyStep(-0.02); setBabyStepValue((v) => v - 0.02); }}>
            <ChevronDown size={12} /> -0.02
          </button>
          <span className="duet-dash-baby-value">
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Droplets size={14} /> Extruder
      </div>

      {/* Tool selector */}
      {tools.length > 1 && (
        <div className="duet-dash-extruder-tool-row">
          <span className="duet-dash-label-sm">Tool:</span>
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
      <div className="duet-dash-extruder-block">
        <div className="duet-dash-label-xs">Amount (mm)</div>
        <div className="duet-dash-extruder-row">
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
      <div className="duet-dash-extruder-tool-row duet-dash-extruder-feed-row">
        <span className="duet-dash-label-xs">Feedrate (mm/min):</span>
        <input
          type="number"
          style={inputStyle(80)}
          value={feedrate}
          onChange={(e) => setFeedrate(Number(e.target.value))}
          min={1}
        />
      </div>

      {/* Extrude / Retract */}
      <div className="duet-dash-extruder-actions">
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Gauge size={14} /> Speed &amp; Flow
      </div>

      {/* Speed factor */}
      <div className="duet-dash-flow-block">
        <div className="duet-dash-label-sm">Speed Factor</div>
        <div className="duet-dash-slider-row">
          <input
            type="range"
            min={50} max={200} step={1}
            value={speedInput !== '' ? speedInput : currentSpeedPct}
            onChange={(e) => setSpeedInput(e.target.value)}
            onMouseUp={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            onTouchEnd={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            className="duet-dash-range"
            style={{ accentColor: COLORS.accent }}
          />
          <input
            type="number"
            style={inputStyle(55)}
            value={speedInput !== '' ? speedInput : currentSpeedPct}
            onChange={(e) => setSpeedInput(e.target.value)}
            onBlur={() => { if (speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && speedInput !== '') { setSpeedFactor(Number(speedInput)); setSpeedInput(''); } }}
          />
          <span className="duet-dash-slider-unit">%</span>
        </div>
      </div>

      {/* Extrusion factor per extruder */}
      {extruders.map((ext, i) => {
        const pct = Math.round(ext.factor * 100);
        const localVal = extFactors[i];
        return (
          <div key={i} className="duet-dash-flow-block duet-dash-flow-block-last">
            <div className="duet-dash-label-sm">Extruder {i} Flow</div>
            <div className="duet-dash-slider-row">
              <input
                type="range"
                min={50} max={150} step={1}
                value={localVal ?? pct}
                onChange={(e) => setExtFactors((p) => ({ ...p, [i]: e.target.value }))}
                onMouseUp={() => { if (localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                onTouchEnd={() => { if (localVal !== undefined) { setExtrusionFactor(i, Number(localVal)); setExtFactors((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                className="duet-dash-range"
                style={{ accentColor: COLORS.accent }}
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
              <span className="duet-dash-slider-unit">%</span>
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Fan size={14} /> Fans
      </div>

      {fans.map((fan, i) => {
        const pct = Math.round(fan.actualValue * 100);
        const localVal = localFanValues[i];
        return (
          <div key={i} className="duet-dash-fan-item">
            <div className="duet-dash-fan-header">
              <span className="duet-dash-fan-name">{fan.name || `Fan ${i}`}</span>
              {fan.rpm > 0 && (
                <span className="duet-dash-fan-rpm">{fan.rpm} RPM</span>
              )}
            </div>
            <div className="duet-dash-slider-row">
              <input
                type="range"
                min={0} max={100} step={1}
                value={localVal ?? pct}
                onChange={(e) => setLocalFanValues((p) => ({ ...p, [i]: e.target.value }))}
                onMouseUp={() => { if (localVal !== undefined) { setFanSpeed(i, Number(localVal)); setLocalFanValues((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                onTouchEnd={() => { if (localVal !== undefined) { setFanSpeed(i, Number(localVal)); setLocalFanValues((p) => { const n = { ...p }; delete n[i]; return n; }); } }}
                className="duet-dash-range"
                style={{ accentColor: COLORS.accent }}
              />
              <span className="duet-dash-fan-value">
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Server size={14} /> System Info
      </div>

      <div className="duet-dash-sys-grid">
        {/* Board Info */}
        <div className="duet-dash-sys-card duet-dash-sys-span-full" style={{ background: COLORS.surface }}>
          <div className="duet-dash-sys-label">Board</div>
          <div className="duet-dash-sys-strong">{board.name || board.shortName}</div>
          <div className="duet-dash-sys-subtext">
            {board.firmwareName} {board.firmwareVersion}
          </div>
          {board.firmwareDate && (
            <div className="duet-dash-sys-subtext duet-dash-sys-subtext-tight">
              Built: {board.firmwareDate}
            </div>
          )}
        </div>

        {/* MCU Temperature */}
        {mcuTemp && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Cpu size={10} /> MCU Temp
            </div>
            <div className="duet-dash-sys-value-row">
              <div className="duet-dash-sys-dot" style={{
                '--duet-sys-dot': tempColorIndicator(mcuTemp.current),
              } as CSSProperties} />
              <span className="duet-dash-sys-mono-lg">
                {mcuTemp.current.toFixed(1)}&deg;C
              </span>
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {mcuTemp.min.toFixed(1)}&deg;C / Max: {mcuTemp.max.toFixed(1)}&deg;C
            </div>
          </div>
        )}

        {/* Input Voltage */}
        {vIn && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Zap size={10} /> Vin
            </div>
            <div className="duet-dash-sys-value-row">
              <div className="duet-dash-sys-dot" style={{
                '--duet-sys-dot': vinColorIndicator(vIn.current),
              } as CSSProperties} />
              <span className="duet-dash-sys-mono-lg">
                {vIn.current.toFixed(1)}V
              </span>
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {vIn.min.toFixed(1)}V / Max: {vIn.max.toFixed(1)}V
            </div>
          </div>
        )}

        {/* 5V Rail (v12) */}
        {v12 && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Zap size={10} /> 5V Rail
            </div>
            <div className="duet-dash-sys-mono-lg">
              {v12.current.toFixed(2)}V
            </div>
            <div className="duet-dash-sys-subtext-top">
              Min: {v12.min.toFixed(2)}V / Max: {v12.max.toFixed(2)}V
            </div>
          </div>
        )}

        {/* Uptime */}
        <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
          <div className="duet-dash-sys-head-row">
            <Clock size={10} /> Uptime
          </div>
          <div className="duet-dash-sys-mono">
            {formatUptime(upTime)}
          </div>
        </div>

        {/* Network */}
        {network && (
          <div className="duet-dash-sys-card" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <Wifi size={10} /> Network
            </div>
            <div className="duet-dash-sys-strong-sm">{network.hostname || network.name}</div>
            {iface && (
              <>
                <div className="duet-dash-sys-subtext duet-dash-sys-subtext-top-tight">
                  {iface.actualIP}
                </div>
                <div className="duet-dash-sys-subtext">
                  {iface.type} {iface.speed > 0 ? `(${iface.speed}Mbps)` : ''}
                </div>
              </>
            )}
          </div>
        )}

        {/* Free Space */}
        {volumes.length > 0 && (
          <div className="duet-dash-sys-card duet-dash-sys-span-full" style={{ background: COLORS.surface }}>
            <div className="duet-dash-sys-head-row">
              <HardDrive size={10} /> Storage
            </div>
            <div className="duet-dash-sys-storage-wrap">
              {volumes.filter((v) => v.mounted).map((vol, i) => {
                const usedPct = vol.totalSpace > 0 ? ((vol.totalSpace - vol.freeSpace) / vol.totalSpace) * 100 : 0;
                return (
                  <div key={i} className="duet-dash-sys-storage-item">
                    <div className="duet-dash-sys-storage-name">{vol.path || vol.name || `Volume ${i}`}</div>
                    <div className="duet-dash-sys-subtext duet-dash-sys-subtext-top-tight">
                      {formatBytes(vol.freeSpace)} free / {formatBytes(vol.totalSpace)}
                    </div>
                    <div className="duet-dash-sys-storage-bar" style={{ background: COLORS.inputBg }}>
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
    <div style={panelStyle()} className="duet-dash-atx-row">
      <div className="duet-dash-atx-title">
        <Zap size={14} color={atxPower ? COLORS.success : COLORS.textDim} />
        <span className="duet-dash-atx-name">ATX Power</span>
      </div>
      <button
        style={{
          ...btnStyle(atxPower ? 'danger' : 'success'),
          minWidth: 60,
        }}
        className="duet-dash-atx-btn"
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
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <FileText size={14} /> Macros
      </div>
      <div className="duet-dash-macro-list">
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
      <div style={labelStyle()} className="duet-dash-tools-header-row">
        <div className="duet-dash-section-title-row">
          <Wrench size={14} /> Tools
        </div>
        {currentTool >= 0 && (
          <button
            style={{
              ...btnStyle('default', true),
              fontSize: 10,
              textTransform: 'uppercase' as CSSProperties['textTransform'],
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
            className="duet-dash-tool-card"
            style={{
              '--duet-tool-card-bg': isActive ? 'rgba(80, 120, 255, 0.12)' : COLORS.surface,
              '--duet-tool-card-border': isActive ? COLORS.accent : COLORS.panelBorder,
            } as CSSProperties}
          >
            {/* Tool header row */}
            <div className="duet-dash-tool-card-header">
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
              <span className="duet-dash-tool-name">{toolName}</span>
              <div className="duet-dash-tool-state-wrap">
                <div
                  className="duet-dash-tool-state-dot"
                  style={{
                    '--duet-tool-state-color': toolStateColor(tool.state),
                    '--duet-tool-state-glow': tool.state !== 'off' ? `0 0 6px ${toolStateColor(tool.state)}` : 'none',
                  } as CSSProperties}
                />
                <span className="duet-dash-tool-state-text" style={{ '--duet-tool-state-color': toolStateColor(tool.state) } as CSSProperties}>
                  {tool.state}
                </span>
              </div>
            </div>

            {/* Heaters with temperature inputs */}
            {tool.heaters.length > 0 && (
              <div className="duet-dash-tool-section">
                <div className="duet-dash-tool-section-title">Heaters</div>
                <div className="duet-dash-tool-heaters-grid">
                  <span className="duet-dash-tool-heaters-col">Heater</span>
                  <span className="duet-dash-tool-heaters-col">Current</span>
                  <span className="duet-dash-tool-heaters-col">Active</span>
                  <span className="duet-dash-tool-heaters-col">Standby</span>

                  {tool.heaters.map((hIdx, hi) => {
                    const h = heaters[hIdx];
                    if (!h) return null;
                    const activeKey = `t${tool.number}-h${hi}-active`;
                    const standbyKey = `t${tool.number}-h${hi}-standby`;

                    return (
                      <Fragment key={hIdx}>
                        <span
                          className="duet-dash-tool-heater-name"
                          style={{ '--duet-heater-color': HEATER_CHART_COLORS[hIdx % HEATER_CHART_COLORS.length] } as CSSProperties}
                        >
                          H{hIdx}
                          <span
                            className="duet-dash-tool-heater-dot"
                            style={{ '--duet-heater-state': heaterStateColor(h.state) } as CSSProperties}
                          />
                        </span>
                        <span className="duet-dash-tool-heater-current">
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
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tool Offsets */}
            {tool.offsets && tool.offsets.some((o) => o !== 0) && (
              <div className="duet-dash-tool-section">
                <div className="duet-dash-tool-section-title">Offsets</div>
                <div className="duet-dash-tool-offsets">
                  {tool.offsets.map((offset, idx) => {
                    const axisLetter = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'][idx] ?? `#${idx}`;
                    return (
                      <div key={idx} className="duet-dash-tool-offset-chip" style={{ background: COLORS.inputBg }}>
                        <span className="duet-dash-tool-offset-axis">{axisLetter}:</span>{' '}
                        <span className="duet-dash-tool-offset-value">{offset.toFixed(3)}</span>
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
                <div className="duet-dash-tool-section">
                  <div className="duet-dash-tool-section-title">Filament</div>
                  <div className="duet-dash-tool-filament-row">
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
            <div className="duet-dash-tool-assigned-row">
              {tool.extruders.length > 0 && (
                <div className="duet-dash-tool-assigned-item">
                  <Droplets size={11} color={COLORS.textDim} />
                  <span className="duet-dash-tool-assigned-label">Extruders:</span>
                  <span>{tool.extruders.join(', ')}</span>
                </div>
              )}
              {tool.fans.length > 0 && (
                <div className="duet-dash-tool-assigned-item">
                  <Fan size={11} color={COLORS.textDim} />
                  <span className="duet-dash-tool-assigned-label">Fans:</span>
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
    <div className="duet-dash-root" style={{ background: COLORS.bg }}>
      {/* Error banner */}
      {error && (
        <div className="duet-dash-error-banner" style={{ borderColor: COLORS.danger, color: COLORS.danger }}>
          <span>{error}</span>
          <button
            className="duet-dash-error-dismiss"
            style={{ color: COLORS.danger }}
            onClick={() => setError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <div className="duet-dash-layout">
        {/* Full-width status header */}
        <div className="duet-dash-span-full">
          <MachineStatusHeader />
        </div>

        {/* Full-width tool selector */}
        <div className="duet-dash-span-full">
          <ToolSelectorPanel />
        </div>

        {/* Left column: temperatures, speed/flow */}
        <div className="duet-dash-col">
          <TemperaturePanel />
          <SpeedFlowPanel />
          <FanControlPanel />
        </div>

        {/* Right column: axes, extruder, power, macros */}
        <div className="duet-dash-col">
          <AxisMovementPanel />
          <ExtruderControlPanel />
          <AtxPowerPanel />
          <MacroPanel />
        </div>

        {/* Full-width custom buttons */}
        <div className="duet-dash-span-full">
          <DuetCustomButtons />
        </div>

        {/* Full-width system info */}
        <div className="duet-dash-span-full">
          <SystemInfoPanel />
        </div>
      </div>
    </div>
  );
}

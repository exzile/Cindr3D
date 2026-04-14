import React from 'react';
import {
  Activity, CircuitBoard, Crosshair, Cpu, Zap, Radar, Gauge,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';

const EMPTY_ARRAY: readonly never[] = [];

// ---------------------------------------------------------------------------
// Local style helpers — kept in sync with DuetDashboard's look-and-feel
// ---------------------------------------------------------------------------
function panelStyle(): React.CSSProperties {
  return {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 8,
    padding: 16,
  };
}
function sectionTitle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 10,
    fontWeight: 600,
  };
}
function rowGrid(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '6px 12px',
    fontSize: 12,
  };
}
function dim(): React.CSSProperties {
  return { color: COLORS.textDim };
}
function mono(extra?: React.CSSProperties): React.CSSProperties {
  return { fontFamily: 'monospace', fontSize: 12, fontWeight: 600, ...extra };
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function EndstopsPanel() {
  const endstops = usePrinterStore((s) => s.model.sensors?.endstops ?? EMPTY_ARRAY);
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);

  const populated = endstops
    .map((es, i) => ({ es, i }))
    .filter(({ es }) => es != null);

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Crosshair size={14} /> Endstops</div>
        <div style={dim()}>No endstops reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Crosshair size={14} /> Endstops</div>
      <div style={rowGrid()}>
        {populated.map(({ es, i }) => {
          const axisLetter = axes[i]?.letter ?? `#${i}`;
          const triggered = es?.triggered;
          return (
            <React.Fragment key={i}>
              <span>{axisLetter} <span style={dim()}>({es?.type ?? 'unknown'})</span></span>
              <span style={{
                fontWeight: 600,
                color: triggered ? COLORS.danger : COLORS.success,
              }}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ProbesPanel() {
  const probes = usePrinterStore((s) => s.model.sensors?.probes ?? EMPTY_ARRAY);

  const populated = probes
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p != null);

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Radar size={14} /> Z-Probes</div>
        <div style={dim()}>No probes configured.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Radar size={14} /> Z-Probes</div>
      {populated.map(({ p, i }, idx) => {
        const threshold = p?.threshold ?? 0;
        const value = p?.value ?? 0;
        const triggered = threshold > 0 && value >= threshold;
        return (
          <div key={i} style={{ marginBottom: idx < populated.length - 1 ? 12 : 0 }}>
            <div style={{ ...rowGrid(), marginBottom: 4 }}>
              <span style={dim()}>Probe {i} (type {p?.type ?? '—'})</span>
              <span style={{
                fontWeight: 600,
                color: triggered ? COLORS.danger : COLORS.success,
              }}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </div>
            <div style={rowGrid()}>
              <span style={dim()}>Value</span>
              <span style={mono()}>{value} / {threshold}</span>
              <span style={dim()}>Trigger height</span>
              <span style={mono()}>{p?.triggerHeight?.toFixed(3) ?? '—'} mm</span>
              <span style={dim()}>Dive height</span>
              <span style={mono()}>{p?.diveHeight?.toFixed(2) ?? '—'} mm</span>
              <span style={dim()}>Speed</span>
              <span style={mono()}>{p?.speed ?? '—'} mm/s</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalogSensorsPanel() {
  const sensors = usePrinterStore((s) => s.model.sensors?.analog ?? EMPTY_ARRAY);

  // Skip empty entries — Duet pads the array with nulls
  const populated = sensors
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s && s.name);

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Activity size={14} /> Analog Sensors</div>
        <div style={dim()}>No analog sensors reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Activity size={14} /> Analog Sensors</div>
      <div style={rowGrid()}>
        {populated.map(({ s, i }) => (
          <React.Fragment key={i}>
            <span>{s.name} <span style={dim()}>({s.type})</span></span>
            <span style={mono()}>
              {typeof s.lastReading === 'number' ? `${s.lastReading.toFixed(1)}°` : '—'}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function BoardsPanel() {
  const rawBoards = usePrinterStore((s) => s.model.boards ?? EMPTY_ARRAY);
  const boards = rawBoards.filter((b): b is NonNullable<typeof b> => b != null);

  if (boards.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><CircuitBoard size={14} /> Boards</div>
        <div style={dim()}>No board info reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><CircuitBoard size={14} /> Boards</div>
      {boards.map((b, i) => (
        <div key={i} style={{ marginBottom: i < boards.length - 1 ? 12 : 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            {b.name || b.shortName || `Board ${i}`}
          </div>
          <div style={rowGrid()}>
            <span style={dim()}>Firmware</span>
            <span style={mono()}>{b.firmwareName} {b.firmwareVersion}</span>
            {b.firmwareDate && (
              <>
                <span style={dim()}>Build date</span>
                <span style={mono()}>{b.firmwareDate}</span>
              </>
            )}
            {b.mcuTemp && (
              <>
                <span style={dim()}>MCU temp</span>
                <span style={mono()}>
                  {b.mcuTemp.current?.toFixed(1)}° (min {b.mcuTemp.min?.toFixed(0)}°, max {b.mcuTemp.max?.toFixed(0)}°)
                </span>
              </>
            )}
            {b.vIn && (
              <>
                <span style={dim()}>VIN</span>
                <span style={mono()}>
                  {b.vIn.current?.toFixed(1)} V (min {b.vIn.min?.toFixed(1)}, max {b.vIn.max?.toFixed(1)})
                </span>
              </>
            )}
            {b.v12 && (
              <>
                <span style={dim()}>V12</span>
                <span style={mono()}>{b.v12.current?.toFixed(1)} V</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DriversPanel() {
  // Drivers info lives on each axis in move.axes[].drivers; show flagged status
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);
  const extruders = usePrinterStore((s) => s.model.move?.extruders ?? EMPTY_ARRAY);

  const rows: { label: string; driver: string }[] = [];
  for (const a of axes) {
    if (a.letter) rows.push({ label: a.letter, driver: '' });
  }
  for (let i = 0; i < extruders.length; i++) {
    rows.push({ label: `E${i}`, driver: extruders[i]?.driver ?? '' });
  }

  if (rows.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Cpu size={14} /> Motor Drivers</div>
      <div style={rowGrid()}>
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <span>{r.label}</span>
            <span style={mono()}>{r.driver || '—'}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function GpioPanel() {
  // Duet exposes gpOut on state in newer firmwares; fall back to nothing
  const state = usePrinterStore((s) => s.model.state) as
    | { gpOut?: Array<{ pwm: number } | null> }
    | undefined;
  const gpOut = state?.gpOut ?? [];

  const populated = gpOut
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g != null);

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Zap size={14} /> General Purpose Outputs</div>
        <div style={dim()}>No GP outputs configured.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Zap size={14} /> General Purpose Outputs</div>
      <div style={rowGrid()}>
        {populated.map(({ g, i }) => (
          <React.Fragment key={i}>
            <span>GP{i}</span>
            <span style={mono()}>{((g?.pwm ?? 0) * 100).toFixed(0)}%</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function MachineSummaryPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const move = usePrinterStore((s) => s.model.move);

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Gauge size={14} /> Machine Summary</div>
      <div style={rowGrid()}>
        <span style={dim()}>Status</span>
        <span style={mono()}>{state?.status ?? 'unknown'}</span>
        <span style={dim()}>Current tool</span>
        <span style={mono()}>{(state?.currentTool ?? -1) >= 0 ? `T${state?.currentTool}` : 'none'}</span>
        <span style={dim()}>Compensation</span>
        <span style={mono()}>{move?.compensation?.type ?? 'none'}</span>
        <span style={dim()}>Workplace</span>
        <span style={mono()}>G54</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function DuetStatus() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 10,
      padding: 12,
      alignItems: 'start',
    }}>
      <MachineSummaryPanel />
      <EndstopsPanel />
      <ProbesPanel />
      <AnalogSensorsPanel />
      <BoardsPanel />
      <DriversPanel />
      <GpioPanel />
    </div>
  );
}

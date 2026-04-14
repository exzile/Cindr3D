import { Fragment } from 'react';
import {
  Activity, CircuitBoard, Crosshair, Cpu, Zap, Radar, Gauge,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import {
  panelStyle,
  sectionTitleStyle as sectionTitle,
  twoColRowGridStyle as rowGrid,
} from '../../utils/printerPanelStyles';

const EMPTY_ARRAY: readonly never[] = [];

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
        <div className="duet-status-dim">No endstops reported.</div>
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
            <Fragment key={i}>
              <span>{axisLetter} <span className="duet-status-dim">({es?.type ?? 'unknown'})</span></span>
              <span className={`duet-status-flag ${triggered ? 'danger' : 'success'}`}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </Fragment>
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
        <div className="duet-status-dim">No probes configured.</div>
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
          <div key={i} className={idx < populated.length - 1 ? 'duet-status-block' : undefined}>
            <div style={rowGrid()} className="duet-status-row-gap">
              <span className="duet-status-dim">Probe {i} (type {p?.type ?? '—'})</span>
              <span className={`duet-status-flag ${triggered ? 'danger' : 'success'}`}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </div>
            <div style={rowGrid()}>
              <span className="duet-status-dim">Value</span>
              <span className="duet-status-mono">{value} / {threshold}</span>
              <span className="duet-status-dim">Trigger height</span>
              <span className="duet-status-mono">{p?.triggerHeight?.toFixed(3) ?? '—'} mm</span>
              <span className="duet-status-dim">Dive height</span>
              <span className="duet-status-mono">{p?.diveHeight?.toFixed(2) ?? '—'} mm</span>
              <span className="duet-status-dim">Speed</span>
              <span className="duet-status-mono">{p?.speed ?? '—'} mm/s</span>
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
        <div className="duet-status-dim">No analog sensors reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Activity size={14} /> Analog Sensors</div>
      <div style={rowGrid()}>
        {populated.map(({ s, i }) => (
          <Fragment key={i}>
            <span>{s.name} <span className="duet-status-dim">({s.type})</span></span>
            <span className="duet-status-mono">
              {typeof s.lastReading === 'number' ? `${s.lastReading.toFixed(1)}°` : '—'}
            </span>
          </Fragment>
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
        <div className="duet-status-dim">No board info reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><CircuitBoard size={14} /> Boards</div>
      {boards.map((b, i) => (
        <div key={i} className={i < boards.length - 1 ? 'duet-status-block' : undefined}>
          <div className="duet-status-board-title">
            {b.name || b.shortName || `Board ${i}`}
          </div>
          <div style={rowGrid()}>
            <span className="duet-status-dim">Firmware</span>
            <span className="duet-status-mono">{b.firmwareName} {b.firmwareVersion}</span>
            {b.firmwareDate && (
              <>
                <span className="duet-status-dim">Build date</span>
                <span className="duet-status-mono">{b.firmwareDate}</span>
              </>
            )}
            {b.mcuTemp && (
              <>
                <span className="duet-status-dim">MCU temp</span>
                <span className="duet-status-mono">
                  {b.mcuTemp.current?.toFixed(1)}° (min {b.mcuTemp.min?.toFixed(0)}°, max {b.mcuTemp.max?.toFixed(0)}°)
                </span>
              </>
            )}
            {b.vIn && (
              <>
                <span className="duet-status-dim">VIN</span>
                <span className="duet-status-mono">
                  {b.vIn.current?.toFixed(1)} V (min {b.vIn.min?.toFixed(1)}, max {b.vIn.max?.toFixed(1)})
                </span>
              </>
            )}
            {b.v12 && (
              <>
                <span className="duet-status-dim">V12</span>
                <span className="duet-status-mono">{b.v12.current?.toFixed(1)} V</span>
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
          <Fragment key={i}>
            <span>{r.label}</span>
            <span className="duet-status-mono">{r.driver || '—'}</span>
          </Fragment>
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
        <div className="duet-status-dim">No GP outputs configured.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Zap size={14} /> General Purpose Outputs</div>
      <div style={rowGrid()}>
        {populated.map(({ g, i }) => (
          <Fragment key={i}>
            <span>GP{i}</span>
            <span className="duet-status-mono">{((g?.pwm ?? 0) * 100).toFixed(0)}%</span>
          </Fragment>
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
        <span className="duet-status-dim">Status</span>
        <span className="duet-status-mono">{state?.status ?? 'unknown'}</span>
        <span className="duet-status-dim">Current tool</span>
        <span className="duet-status-mono">{(state?.currentTool ?? -1) >= 0 ? `T${state?.currentTool}` : 'none'}</span>
        <span className="duet-status-dim">Compensation</span>
        <span className="duet-status-mono">{move?.compensation?.type ?? 'none'}</span>
        <span className="duet-status-dim">Workplace</span>
        <span className="duet-status-mono">G54</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function DuetStatus() {
  return (
    <div className="duet-status-grid">
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

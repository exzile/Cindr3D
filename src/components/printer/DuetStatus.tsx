import type { CSSProperties } from 'react';
import { Fragment, useState, useCallback } from 'react';
import {
  Activity, CircuitBoard, Crosshair, Cpu, Zap, Radar, Gauge, Network,
  Disc, Focus,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';
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

function SpindlePanel() {
  const spindles = usePrinterStore((s) => s.model.spindles ?? EMPTY_ARRAY);

  const populated = spindles
    .map((sp, i) => ({ sp, i }))
    .filter(({ sp }) => sp != null && sp.state !== 'unconfigured');

  if (populated.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Disc size={14} /> Spindles</div>
      {populated.map(({ sp, i }, idx) => {
        const stateLabel = sp.state === 'forward' ? 'FORWARD' : sp.state === 'reverse' ? 'REVERSE' : 'IDLE';
        const stateClass = sp.state === 'stopped' ? '' : 'success';
        return (
          <div key={i} className={idx < populated.length - 1 ? 'duet-status-block' : undefined}>
            <div className="duet-status-board-title">Spindle {i}</div>
            <div style={rowGrid()}>
              <span className="duet-status-dim">State</span>
              <span className={`duet-status-flag ${stateClass}`}>{stateLabel}</span>
              <span className="duet-status-dim">Current RPM</span>
              <span className="duet-status-mono">{sp.current ?? 0}</span>
              <span className="duet-status-dim">Active speed</span>
              <span className="duet-status-mono">{sp.active ?? 0} RPM</span>
              <span className="duet-status-dim">Range</span>
              <span className="duet-status-mono">{sp.min ?? 0} – {sp.max ?? 0} RPM</span>
              {sp.tool >= 0 && (
                <>
                  <span className="duet-status-dim">Tool</span>
                  <span className="duet-status-mono">T{sp.tool}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LaserPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const laserPwm = (state as Record<string, unknown> | undefined)?.laserPwm;

  if (typeof laserPwm !== 'number') return null;

  const pct = (laserPwm * 100).toFixed(1);

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Focus size={14} /> Laser</div>
      <div style={rowGrid()}>
        <span className="duet-status-dim">PWM</span>
        <span className="duet-status-mono">{laserPwm.toFixed(3)}</span>
        <span className="duet-status-dim">Power</span>
        <span className="duet-status-mono">{pct}%</span>
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
            {i > 0 && (b as Record<string, unknown>).canAddress != null && (
              <span className="duet-status-dim" style={{ fontWeight: 400, marginLeft: 6 }}>
                (CAN {String((b as Record<string, unknown>).canAddress)})
              </span>
            )}
          </div>
          <div style={rowGrid()}>
            {i > 0 && (b as Record<string, unknown>).canAddress != null && (
              <>
                <span className="duet-status-dim">CAN address</span>
                <span className="duet-status-mono">{String((b as Record<string, unknown>).canAddress)}</span>
              </>
            )}
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

/**
 * Resolve a status badge for a motor driver.
 *
 * The Duet object model may expose per-driver status flags on axes and
 * extruders (e.g. `status` field with values like "ok", "stall",
 * "standstill", "overTemperature", "openLoad", etc.). When those flags
 * are not available we fall back to a neutral "OK" indicator.
 */
function driverBadge(status?: string): { text: string; color: string; bg: string } {
  if (!status) {
    return { text: 'OK', color: COLORS.success, bg: 'rgba(76,175,80,0.12)' };
  }
  const s = status.toLowerCase();
  if (s === 'stall' || s === 'stalled' || s === 'standstill') {
    return { text: 'STALL', color: COLORS.danger, bg: 'rgba(244,67,54,0.12)' };
  }
  if (s.includes('overtemp') || s.includes('over_temp') || s.includes('overtemperature')) {
    return { text: 'OVER-TEMP', color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
  }
  if (s.includes('openload') || s.includes('open_load') || s === 'openload') {
    return { text: 'OPEN LOAD', color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
  }
  if (s === 'ok' || s === 'good') {
    return { text: 'OK', color: COLORS.success, bg: 'rgba(76,175,80,0.12)' };
  }
  // Unknown / other — show as warning-style with the raw text
  return { text: status.toUpperCase(), color: COLORS.warning, bg: 'rgba(255,152,0,0.12)' };
}

function DriversPanel() {
  // Drivers info lives on each axis in move.axes[].drivers; show flagged status
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);
  const extruders = usePrinterStore((s) => s.model.move?.extruders ?? EMPTY_ARRAY);

  const rows: { label: string; driver: string; status?: string }[] = [];
  for (const a of axes) {
    if (!a.letter) continue;
    // Axis driver IDs come from the drives array; status may be present
    // on the axis object itself (firmware-dependent).
    const axisAny = a as Record<string, unknown>;
    const driverIds = Array.isArray(a.drives) ? a.drives.map(String).join(', ') : '';
    const status = typeof axisAny.status === 'string' ? axisAny.status : undefined;
    rows.push({ label: a.letter, driver: driverIds, status });
  }
  for (let i = 0; i < extruders.length; i++) {
    const ext = extruders[i];
    const extAny = ext as Record<string, unknown> | undefined;
    const status = typeof extAny?.status === 'string' ? extAny.status : undefined;
    rows.push({ label: `E${i}`, driver: ext?.driver ?? '', status });
  }

  if (rows.length === 0) return null;

  const badgeStyle = (badge: ReturnType<typeof driverBadge>): CSSProperties => ({
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.03em',
    color: badge.color,
    background: badge.bg,
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Cpu size={14} /> Motor Drivers</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto',
        gap: '6px 12px',
        fontSize: 12,
        alignItems: 'center',
      }}>
        {rows.map((r, i) => {
          const badge = driverBadge(r.status);
          return (
            <Fragment key={i}>
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              <span className="duet-status-mono">{r.driver || '—'}</span>
              <span style={badgeStyle(badge)}>{badge.text}</span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function GpioPanel() {
  // Duet exposes gpOut on state in newer firmwares; fall back to nothing
  const state = usePrinterStore((s) => s.model.state) as
    | { gpOut?: Array<{ pwm: number } | null> }
    | undefined;
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const gpOut = state?.gpOut ?? [];

  const populated = gpOut
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g != null);

  // Track local slider values during drag
  const [localPwm, setLocalPwm] = useState<Record<number, number>>({});

  const handleToggle = useCallback(
    (pin: number, currentPwm: number) => {
      const newValue = currentPwm > 0 ? 0 : 1;
      sendGCode(`M42 P${pin} S${newValue}`);
    },
    [sendGCode],
  );

  const handleSliderCommit = useCallback(
    (pin: number) => {
      const value = localPwm[pin];
      if (value !== undefined) {
        // Convert 0-100 percent to 0-1 for M42
        const s = Math.round(value) === 0 ? 0 : Math.round(value) === 100 ? 1 : (value / 100);
        sendGCode(`M42 P${pin} S${s.toFixed(2)}`);
        setLocalPwm((prev) => {
          const next = { ...prev };
          delete next[pin];
          return next;
        });
      }
    },
    [localPwm, sendGCode],
  );

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
      {populated.map(({ g, i }) => {
        const pwm = g?.pwm ?? 0;
        const pct = Math.round(pwm * 100);
        const displayPct = localPwm[i] !== undefined ? Math.round(localPwm[i]) : pct;

        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: `1px solid ${COLORS.panelBorder}`,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>
              GP{i}
            </span>

            {/* Toggle switch for digital on/off */}
            <button
              onClick={() => handleToggle(i, pwm)}
              title={pwm > 0 ? `Turn off GP${i} (M42 P${i} S0)` : `Turn on GP${i} (M42 P${i} S1)`}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                background: pwm > 0 ? COLORS.success : COLORS.surface,
                transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 3,
                  left: pwm > 0 ? 19 : 3,
                  transition: 'left 0.2s',
                }}
              />
            </button>

            {/* PWM slider — useful for non-digital control */}
            {(
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={displayPct}
                  onChange={(e) =>
                    setLocalPwm((prev) => ({ ...prev, [i]: Number(e.target.value) }))
                  }
                  onMouseUp={() => handleSliderCommit(i)}
                  onTouchEnd={() => handleSliderCommit(i)}
                  style={{ flex: 1, accentColor: COLORS.accent }}
                  title={`Set GP${i} PWM (0-100%)`}
                />
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: 600,
                    minWidth: 36,
                    textAlign: 'right',
                  }}
                >
                  {displayPct}%
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NetworkPanel() {
  const interfaces = usePrinterStore(
    (s) => s.model.network?.interfaces ?? EMPTY_ARRAY,
  );

  const populated = interfaces.filter(
    (iface): iface is NonNullable<typeof iface> => iface != null,
  );

  if (populated.length === 0) {
    return (
      <div style={panelStyle()}>
        <div style={sectionTitle()}><Network size={14} /> Network</div>
        <div className="duet-status-dim">No network interfaces reported.</div>
      </div>
    );
  }

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Network size={14} /> Network</div>
      {populated.map((iface, i) => (
        <div key={i} className={i < populated.length - 1 ? 'duet-status-block' : undefined}>
          <div className="duet-status-board-title">
            {iface.type}{iface.speed ? ` (${iface.speed} Mbps)` : ''}
          </div>
          <div style={rowGrid()}>
            <span className="duet-status-dim">IP address</span>
            <span className="duet-status-mono">{iface.actualIP || '—'}</span>
            <span className="duet-status-dim">Subnet</span>
            <span className="duet-status-mono">{iface.subnet || '—'}</span>
            <span className="duet-status-dim">Gateway</span>
            <span className="duet-status-mono">{iface.gateway || '—'}</span>
            <span className="duet-status-dim">MAC address</span>
            <span className="duet-status-mono">{iface.mac || '—'}</span>
            {iface.dnsServer && (
              <>
                <span className="duet-status-dim">DNS server</span>
                <span className="duet-status-mono">{iface.dnsServer}</span>
              </>
            )}
            {iface.ssid && (
              <>
                <span className="duet-status-dim">WiFi SSID</span>
                <span className="duet-status-mono">{iface.ssid}</span>
              </>
            )}
            {iface.signal != null && (
              <>
                <span className="duet-status-dim">WiFi signal</span>
                <span className="duet-status-mono">{iface.signal} dBm</span>
              </>
            )}
            <span className="duet-status-dim">State</span>
            <span className={`duet-status-flag ${iface.state === 'active' ? 'success' : ''}`}>
              {iface.state || '—'}
            </span>
            {iface.activeProtocols.length > 0 && (
              <>
                <span className="duet-status-dim">Active protocols</span>
                <span className="duet-status-mono">{iface.activeProtocols.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      ))}
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
      <SpindlePanel />
      <LaserPanel />
      <BoardsPanel />
      <NetworkPanel />
      <DriversPanel />
      <GpioPanel />
    </div>
  );
}

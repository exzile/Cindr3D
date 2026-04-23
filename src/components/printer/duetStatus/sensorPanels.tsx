import { Fragment, useCallback, useState } from 'react';
import {
  Activity,
  Crosshair,
  Disc,
  Focus,
  Radar,
  Zap,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  panelStyle,
  sectionTitleStyle as sectionTitle,
  twoColRowGridStyle as rowGrid,
} from '../../../utils/printerPanelStyles';

const EMPTY_ARRAY: readonly never[] = [];

export function EndstopsPanel() {
  const endstops = usePrinterStore((s) => s.model.sensors?.endstops ?? EMPTY_ARRAY);
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);
  const populated = endstops.map((endstop, index) => ({ endstop, index })).filter(({ endstop }) => endstop != null);

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
        {populated.map(({ endstop, index }) => {
          const axisLetter = axes[index]?.letter ?? `#${index}`;
          const triggered = endstop?.triggered;
          return (
            <Fragment key={index}>
              <span>{axisLetter} <span className="duet-status-dim">({endstop?.type ?? 'unknown'})</span></span>
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

export function ProbesPanel() {
  const probes = usePrinterStore((s) => s.model.sensors?.probes ?? EMPTY_ARRAY);
  const populated = probes.map((probe, index) => ({ probe, index })).filter(({ probe }) => probe != null);

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
      {populated.map(({ probe, index }, probeIndex) => {
        const threshold = probe?.threshold ?? 0;
        const value = probe?.value ?? 0;
        const triggered = threshold > 0 && value >= threshold;
        return (
          <div key={index} className={probeIndex < populated.length - 1 ? 'duet-status-block' : undefined}>
            <div style={rowGrid()} className="duet-status-row-gap">
              <span className="duet-status-dim">Probe {index} (type {probe?.type ?? '—'})</span>
              <span className={`duet-status-flag ${triggered ? 'danger' : 'success'}`}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </div>
            <div style={rowGrid()}>
              <span className="duet-status-dim">Value</span>
              <span className="duet-status-mono">{value} / {threshold}</span>
              <span className="duet-status-dim">Trigger height</span>
              <span className="duet-status-mono">{probe?.triggerHeight?.toFixed(3) ?? '—'} mm</span>
              <span className="duet-status-dim">Dive height</span>
              <span className="duet-status-mono">{probe?.diveHeight?.toFixed(2) ?? '—'} mm</span>
              <span className="duet-status-dim">Speed</span>
              <span className="duet-status-mono">{probe?.speed ?? '—'} mm/s</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AnalogSensorsPanel() {
  const sensors = usePrinterStore((s) => s.model.sensors?.analog ?? EMPTY_ARRAY);
  const populated = sensors.map((sensor, index) => ({ sensor, index })).filter(({ sensor }) => sensor && sensor.name);

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
        {populated.map(({ sensor, index }) => (
          <Fragment key={index}>
            <span>{sensor.name} <span className="duet-status-dim">({sensor.type})</span></span>
            <span className="duet-status-mono">
              {typeof sensor.lastReading === 'number' ? `${sensor.lastReading.toFixed(1)}°` : '—'}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function SpindlePanel() {
  const spindles = usePrinterStore((s) => s.model.spindles ?? EMPTY_ARRAY);
  const populated = spindles.map((spindle, index) => ({ spindle, index })).filter(({ spindle }) => spindle != null && spindle.state !== 'unconfigured');

  if (populated.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Disc size={14} /> Spindles</div>
      {populated.map(({ spindle, index }, spindleIndex) => {
        const stateLabel = spindle.state === 'forward' ? 'FORWARD' : spindle.state === 'reverse' ? 'REVERSE' : 'IDLE';
        const stateClass = spindle.state === 'stopped' ? '' : 'success';
        return (
          <div key={index} className={spindleIndex < populated.length - 1 ? 'duet-status-block' : undefined}>
            <div className="duet-status-board-title">Spindle {index}</div>
            <div style={rowGrid()}>
              <span className="duet-status-dim">State</span>
              <span className={`duet-status-flag ${stateClass}`}>{stateLabel}</span>
              <span className="duet-status-dim">Current RPM</span>
              <span className="duet-status-mono">{spindle.current ?? 0}</span>
              <span className="duet-status-dim">Active speed</span>
              <span className="duet-status-mono">{spindle.active ?? 0} RPM</span>
              <span className="duet-status-dim">Range</span>
              <span className="duet-status-mono">{spindle.min ?? 0} – {spindle.max ?? 0} RPM</span>
              {spindle.tool >= 0 && (
                <>
                  <span className="duet-status-dim">Tool</span>
                  <span className="duet-status-mono">T{spindle.tool}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LaserPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const laserPwm = (state as Record<string, unknown> | undefined)?.laserPwm;

  if (typeof laserPwm !== 'number') return null;

  return (
    <div style={panelStyle()}>
      <div style={sectionTitle()}><Focus size={14} /> Laser</div>
      <div style={rowGrid()}>
        <span className="duet-status-dim">PWM</span>
        <span className="duet-status-mono">{laserPwm.toFixed(3)}</span>
        <span className="duet-status-dim">Power</span>
        <span className="duet-status-mono">{(laserPwm * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function GpioPanel() {
  const state = usePrinterStore((s) => s.model.state) as { gpOut?: Array<{ pwm: number } | null> } | undefined;
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const gpOut = state?.gpOut ?? [];
  const populated = gpOut.map((gpio, index) => ({ gpio, index })).filter(({ gpio }) => gpio != null);
  const [localPwm, setLocalPwm] = useState<Record<number, number>>({});

  const handleToggle = useCallback((pin: number, currentPwm: number) => {
    sendGCode(`M42 P${pin} S${currentPwm > 0 ? 0 : 1}`);
  }, [sendGCode]);

  const handleSliderCommit = useCallback((pin: number) => {
    const value = localPwm[pin];
    if (value === undefined) return;
    const output = Math.round(value) === 0 ? 0 : Math.round(value) === 100 ? 1 : value / 100;
    sendGCode(`M42 P${pin} S${output.toFixed(2)}`);
    setLocalPwm((prev) => {
      const next = { ...prev };
      delete next[pin];
      return next;
    });
  }, [localPwm, sendGCode]);

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
      {populated.map(({ gpio, index }) => {
        const pwm = gpio?.pwm ?? 0;
        const displayPct = localPwm[index] !== undefined ? Math.round(localPwm[index]) : Math.round(pwm * 100);
        return (
          <div
            key={index}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: `1px solid ${COLORS.panelBorder}`,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>GP{index}</span>
            <button
              onClick={() => handleToggle(index, pwm)}
              title={pwm > 0 ? `Turn off GP${index} (M42 P${index} S0)` : `Turn on GP${index} (M42 P${index} S1)`}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={displayPct}
                onChange={(e) => setLocalPwm((prev) => ({ ...prev, [index]: Number(e.target.value) }))}
                onMouseUp={() => handleSliderCommit(index)}
                onTouchEnd={() => handleSliderCommit(index)}
                style={{ flex: 1, accentColor: COLORS.accent }}
                title={`Set GP${index} PWM (0-100%)`}
              />
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
                {displayPct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

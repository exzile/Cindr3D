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
import { DashboardPanel } from '../dashboard/DashboardPanel';

const EMPTY_ARRAY: readonly never[] = [];

export function EndstopsPanel() {
  const endstops = usePrinterStore((s) => s.model.sensors?.endstops ?? EMPTY_ARRAY);
  const axes = usePrinterStore((s) => s.model.move?.axes ?? EMPTY_ARRAY);
  const populated = endstops.map((endstop, index) => ({ endstop, index })).filter(({ endstop }) => endstop != null);

  if (populated.length === 0) {
    return (
      <DashboardPanel icon={Crosshair} title="Endstops">
        <div className="ds-kv__key">No endstops reported.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={Crosshair} title="Endstops">
      <div className="ds-kv">
        {populated.map(({ endstop, index }) => {
          const axisLetter = axes[index]?.letter ?? `#${index}`;
          const triggered = endstop?.triggered;
          return (
            <Fragment key={index}>
              <span>
                {axisLetter} <span className="ds-kv__key">({endstop?.type ?? 'unknown'})</span>
              </span>
              <span className={`ds-badge ${triggered ? 'ds-badge--err' : 'ds-badge--ok'}`}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </Fragment>
          );
        })}
      </div>
    </DashboardPanel>
  );
}

export function ProbesPanel() {
  const probes = usePrinterStore((s) => s.model.sensors?.probes ?? EMPTY_ARRAY);
  const populated = probes.map((probe, index) => ({ probe, index })).filter(({ probe }) => probe != null);

  if (populated.length === 0) {
    return (
      <DashboardPanel icon={Radar} title="Z-Probes">
        <div className="ds-kv__key">No probes configured.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={Radar} title="Z-Probes">
      {populated.map(({ probe, index }, probeIndex) => {
        const threshold = probe?.threshold ?? 0;
        const value = probe?.value ?? 0;
        const triggered = threshold > 0 && value >= threshold;
        return (
          <Fragment key={index}>
            {probeIndex > 0 && <hr className="ds-sep" />}
            <div className="ds-kv" style={{ marginBottom: 4 }}>
              <span className="ds-kv__key">Probe {index} (type {probe?.type ?? '—'})</span>
              <span className={`ds-badge ${triggered ? 'ds-badge--err' : 'ds-badge--ok'}`}>
                {triggered ? 'TRIGGERED' : 'open'}
              </span>
            </div>
            <div className="ds-kv">
              <span className="ds-kv__key">Value</span>
              <span className="ds-kv__val">{value} / {threshold}</span>
              <span className="ds-kv__key">Trigger height</span>
              <span className="ds-kv__val">{probe?.triggerHeight?.toFixed(3) ?? '—'} mm</span>
              <span className="ds-kv__key">Dive height</span>
              <span className="ds-kv__val">{probe?.diveHeight?.toFixed(2) ?? '—'} mm</span>
              <span className="ds-kv__key">Speed</span>
              <span className="ds-kv__val">{probe?.speed ?? '—'} mm/s</span>
            </div>
          </Fragment>
        );
      })}
    </DashboardPanel>
  );
}

export function AnalogSensorsPanel() {
  const sensors = usePrinterStore((s) => s.model.sensors?.analog ?? EMPTY_ARRAY);
  const populated = sensors.map((sensor, index) => ({ sensor, index })).filter(({ sensor }) => sensor && sensor.name);

  if (populated.length === 0) {
    return (
      <DashboardPanel icon={Activity} title="Analog Sensors">
        <div className="ds-kv__key">No analog sensors reported.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={Activity} title="Analog Sensors">
      <div className="ds-kv">
        {populated.map(({ sensor, index }) => (
          <Fragment key={index}>
            <span>
              {sensor.name} <span className="ds-kv__key">({sensor.type})</span>
            </span>
            <span className="ds-kv__val">
              {typeof sensor.lastReading === 'number' ? `${sensor.lastReading.toFixed(1)}°` : '—'}
            </span>
          </Fragment>
        ))}
      </div>
    </DashboardPanel>
  );
}

export function SpindlePanel() {
  const spindles = usePrinterStore((s) => s.model.spindles ?? EMPTY_ARRAY);
  const populated = spindles.map((spindle, index) => ({ spindle, index })).filter(({ spindle }) => spindle != null && spindle.state !== 'unconfigured');

  if (populated.length === 0) return null;

  return (
    <DashboardPanel icon={Disc} title="Spindles">
      {populated.map(({ spindle, index }, spindleIndex) => {
        const stateLabel = spindle.state === 'forward' ? 'FORWARD' : spindle.state === 'reverse' ? 'REVERSE' : 'IDLE';
        const stateVariant = spindle.state === 'stopped' ? 'ds-badge--dim' : 'ds-badge--ok';
        return (
          <Fragment key={index}>
            {spindleIndex > 0 && <hr className="ds-sep" />}
            <div className="ds-sub-title">Spindle {index}</div>
            <div className="ds-kv">
              <span className="ds-kv__key">State</span>
              <span className={`ds-badge ${stateVariant}`}>{stateLabel}</span>
              <span className="ds-kv__key">Current RPM</span>
              <span className="ds-kv__val">{spindle.current ?? 0}</span>
              <span className="ds-kv__key">Active speed</span>
              <span className="ds-kv__val">{spindle.active ?? 0} RPM</span>
              <span className="ds-kv__key">Range</span>
              <span className="ds-kv__val">{spindle.min ?? 0} – {spindle.max ?? 0} RPM</span>
              {spindle.tool >= 0 && (
                <>
                  <span className="ds-kv__key">Tool</span>
                  <span className="ds-kv__val">T{spindle.tool}</span>
                </>
              )}
            </div>
          </Fragment>
        );
      })}
    </DashboardPanel>
  );
}

export function LaserPanel() {
  const state = usePrinterStore((s) => s.model.state);
  const laserPwm = (state as Record<string, unknown> | undefined)?.laserPwm;

  if (typeof laserPwm !== 'number') return null;

  return (
    <DashboardPanel icon={Focus} title="Laser">
      <div className="ds-kv">
        <span className="ds-kv__key">PWM</span>
        <span className="ds-kv__val">{laserPwm.toFixed(3)}</span>
        <span className="ds-kv__key">Power</span>
        <span className="ds-kv__val">{(laserPwm * 100).toFixed(1)}%</span>
      </div>
    </DashboardPanel>
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
      <DashboardPanel icon={Zap} title="General Purpose Outputs">
        <div className="ds-kv__key">No GP outputs configured.</div>
      </DashboardPanel>
    );
  }

  return (
    <DashboardPanel icon={Zap} title="General Purpose Outputs">
      {populated.map(({ gpio, index }) => {
        const pwm = gpio?.pwm ?? 0;
        const displayPct = localPwm[index] !== undefined ? Math.round(localPwm[index]) : Math.round(pwm * 100);
        const isOn = pwm > 0;
        return (
          <div key={index} className="ds-gpio-row">
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>GP{index}</span>
            <button
              className={`ds-toggle ${isOn ? 'ds-toggle--on' : 'ds-toggle--off'}`}
              onClick={() => handleToggle(index, pwm)}
              title={isOn ? `Turn off GP${index} (M42 P${index} S0)` : `Turn on GP${index} (M42 P${index} S1)`}
            >
              <span className="ds-toggle__track" />
              <span className="ds-toggle__thumb" />
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
                style={{ flex: 1, accentColor: 'var(--accent)' }}
                title={`Set GP${index} PWM (0-100%)`}
              />
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
                {displayPct}%
              </span>
            </div>
          </div>
        );
      })}
    </DashboardPanel>
  );
}

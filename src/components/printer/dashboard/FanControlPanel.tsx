import type { CSSProperties } from 'react';
import { Fan, Thermometer, Zap } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { DashboardPanel } from './DashboardPanel';

const PRESETS = [0, 25, 50, 75, 100];

function fanColor(pct: number): string {
  if (pct <= 0) return 'rgba(180,180,200,0.35)';
  if (pct < 30) return 'rgb(56,189,210)';
  if (pct < 70) return 'rgb(80,200,130)';
  if (pct < 90) return 'rgb(240,180,60)';
  return 'rgb(240,100,80)';
}

export default function FanControlPanel() {
  const model = usePrinterStore((s) => s.model);
  const setFanSpeed = usePrinterStore((s) => s.setFanSpeed);
  // Skip fans that have been explicitly disabled (max: 0) in config.
  const fans = (model.fans ?? []).filter((f) => f && (f.max === undefined || f.max > 0));

  return (
    <DashboardPanel icon={Fan} title="Fans">

      {fans.length === 0 && <div className="fan-empty">No fans detected</div>}

      {fans.map((fan, i) => {
        const pct = Math.round((fan.actualValue ?? 0) * 100);
        const color = fanColor(pct);
        const spinDur = pct > 0 ? Math.max(0.25, 2 - pct / 60).toFixed(2) : '0';
        const isThermo = !!fan.thermostatic?.control;
        const thermoTip = isThermo
          ? `Thermostatic: H[${(fan.thermostatic?.heaters ?? []).join(',')}] @ ${fan.thermostatic?.temperature}°`
          : undefined;

        return (
          <div key={i} className="fan-card" style={{ '--fan-color': color } as CSSProperties}>
            <div className="fan-header">
              <div
                className={`fan-icon-wrap${pct > 0 ? ' fan-icon-wrap--spin' : ''}`}
                style={{ animationDuration: `${spinDur}s` }}
              >
                <Fan size={16} style={{ color }} />
              </div>
              <span className="fan-name">{fan.name || `Fan ${i}`}</span>
              {isThermo && (
                <span className="fan-badge fan-badge--thermo" title={thermoTip}>
                  <Thermometer size={10} /> Thermo
                </span>
              )}
              {fan.rpm > 0 && (
                <span className="fan-rpm">
                  <Zap size={9} /> {fan.rpm} RPM
                </span>
              )}
              <span className="fan-pct" style={{ color }}>{pct}%</span>
            </div>

            <div className="fan-slider-row">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                disabled={isThermo}
                onChange={(e) => setFanSpeed(i, Number(e.target.value))}
                className="fan-range"
                style={{ accentColor: color }}
                title={isThermo ? thermoTip : undefined}
              />
            </div>

            <div className="fan-presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`fan-preset-btn${pct === p ? ' is-active' : ''}`}
                  disabled={isThermo}
                  onClick={() => setFanSpeed(i, p)}
                  title={isThermo ? 'Disabled while under thermostatic control' : undefined}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </DashboardPanel>
  );
}

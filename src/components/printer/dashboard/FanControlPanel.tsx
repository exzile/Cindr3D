import { Fan } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

const PRESETS = [0, 25, 50, 75, 100];

export default function FanControlPanel() {
  const model      = usePrinterStore((s) => s.model);
  const setFanSpeed = usePrinterStore((s) => s.setFanSpeed);
  const fans       = model.fans ?? [];

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Fan size={14} /> Fans
      </div>

      {fans.length === 0 && (
        <div className="fan-empty">No fans detected</div>
      )}

      {fans.map((fan, i) => {
        const pct = Math.round(fan.actualValue * 100);
        return (
          <div key={i} className="fan-card">
            <div className="fan-header">
              <span className="fan-name">{fan.name || `Fan ${i}`}</span>
              {fan.rpm > 0 && (
                <span className="fan-rpm">{fan.rpm} RPM</span>
              )}
              <span className="fan-pct">{pct}%</span>
            </div>

            <div className="fan-slider-row">
              <input
                type="range"
                min={0} max={100} step={1}
                value={pct}
                onChange={(e) => setFanSpeed(i, Number(e.target.value))}
                className="fan-range"
              />
            </div>

            <div className="fan-presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`fan-preset-btn${pct === p ? ' is-active' : ''}`}
                  onClick={() => setFanSpeed(i, p)}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

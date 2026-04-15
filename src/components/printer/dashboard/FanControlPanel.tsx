import { useState } from 'react';
import { Fan } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

export default function FanControlPanel() {
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

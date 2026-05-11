import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { colors as COLORS } from '../../../utils/theme';
import {
  compactPanelInputStyle as inputStyle,
} from '../../../utils/printerPanelStyles';
import { DashboardPanel } from './DashboardPanel';

export default function SpeedFlowPanel() {
  const model = usePrinterStore((s) => s.model);
  const setSpeedFactor = usePrinterStore((s) => s.setSpeedFactor);
  const setExtrusionFactor = usePrinterStore((s) => s.setExtrusionFactor);
  const setGlobalFlowFactor = usePrinterStore((s) => s.setGlobalFlowFactor);

  const speedFactor = model.move?.speedFactor ?? 1;
  const extruders = model.move?.extruders ?? [];

  // Use the first extruder's factor as the display value for global flow
  const globalFlowFactor = extruders[0]?.factor ?? 1;

  const [speedInput, setSpeedInput] = useState<string>('');
  const [flowInput, setFlowInput] = useState<string>('');
  const [extFactors, setExtFactors] = useState<Record<number, string>>({});

  const currentSpeedPct = Math.round(speedFactor * 100);
  const currentFlowPct = Math.round(globalFlowFactor * 100);

  return (
    <DashboardPanel icon={Gauge} title="Speed & Flow">

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

      <div className="duet-dash-flow-block">
        <div className="duet-dash-label-sm">Flow Factor</div>
        <div className="duet-dash-slider-row">
          <input
            type="range"
            min={50} max={150} step={1}
            value={flowInput !== '' ? flowInput : currentFlowPct}
            onChange={(e) => setFlowInput(e.target.value)}
            onMouseUp={() => { if (flowInput !== '') { setGlobalFlowFactor(Number(flowInput)); setFlowInput(''); } }}
            onTouchEnd={() => { if (flowInput !== '') { setGlobalFlowFactor(Number(flowInput)); setFlowInput(''); } }}
            className="duet-dash-range"
            style={{ accentColor: COLORS.accent }}
          />
          <input
            type="number"
            style={inputStyle(55)}
            value={flowInput !== '' ? flowInput : currentFlowPct}
            onChange={(e) => setFlowInput(e.target.value)}
            onBlur={() => { if (flowInput !== '') { setGlobalFlowFactor(Number(flowInput)); setFlowInput(''); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && flowInput !== '') { setGlobalFlowFactor(Number(flowInput)); setFlowInput(''); } }}
          />
          <span className="duet-dash-slider-unit">%</span>
        </div>
      </div>

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
    </DashboardPanel>
  );
}

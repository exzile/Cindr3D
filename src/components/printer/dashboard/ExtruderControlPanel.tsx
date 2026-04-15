import { useState } from 'react';
import { Droplets, ArrowUp, ArrowDown } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  compactPanelInputStyle as inputStyle,
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

export default function ExtruderControlPanel() {
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

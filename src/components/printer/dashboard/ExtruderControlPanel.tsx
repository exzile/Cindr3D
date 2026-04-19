import { useState } from 'react';
import { Droplets, ArrowDown, ArrowUp } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';

const AMOUNTS = [1, 5, 10, 25, 50, 100];

export default function ExtruderControlPanel() {
  const model         = usePrinterStore((s) => s.model);
  const connected     = usePrinterStore((s) => s.connected);
  const extrudeAction = usePrinterStore((s) => s.extrude);
  const sendGCode     = usePrinterStore((s) => s.sendGCode);
  const extrudeAmount   = usePrinterStore((s) => s.extrudeAmount);
  const extrudeFeedrate = usePrinterStore((s) => s.extrudeFeedrate);

  const tools       = model.tools ?? [];
  const currentTool = model.state?.currentTool ?? -1;

  const [amount, setAmount]             = useState(extrudeAmount);
  const [feedrate, setFeedrate]         = useState(extrudeFeedrate);
  const [selectedTool, setSelectedTool] = useState(currentTool);
  const [custom, setCustom]             = useState('');

  const activeAmount = custom !== '' ? Number(custom) : amount;

  const handleExtrude = (dir: number) => {
    if (selectedTool >= 0 && selectedTool !== currentTool) sendGCode(`T${selectedTool}`);
    extrudeAction(activeAmount * dir, feedrate);
  };

  return (
    <div style={panelStyle()}>

      {/* Section header */}
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <Droplets size={14} /> Extruder
      </div>

      {/* Tool selector (only when multiple tools exist) */}
      {tools.length > 1 && (
        <div className="ex-card ex-card--tool">
          <div className="ex-label">Tool</div>
          <select
            className="ex-select"
            value={selectedTool}
            onChange={(e) => setSelectedTool(Number(e.target.value))}
          >
            {tools.map((t) => (
              <option key={t.number} value={t.number}>
                {t.name || `Tool ${t.number}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Amount presets + custom */}
      <div className="ex-card ex-card--amount">
        <div className="ex-label">Amount &mdash; mm</div>
        <div className="ex-pill-row">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              className={`ex-pill${a === amount && custom === '' ? ' is-active' : ''}`}
              onClick={() => { setAmount(a); setCustom(''); }}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="ex-custom-row">
          <span className="ex-sublabel">Custom</span>
          <input
            type="number"
            className={`ex-input${custom !== '' ? ' is-active' : ''}`}
            value={custom}
            placeholder={String(amount)}
            onChange={(e) => setCustom(e.target.value)}
            min={0.1}
            step={0.1}
          />
          <span className="ex-unit">mm</span>
        </div>
      </div>

      {/* Feedrate */}
      <div className="ex-card ex-card--feed">
        <div className="ex-label">Feedrate &mdash; mm/min</div>
        <input
          type="number"
          className="ex-input ex-input--full"
          value={feedrate}
          onChange={(e) => setFeedrate(Number(e.target.value))}
          min={1}
        />
      </div>

      {/* Action buttons */}
      <div className="ex-actions">
        <button
          className="ex-action-btn ex-action-btn--extrude"
          disabled={!connected}
          onClick={() => handleExtrude(1)}
        >
          <ArrowDown size={16} />
          <span>Extrude</span>
          <span className="ex-action-amt">{activeAmount} mm</span>
        </button>
        <button
          className="ex-action-btn ex-action-btn--retract"
          disabled={!connected}
          onClick={() => handleExtrude(-1)}
        >
          <ArrowUp size={16} />
          <span>Retract</span>
          <span className="ex-action-amt">{activeAmount} mm</span>
        </button>
      </div>

    </div>
  );
}

import { useState } from 'react';
import { Droplets, ArrowDown, ArrowUp, Thermometer } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { DashboardPanel } from './DashboardPanel';

const AMOUNTS   = [1, 5, 10, 25, 50, 100];
const FEEDRATES = [300, 600, 1200, 2400];

export default function ExtruderControlPanel() {
  const model         = usePrinterStore((s) => s.model);
  const connected     = usePrinterStore((s) => s.connected);
  const extrudeAction = usePrinterStore((s) => s.extrude);
  const sendGCode     = usePrinterStore((s) => s.sendGCode);
  const extrudeAmount   = usePrinterStore((s) => s.extrudeAmount);
  const extrudeFeedrate = usePrinterStore((s) => s.extrudeFeedrate);

  const tools       = model.tools ?? [];
  const heaters     = model.heat?.heaters ?? [];
  const currentTool = model.state?.currentTool ?? -1;

  const [amount, setAmount]             = useState(extrudeAmount);
  const [feedrate, setFeedrate]         = useState(extrudeFeedrate);
  const [selectedTool, setSelectedTool] = useState(currentTool);
  const [customAmt, setCustomAmt]       = useState('');
  const [customFeed, setCustomFeed]     = useState('');

  const activeAmount   = customAmt  !== '' ? Number(customAmt)  : amount;
  const activeFeedrate = customFeed !== '' ? Number(customFeed) : feedrate;

  const handleExtrude = (dir: number) => {
    if (selectedTool >= 0 && selectedTool !== currentTool) sendGCode(`T${selectedTool}`);
    extrudeAction(activeAmount * dir, activeFeedrate);
  };

  // Temperature readout for selected tool
  const toolObj    = tools.find((t) => t.number === selectedTool);
  const heaterIdx  = toolObj?.heaters?.[0];
  const heaterData = heaterIdx !== undefined ? heaters[heaterIdx] : undefined;

  return (
    <DashboardPanel icon={Droplets} title="Extruder" className="ex-panel">

      {/* Tool selector */}
      {tools.length > 1 && (
        <div className="ex-card ex-card--tool">
          <div className="ex-label">Tool</div>
          <div className="ex-tool-row">
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
            {heaterData !== undefined && (
              <div className="ex-temp-badge">
                <Thermometer size={11} />
                <span className="ex-temp-current">{heaterData.current.toFixed(1)}°</span>
                {heaterData.active > 0 && (
                  <span className="ex-temp-target">/ {heaterData.active.toFixed(0)}°</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Amount presets + custom */}
      <div className="ex-card ex-card--amount">
        <div className="ex-label">Amount &mdash; mm</div>
        <div className="ex-pill-row">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              className={`ex-pill${a === amount && customAmt === '' ? ' is-active' : ''}`}
              onClick={() => { setAmount(a); setCustomAmt(''); }}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="ex-custom-row">
          <span className="ex-sublabel">Custom</span>
          <input
            type="number"
            className={`ex-input${customAmt !== '' ? ' is-active' : ''}`}
            value={customAmt}
            placeholder={String(amount)}
            onChange={(e) => setCustomAmt(e.target.value)}
            min={0.1}
            step={0.1}
          />
          <span className="ex-unit">mm</span>
        </div>
      </div>

      {/* Feedrate presets + custom */}
      <div className="ex-card ex-card--feed">
        <div className="ex-label">Feedrate &mdash; mm/min</div>
        <div className="ex-pill-row ex-pill-row--feed">
          {FEEDRATES.map((f) => (
            <button
              key={f}
              className={`ex-pill ex-pill--feed${f === feedrate && customFeed === '' ? ' is-active' : ''}`}
              onClick={() => { setFeedrate(f); setCustomFeed(''); }}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="ex-custom-row">
          <span className="ex-sublabel">Custom</span>
          <input
            type="number"
            className={`ex-input ex-input--feed${customFeed !== '' ? ' is-active' : ''}`}
            value={customFeed}
            placeholder={String(feedrate)}
            onChange={(e) => setCustomFeed(e.target.value)}
            min={1}
            step={10}
          />
          <span className="ex-unit">mm/min</span>
        </div>
      </div>

      {/* Live summary */}
      <div className="ex-summary">
        <span className="ex-summary__val">
          {activeAmount}<span className="ex-summary__unit">mm</span>
        </span>
        <span className="ex-summary__sep">@</span>
        <span className="ex-summary__val">
          {activeFeedrate}<span className="ex-summary__unit">mm/min</span>
        </span>
      </div>

      {/* Action buttons */}
      <div className="ex-actions">
        <button
          className="ex-action-btn ex-action-btn--retract"
          disabled={!connected}
          onClick={() => handleExtrude(-1)}
        >
          <ArrowUp size={15} />
          <span>Retract</span>
        </button>
        <button
          className="ex-action-btn ex-action-btn--extrude"
          disabled={!connected}
          onClick={() => handleExtrude(1)}
        >
          <ArrowDown size={15} />
          <span>Extrude</span>
        </button>
      </div>

    </DashboardPanel>
  );
}

import { useState, useCallback } from 'react';
import { WifiOff, TrendingUp, Play, Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService } from '../../services/MoonrakerService';
import './KlipperTabs.css';

export default function KlipperPressureAdvance() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const [advance, setAdvance] = useState(0.04);
  const [smoothTime, setSmoothTime] = useState(0.04);
  const [extruder, setExtruder] = useState('extruder');
  const [applying, setApplying] = useState(false);
  const [printingTower, setPrintingTower] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const handlePrintTower = useCallback(async () => {
    if (!service) return;
    const paStart = 0;
    const paIncrement = 0.005;
    setPrintingTower(true); setError(null);
    try {
      await sendGCode('TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START='
        + paStart + ' FACTOR=' + paIncrement + ' BAND=5');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start tuning tower');
    } finally { setPrintingTower(false); }
  }, [service, sendGCode]);

  const handleApply = useCallback(async () => {
    if (!service) return;
    setApplying(true); setError(null); setApplied(false);
    try {
      await service.setPressureAdvance(advance, extruder);
      await service.setSmoothTime(smoothTime, extruder);
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply settings');
    } finally { setApplying(false); }
  }, [service, advance, smoothTime, extruder]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to tune Pressure Advance.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <TrendingUp size={15} />
        <h3>Pressure Advance</h3>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={14} /> {error}
            </div>
          </div>
        )}

        <div className="klipper-card">
          <div className="klipper-card-header">Tuning Workflow</div>
          <div className="klipper-card-body">
            <div className="klipper-step">
              <div className="klipper-step-num">1</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Print a PA tower</div>
                <div className="klipper-step-desc">
                  Uses <code>TUNING_TOWER</code> to print a test object with linearly increasing Pressure Advance. The best layer is where corner bulging disappears.
                  PA increases 0.005 per 5 mm height (0→0.1 range).
                </div>
                <div className="klipper-form-row" style={{ marginTop: 8 }}>
                  <label>Extruder</label>
                  <select value={extruder} onChange={(e) => setExtruder(e.target.value)}>
                    <option value="extruder">extruder</option>
                    <option value="extruder1">extruder1</option>
                    <option value="extruder2">extruder2</option>
                  </select>
                  <button className="klipper-btn klipper-btn-primary" onClick={handlePrintTower} disabled={printingTower}>
                    <Play size={13} /> {printingTower ? 'Printing…' : 'Start Tuning Tower'}
                  </button>
                </div>
              </div>
            </div>

            <div className="klipper-step">
              <div className="klipper-step-num">2</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Read the best height</div>
                <div className="klipper-step-desc">
                  Measure the height (mm) of the best-looking layer from the bottom of the print, then calculate: <code>PA = height × 0.005 / 5</code>.
                  Enter the resulting PA value below.
                </div>
              </div>
            </div>

            <div className="klipper-step">
              <div className="klipper-step-num">3</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Apply and persist</div>
                <div className="klipper-step-desc">
                  Sets <code>SET_PRESSURE_ADVANCE</code> live. Add to <code>[extruder]</code> in printer.cfg to persist across restarts.
                </div>
                <div className="klipper-form-row" style={{ marginTop: 8 }}>
                  <label>Pressure Advance</label>
                  <input
                    type="number"
                    min={0} max={2} step={0.001}
                    value={advance}
                    onChange={(e) => setAdvance(Number(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <label>Smooth Time</label>
                  <input
                    type="number"
                    min={0} max={0.2} step={0.001}
                    value={smoothTime}
                    onChange={(e) => setSmoothTime(Number(e.target.value))}
                    style={{ width: 90 }}
                  />
                  <button
                    className="klipper-btn klipper-btn-primary"
                    onClick={handleApply}
                    disabled={applying}
                  >
                    <Settings size={13} /> {applying ? 'Applying…' : 'Apply'}
                  </button>
                </div>
                {applied && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: 12, marginTop: 8 }}>
                    <CheckCircle2 size={13} /> Applied — add <code>pressure_advance: {advance}</code> to <code>[extruder]</code> in printer.cfg to persist
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="klipper-card">
          <div className="klipper-card-header">Quick Reference</div>
          <div className="klipper-card-body">
            <table className="klipper-table">
              <tbody>
                <tr><td style={{ fontWeight: 600 }}>Too little PA</td><td>Rounded / blobby corners, excess material at corners</td></tr>
                <tr><td style={{ fontWeight: 600 }}>Too much PA</td><td>Thin / missing material at corners, surface ripples</td></tr>
                <tr><td style={{ fontWeight: 600 }}>Typical range</td><td>Direct drive: 0.01–0.1 · Bowden: 0.2–1.5</td></tr>
                <tr><td style={{ fontWeight: 600 }}>Smooth time</td><td>Usually 0.04 s · Lower = more responsive, may cause noise</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback } from 'react';
import { WifiOff, Cpu, Play, Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { errorMessage } from '../../utils/errorHandling';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService } from '../../services/MoonrakerService';
import './KlipperTabs.css';

const SHAPER_TYPES = ['mzv', 'ei', '2hump_ei', '3hump_ei', 'zvd', 'zv'];

export default function KlipperInputShaper() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const [testingX, setTestingX] = useState(false);
  const [testingY, setTestingY] = useState(false);
  const [applying, setApplying] = useState(false);
  const [shaperType, setShaperType] = useState('mzv');
  const [freqX, setFreqX] = useState(50);
  const [freqY, setFreqY] = useState(50);
  const [dampingRatio, setDampingRatio] = useState(0.1);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const handleTestX = useCallback(async () => {
    if (!service) return;
    setTestingX(true); setError(null);
    try {
      await sendGCode('G28');
      await service.testResonances('X');
    } catch (e) {
      setError(errorMessage(e, 'Test failed'));
    } finally { setTestingX(false); }
  }, [service, sendGCode]);

  const handleTestY = useCallback(async () => {
    if (!service) return;
    setTestingY(true); setError(null);
    try {
      await sendGCode('G28');
      await service.testResonances('Y');
    } catch (e) {
      setError(errorMessage(e, 'Test failed'));
    } finally { setTestingY(false); }
  }, [service, sendGCode]);

  const handleApply = useCallback(async () => {
    if (!service) return;
    setApplying(true); setError(null); setApplied(false);
    try {
      await service.setInputShaper(shaperType, freqX, freqY, dampingRatio);
      setApplied(true);
    } catch (e) {
      setError(errorMessage(e, 'Failed to apply shaper settings'));
    } finally { setApplying(false); }
  }, [service, shaperType, freqX, freqY, dampingRatio]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to run resonance tuning.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Cpu size={15} />
        <h3>Input Shaper</h3>
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
          <div className="klipper-card-header">Step 1 — Measure Resonances</div>
          <div className="klipper-card-body">
            <div className="klipper-step">
              <div className="klipper-step-num">1</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Install ADXL345 accelerometer</div>
                <div className="klipper-step-desc">
                  Mount the accelerometer to the toolhead (for X) and to the bed (for Y). Wire SPI to the MCU and configure <code>[adxl345]</code> + <code>[resonance_tester]</code> in printer.cfg.
                </div>
              </div>
            </div>
            <div className="klipper-step">
              <div className="klipper-step-num">2</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Run resonance tests</div>
                <div className="klipper-step-desc">
                  The printer will home, then vibrate the axis while the accelerometer records data. A CSV is saved to the SD card when complete.
                </div>
                <div className="klipper-form-row" style={{ marginTop: 8 }}>
                  <button
                    className="klipper-btn klipper-btn-primary"
                    onClick={handleTestX}
                    disabled={testingX || testingY}
                  >
                    <Play size={13} /> {testingX ? 'Testing X…' : 'Test X Axis'}
                  </button>
                  <button
                    className="klipper-btn klipper-btn-primary"
                    onClick={handleTestY}
                    disabled={testingX || testingY}
                  >
                    <Play size={13} /> {testingY ? 'Testing Y…' : 'Test Y Axis'}
                  </button>
                </div>
              </div>
            </div>
            <div className="klipper-step">
              <div className="klipper-step-num">3</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Run shaper_calibrate.py</div>
                <div className="klipper-step-desc">
                  On the Raspberry Pi, run:<br />
                  <code>~/klipper/scripts/calibrate_shaper.py /tmp/resonances_x_*.csv -o /tmp/shaper_calibrate_x.png</code><br />
                  Then read the recommended shaper type and frequency from the output and enter them below.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="klipper-card">
          <div className="klipper-card-header">Step 2 — Apply Shaper Settings</div>
          <div className="klipper-card-body">
            <div className="klipper-form-row">
              <label>Shaper type</label>
              <select value={shaperType} onChange={(e) => setShaperType(e.target.value)}>
                {SHAPER_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="klipper-form-row">
              <label>Freq X (Hz)</label>
              <input
                type="number"
                min={1} max={200} step={0.1}
                value={freqX}
                onChange={(e) => setFreqX(Number(e.target.value))}
              />
              <label>Freq Y (Hz)</label>
              <input
                type="number"
                min={1} max={200} step={0.1}
                value={freqY}
                onChange={(e) => setFreqY(Number(e.target.value))}
              />
            </div>
            <div className="klipper-form-row">
              <label>Damping ratio</label>
              <input
                type="number"
                min={0.01} max={0.2} step={0.01}
                value={dampingRatio}
                onChange={(e) => setDampingRatio(Number(e.target.value))}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(default 0.1)</span>
            </div>
            <div className="klipper-form-row" style={{ marginTop: 4 }}>
              <button
                className="klipper-btn klipper-btn-primary"
                onClick={handleApply}
                disabled={applying}
              >
                <Settings size={13} /> {applying ? 'Applying…' : 'Apply SET_INPUT_SHAPER'}
              </button>
              {applied && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#22c55e', fontSize: 12 }}>
                  <CheckCircle2 size={13} /> Applied — add to [input_shaper] in printer.cfg to persist
                </span>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              This runs <code>SET_INPUT_SHAPER</code> live. To make it permanent, add an <code>[input_shaper]</code> section to printer.cfg with these values.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

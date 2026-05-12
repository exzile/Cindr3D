/**
 * PressureAdvance — cross-firmware pressure/linear advance tuning.
 * Klipper  → SET_PRESSURE_ADVANCE / TUNING_TOWER
 * Marlin   → M900 K<x>
 * Duet     → M572 D0 S<x>
 * Others   → generic instructions
 */
import { useState, useCallback } from 'react';
import { TrendingUp, Send, Info, ChevronRight } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { TOOL_HANDLERS } from '../../services/mcp/tools';
import type { PrinterBoardType } from '../../types/duet';
import './KlipperTabs.css';

// ─── G-code helpers ──────────────────────────────────────────────────────────

function buildSetCommand(boardType: PrinterBoardType, pa: number, smooth: number): string[] {
  switch (boardType) {
    case 'klipper':
      return [`SET_PRESSURE_ADVANCE ADVANCE=${pa.toFixed(4)} SMOOTH_TIME=${smooth.toFixed(4)}`];
    case 'marlin':
      return [`M900 K${pa.toFixed(4)}`];
    case 'duet':
      return [`M572 D0 S${pa.toFixed(4)}`];
    default:
      return [`; Set pressure advance to ${pa.toFixed(4)} (consult your firmware docs)`];
  }
}

function buildTowerCommand(boardType: PrinterBoardType): string[] {
  switch (boardType) {
    case 'klipper':
      return [
        'SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500',
        'TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START=0 FACTOR=0.005',
      ];
    case 'marlin':
      return ['M900 K0', '; Print a K-factor calibration tower then send M900 K<best>'];
    case 'duet':
      return ['M572 D0 S0', '; Print a pressure advance tower, then send M572 D0 S<best>'];
    default:
      return ['; Print a calibration tower and adjust PA per your firmware.'];
  }
}

// ─── Per-firmware quick reference ────────────────────────────────────────────

const FIRMWARE_NOTES: Partial<Record<PrinterBoardType, string>> = {
  klipper: 'Klipper calls it "Pressure Advance". Configure SET_PRESSURE_ADVANCE in your printer.cfg or send it as a G-code. The SMOOTH_TIME value (default 0.04 s) reduces ringing caused by input shaper interactions.',
  marlin: 'Marlin calls this "Linear Advance" (LA). Use M900 K<value>. Typical K values: 0–1 for direct drive, 0–2 for Bowden. Add to Start G-code to persist across prints.',
  duet: 'Duet calls this "Pressure Advance". Use M572 D<drive> S<advance>. D0 is the first extruder drive. Values typically 0–0.5. Store permanently via M572 + M500.',
  smoothie: 'Smoothieware: not natively supported. Use a post-processor or firmware fork with PA/LA.',
  grbl: 'grbl does not support pressure advance (it is not a FDM firmware).',
  repetier: 'Repetier: depends on version. Some support M900 (Marlin compat). Check your firmware docs.',
  other: 'Consult your firmware documentation for pressure/linear advance support.',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PressureAdvance() {
  const boardType = usePrinterStore((s) => s.config.boardType ?? 'other');
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);

  const [pa, setPa] = useState(0.04);
  const [smooth, setSmooth] = useState(0.04);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [bestHeight, setBestHeight] = useState('');
  const [sending, setSending] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const sendCommands = useCallback(async (cmds: string[]) => {
    if (!connected) return;
    setSending(true);
    try {
      for (const cmd of cmds) {
        if (cmd.startsWith(';')) continue;
        await sendGCode(cmd);
      }
    } finally { setSending(false); }
  }, [connected, sendGCode]);

  const handlePrintTower = () => {
    const cmds = buildTowerCommand(boardType);
    void sendCommands(cmds);
    setStep(2);
  };

  const handleApply = () => {
    const cmds = buildSetCommand(boardType, pa, smooth);
    void sendCommands(cmds);
    setStep(3);
  };

  const handleAnalyzeTower = useCallback(async () => {
    const handler = TOOL_HANDLERS.tuning_analyze_tower;
    setAnalyzing(true);
    setAiError(null);
    try {
      const result = await handler({
        kind: 'pressure-advance',
        frameCount: 3,
        startValue: 0,
        stepPerMm: 0.005,
        notes: `Pressure advance tower for ${boardType}. Current typed height: ${bestHeight || 'unset'}.`,
      }) as {
        recommendation?: { bestValue?: number; bestHeightMm?: number; confidence?: number; summary?: string };
      };
      const rec = result.recommendation;
      if (rec?.bestValue !== undefined) setPa(Number(rec.bestValue.toFixed(4)));
      if (rec?.bestHeightMm !== undefined) setBestHeight(String(rec.bestHeightMm));
      setAiSummary(rec?.summary ?? 'AI analysis returned no summary.');
      setStep(3);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  }, [bestHeight, boardType]);

  const setCommands = buildSetCommand(boardType, pa, smooth);
  const note = FIRMWARE_NOTES[boardType] ?? FIRMWARE_NOTES.other!;

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <TrendingUp size={15} />
        <h3>Pressure Advance</h3>
        <span className="klipper-badge info" style={{ marginLeft: 4, textTransform: 'capitalize' }}>{boardType}</span>
        <div className="spacer" />
      </div>

      <div className="klipper-tab-body">
        {/* Firmware note */}
        <div className="klipper-card">
          <div className="klipper-card-header"><Info size={13} style={{ display: 'inline', marginRight: 4 }} />Firmware Notes</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{note}</p>
          </div>
        </div>

        {/* Step 1 — Print calibration tower */}
        <div className="klipper-card">
          <div className="klipper-card-header">
            <span className="klipper-step-num" style={{ marginRight: 6 }}>1</span>
            Print Calibration Tower
            {step > 1 && <span className="klipper-badge on" style={{ marginLeft: 8 }}>Done</span>}
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Print a PA calibration tower. The tower starts at PA=0 and increases by 0.005 per mm of height.
              Look for the layer where corner bulging disappears — that height gives you the best PA value.
            </p>
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
              {buildTowerCommand(boardType).map((c, i) => <div key={i}>{c}</div>)}
            </div>
            <button className="klipper-btn klipper-btn-primary" onClick={handlePrintTower}
              disabled={!connected || sending}>
              <Send size={13} /> Send &amp; Start Tower
            </button>
          </div>
        </div>

        {/* Step 2 — Read best height */}
        <div className="klipper-card" style={{ opacity: step < 2 ? 0.5 : 1 }}>
          <div className="klipper-card-header">
            <span className="klipper-step-num" style={{ marginRight: 6 }}>2</span>
            Measure Best Height / PA Value
            {step > 2 && <span className="klipper-badge on" style={{ marginLeft: 8 }}>Done</span>}
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Measure the print height where corners look sharpest. Multiply by 0.005 to get the PA value.
              <br />Or enter your computed value directly:
            </p>
            <div className="klipper-form-row">
              <label>Best height (mm)</label>
              <input type="number" min={0} step={0.5} placeholder="e.g. 14.0" value={bestHeight}
                onChange={(e) => {
                  setBestHeight(e.target.value);
                  const h = parseFloat(e.target.value);
                  if (!isNaN(h)) setPa(parseFloat((h * 0.005).toFixed(4)));
                }} style={{ width: 90 }} />
              <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
              <label>PA value</label>
              <input type="number" min={0} max={2} step={0.001} value={pa}
                onChange={(e) => setPa(parseFloat(e.target.value) || 0)} style={{ width: 90 }} />
            </div>
            {boardType === 'klipper' && (
              <div className="klipper-form-row" style={{ marginTop: 6 }}>
                <label>Smooth time</label>
                <input type="number" min={0} max={0.2} step={0.004} value={smooth}
                  onChange={(e) => setSmooth(parseFloat(e.target.value) || 0)} style={{ width: 90 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(default 0.04 s)</span>
              </div>
            )}
            <button className="klipper-btn klipper-btn-primary" style={{ marginTop: 10 }}
              onClick={() => setStep(3)} disabled={step < 2}>
              Confirm Value <ChevronRight size={13} />
            </button>
            <button className="klipper-btn" style={{ marginTop: 10, marginLeft: 8 }}
              onClick={() => void handleAnalyzeTower()} disabled={analyzing}>
              {analyzing ? 'Analyzing...' : 'Analyze with AI'}
            </button>
            {aiSummary && (
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {aiSummary}
              </p>
            )}
            {aiError && (
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--danger, #ef5350)', lineHeight: 1.45 }}>
                {aiError}
              </p>
            )}
          </div>
        </div>

        {/* Step 3 — Apply */}
        <div className="klipper-card" style={{ opacity: step < 3 ? 0.5 : 1 }}>
          <div className="klipper-card-header">
            <span className="klipper-step-num" style={{ marginRight: 6 }}>3</span>
            Apply Pressure Advance
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Send the command to apply PA={pa.toFixed(4)}
              {boardType === 'klipper' && ` smooth_time=${smooth.toFixed(4)}`}.
              Save it to your config/EEPROM to persist across reboots.
            </p>
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 5, padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
              {setCommands.map((c, i) => <div key={i}>{c}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="klipper-btn klipper-btn-primary" onClick={handleApply}
                disabled={!connected || sending || step < 3}>
                <Send size={13} /> Apply Now
              </button>
              {boardType === 'marlin' && (
                <button className="klipper-btn" onClick={() => void sendCommands(['M500'])}
                  disabled={!connected || sending}>
                  <Send size={13} /> Save to EEPROM (M500)
                </button>
              )}
              {boardType === 'duet' && (
                <button className="klipper-btn" onClick={() => void sendCommands(['M500'])}
                  disabled={!connected || sending}>
                  <Send size={13} /> Save to config (M500)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick reference */}
        <div className="klipper-card">
          <div className="klipper-card-header">Quick Reference — PA by Firmware</div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            <table className="klipper-table">
              <thead>
                <tr><th>Firmware</th><th>Command</th><th>Save</th></tr>
              </thead>
              <tbody>
                <tr><td>Klipper</td><td><code>SET_PRESSURE_ADVANCE ADVANCE=x</code></td><td>Edit printer.cfg</td></tr>
                <tr><td>Marlin</td><td><code>M900 K&lt;x&gt;</code></td><td>M500</td></tr>
                <tr><td>Duet</td><td><code>M572 D0 S&lt;x&gt;</code></td><td>M500 / config.g</td></tr>
                <tr><td>Smoothie</td><td colSpan={2}>Not natively supported</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * InputShaper — cross-firmware resonance compensation / input shaping.
 * Klipper  → SET_INPUT_SHAPER + optional ADXL345 TEST_RESONANCES
 * Marlin   → M593 F<freq> D<ratio>
 * Duet     → M593 F<freq>
 * Others   → guidance only
 */
import { useState, useCallback } from 'react';
import { Cpu, Send, Info } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { TOOL_HANDLERS } from '../../services/mcp/tools';
import type { PrinterBoardType } from '../../types/duet';
import './KlipperTabs.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type ShaperType = 'mzv' | 'ei' | 'zv' | '2hump_ei' | '3hump_ei';

const SHAPER_TYPES: { key: ShaperType; label: string }[] = [
  { key: 'mzv',       label: 'MZV (recommended)' },
  { key: 'zv',        label: 'ZV (basic)' },
  { key: 'ei',        label: 'EI (moderate)' },
  { key: '2hump_ei',  label: '2 Hump EI (high vibration)' },
  { key: '3hump_ei',  label: '3 Hump EI (extreme)' },
];

// ─── G-code builders ─────────────────────────────────────────────────────────

function buildSetCommand(boardType: PrinterBoardType, shaperType: ShaperType, freqX: number, freqY: number, damping: number): string[] {
  switch (boardType) {
    case 'klipper':
      return [
        `SET_INPUT_SHAPER SHAPER_TYPE_X=${shaperType.toUpperCase()} SHAPER_FREQ_X=${freqX.toFixed(1)} SHAPER_TYPE_Y=${shaperType.toUpperCase()} SHAPER_FREQ_Y=${freqY.toFixed(1)}`,
      ];
    case 'marlin':
      return [
        `M593 X F${freqX.toFixed(1)} D${damping.toFixed(2)}`,
        `M593 Y F${freqY.toFixed(1)} D${damping.toFixed(2)}`,
      ];
    case 'duet':
      // RRF 3.3+ supports separate X/Y, earlier just one freq
      return [
        `M593 P"${shaperType.toUpperCase()}" F${freqX.toFixed(1)} S${damping.toFixed(2)}`,
      ];
    default:
      return [`; Set input shaper: freq X=${freqX} Hz, Y=${freqY} Hz (consult firmware docs)`];
  }
}

const FIRMWARE_NOTES: Partial<Record<PrinterBoardType, string>> = {
  klipper: 'Klipper supports full input shaping with optional ADXL345 accelerometer auto-calibration. Without an accelerometer, measure ringing manually: print a ringing test model and count the ripple waves to calculate frequency.',
  marlin: 'Marlin 2.x supports Input Shaping (ZV, ZVDD, MZV, EI, 2HEI) via M593. Requires USING_RINGING_REDUCTION enabled in firmware. Typical frequencies: 20–80 Hz. Use M593 without parameters to print current settings.',
  duet: 'Duet RRF 3.3+ supports input shaping (ZVD, EI, etc.) via M593. Earlier firmware may require a custom build. Typical frequencies: 20–60 Hz.',
  smoothie: 'Smoothieware does not natively support input shaping. Consider upgrading to Klipper or Marlin.',
  grbl: 'grbl does not support FDM input shaping.',
  repetier: 'Repetier does not natively support input shaping. Consider M593 if running a Marlin-compatible variant.',
  other: 'Consult your firmware documentation for input shaping / resonance compensation support.',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function InputShaper() {
  const boardType = usePrinterStore((s) => s.config.boardType ?? 'other');
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);

  const [shaperType, setShaperType] = useState<ShaperType>('mzv');
  const [freqX, setFreqX] = useState(40.0);
  const [freqY, setFreqY] = useState(40.0);
  const [damping, setDamping] = useState(0.1);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sending, setSending] = useState(false);
  const [testAxis, setTestAxis] = useState<'X' | 'Y'>('X');
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

  const handleTestResonances = () => {
    const cmd = boardType === 'klipper'
      ? `TEST_RESONANCES AXIS=${testAxis}`
      : `; No automated resonance test for ${boardType} — measure manually`;
    void sendCommands([cmd]);
    setStep(2);
  };

  const handleApply = () => {
    const cmds = buildSetCommand(boardType, shaperType, freqX, freqY, damping);
    void sendCommands(cmds);
    setStep(3);
  };

  const handleAnalyzeTower = useCallback(async () => {
    const handler = TOOL_HANDLERS.tuning_analyze_tower;
    setAnalyzing(true);
    setAiError(null);
    try {
      const result = await handler({
        kind: 'input-shaper',
        axis: testAxis,
        frameCount: 3,
        notes: `Input shaper ringing tower for ${boardType}. Recommend frequency for ${testAxis} axis.`,
      }) as {
        recommendation?: { bestValue?: number; confidence?: number; summary?: string };
      };
      const rec = result.recommendation;
      if (rec?.bestValue !== undefined) {
        if (testAxis === 'X') setFreqX(Number(rec.bestValue.toFixed(1)));
        else setFreqY(Number(rec.bestValue.toFixed(1)));
      }
      setAiSummary(rec?.summary ?? 'AI analysis returned no summary.');
      setStep(3);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  }, [boardType, testAxis]);

  const note = FIRMWARE_NOTES[boardType] ?? FIRMWARE_NOTES.other!;
  const setCommands = buildSetCommand(boardType, shaperType, freqX, freqY, damping);

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Cpu size={15} />
        <h3>Input Shaper</h3>
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

        {/* Step 1 — Measure resonance frequency */}
        <div className="klipper-card">
          <div className="klipper-card-header">
            <span className="klipper-step-num" style={{ marginRight: 6 }}>1</span>
            Measure Resonance Frequency
            {step > 1 && <span className="klipper-badge on" style={{ marginLeft: 8 }}>Done</span>}
          </div>
          <div className="klipper-card-body">
            {boardType === 'klipper' ? (
              <>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  If you have an ADXL345 or LIS2DW accelerometer installed, use <code>TEST_RESONANCES</code> to
                  auto-measure. Klipper will generate a frequency graph and recommend optimal values.
                </p>
                <div className="klipper-form-row" style={{ marginBottom: 10 }}>
                  <label>Test axis</label>
                  {(['X', 'Y'] as const).map((a) => (
                    <button key={a} className={`klipper-btn ${testAxis === a ? 'klipper-btn-primary' : ''}`}
                      onClick={() => setTestAxis(a)} style={{ padding: '3px 10px' }}>
                      {a}
                    </button>
                  ))}
                </div>
                <button className="klipper-btn klipper-btn-primary" onClick={handleTestResonances}
                  disabled={!connected || sending}>
                  <Send size={13} /> TEST_RESONANCES AXIS={testAxis}
                </button>
                <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  No accelerometer? Skip to Step 2 and measure frequency manually from a ringing test print.
                </p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Print a ringing calibration model (e.g. from Ellis3D or Prusa) and count the ripples between corner
                ghost artifacts. Frequency = printer speed ÷ ripple spacing. Enter the result in Step 2.
              </p>
            )}
          </div>
        </div>

        {/* Step 2 — Enter frequency values */}
        <div className="klipper-card" style={{ opacity: step < 2 ? 0.5 : 1 }}>
          <div className="klipper-card-header">
            <span className="klipper-step-num" style={{ marginRight: 6 }}>2</span>
            Configure Shaper
            {step > 2 && <span className="klipper-badge on" style={{ marginLeft: 8 }}>Done</span>}
          </div>
          <div className="klipper-card-body">
            {boardType === 'klipper' && (
              <div className="klipper-form-row" style={{ marginBottom: 8 }}>
                <label>Shaper type</label>
                <select value={shaperType} onChange={(e) => setShaperType(e.target.value as ShaperType)}
                  style={{ flex: 1 }}>
                  {SHAPER_TYPES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
            )}
            <div className="klipper-form-row" style={{ marginBottom: 8 }}>
              <label style={{ minWidth: 80 }}>Freq X (Hz)</label>
              <input type="number" min={5} max={200} step={0.5} value={freqX}
                onChange={(e) => setFreqX(parseFloat(e.target.value) || 40)} style={{ width: 90 }} />
              <label style={{ minWidth: 80 }}>Freq Y (Hz)</label>
              <input type="number" min={5} max={200} step={0.5} value={freqY}
                onChange={(e) => setFreqY(parseFloat(e.target.value) || 40)} style={{ width: 90 }} />
            </div>
            {(boardType === 'marlin' || boardType === 'duet') && (
              <div className="klipper-form-row">
                <label style={{ minWidth: 80 }}>Damping ratio</label>
                <input type="number" min={0.01} max={0.5} step={0.01} value={damping}
                  onChange={(e) => setDamping(parseFloat(e.target.value) || 0.1)} style={{ width: 90 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(default 0.1)</span>
              </div>
            )}
            <button className="klipper-btn klipper-btn-primary" style={{ marginTop: 12 }}
              onClick={() => setStep(3)} disabled={step < 2}>
              Confirm Settings
            </button>
            <button className="klipper-btn" style={{ marginTop: 12, marginLeft: 8 }}
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
            Apply Input Shaper
          </div>
          <div className="klipper-card-body">
            <div style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 5,
              padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginBottom: 10,
            }}>
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
                  <Send size={13} /> Save (M500)
                </button>
              )}
            </div>
            {boardType === 'klipper' && (
              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                To make permanent, add <code>[input_shaper]</code> to printer.cfg with <code>shaper_type</code>,
                <code> shaper_freq_x</code>, and <code>shaper_freq_y</code>.
              </p>
            )}
          </div>
        </div>

        {/* Quick reference table */}
        <div className="klipper-card">
          <div className="klipper-card-header">Quick Reference — Input Shaping by Firmware</div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            <table className="klipper-table">
              <thead>
                <tr><th>Firmware</th><th>Command</th><th>Persist</th></tr>
              </thead>
              <tbody>
                <tr><td>Klipper</td><td><code>SET_INPUT_SHAPER SHAPER_TYPE_X=MZV SHAPER_FREQ_X=40</code></td><td>printer.cfg</td></tr>
                <tr><td>Marlin 2.x</td><td><code>M593 X F40 D0.1</code></td><td>M500</td></tr>
                <tr><td>Duet RRF 3.3+</td><td><code>M593 P"MZV" F40 S0.1</code></td><td>config.g</td></tr>
                <tr><td>Smoothie</td><td colSpan={2}>Not supported</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

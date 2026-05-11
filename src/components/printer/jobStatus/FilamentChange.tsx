import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Replace, X, Check, Loader2, Play, Pause, ArrowRight,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import './FilamentChange.css';

type Step = 'idle' | 'pausing' | 'parked' | 'heating' | 'swap' | 'purging' | 'resuming' | 'done' | 'error';

// Sensible defaults we offer up but let the user tweak.
const DEFAULTS = {
  parkX: 10,
  parkY: 200,
  parkZ: 20,
  retractMm: 50,
  purgeMm: 50,
  hotendTarget: 210,
};

export function FilamentChange() {
  const model = usePrinterStore((s) => s.model);
  const pausePrint = usePrinterStore((s) => s.pausePrint);
  const resumePrint = usePrinterStore((s) => s.resumePrint);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
  }, []);
  const [parkX, setParkX] = useState(DEFAULTS.parkX);
  const [parkY, setParkY] = useState(DEFAULTS.parkY);
  const [parkZ, setParkZ] = useState(DEFAULTS.parkZ);
  const [retractMm, setRetractMm] = useState(DEFAULTS.retractMm);
  const [purgeMm, setPurgeMm] = useState(DEFAULTS.purgeMm);
  const [hotendTarget, setHotendTarget] = useState<number>(() => {
    const first = model.tools?.[0]?.active?.[0] ?? DEFAULTS.hotendTarget;
    return typeof first === 'number' && first > 0 ? first : DEFAULTS.hotendTarget;
  });
  const [useMacro, setUseMacro] = useState<'auto' | 'manual'>('auto');

  const status = model.state?.status ?? 'idle';
  const isPrinting = status === 'processing';
  const isPaused = status === 'paused' || status === 'pausing';
  const canStart = isPrinting || isPaused;

  // Keep hotend default in sync with active tool while idle.
  useEffect(() => {
    if (step !== 'idle') return;
    const active = model.tools?.[0]?.active?.[0];
    if (typeof active === 'number' && active > 0 && Math.abs(active - hotendTarget) > 0.5) {
      setHotendTarget(active);
    }
    // We deliberately only recompute when the active tool temp changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.tools]);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
  }, []);

  const handleTrigger = useCallback(async () => {
    setError(null);
    setOpen(true);
  }, []);

  // Step 1: Pause the print and move the head to a safe park position.
  const runPauseAndPark = useCallback(async () => {
    try {
      setStep('pausing');
      if (useMacro === 'auto') {
        // Prefer the printer's own filament-change macro when the user picks
        // automatic mode — it will usually pause, park, and retract atomically.
        await sendGCode('M98 P"0:/macros/filament-change.g"').catch(async () => {
          // Macro not present — fall back to manual sequence.
          if (!isPaused) await pausePrint();
          await sendGCode('M83');                               // relative extruder
          await sendGCode(`G1 E-${retractMm.toFixed(2)} F2400`); // retract
          await sendGCode(`G91`);
          await sendGCode(`G1 Z${parkZ} F900`);                  // lift
          await sendGCode(`G90`);
          await sendGCode(`G1 X${parkX} Y${parkY} F6000`);       // park
        });
      } else {
        if (!isPaused) await pausePrint();
        await sendGCode('M83');
        await sendGCode(`G1 E-${retractMm.toFixed(2)} F2400`);
        await sendGCode('G91');
        await sendGCode(`G1 Z${parkZ} F900`);
        await sendGCode('G90');
        await sendGCode(`G1 X${parkX} Y${parkY} F6000`);
      }
      setStep('parked');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [useMacro, sendGCode, pausePrint, isPaused, retractMm, parkZ, parkX, parkY]);

  // Step 2: Keep hotend hot (user swaps filament now).
  const runHotendReady = useCallback(async () => {
    try {
      setStep('heating');
      // Set the first hotend target; wait for temp in a non-blocking poll.
      await sendGCode(`G10 P0 R${hotendTarget.toFixed(0)} S${hotendTarget.toFixed(0)}`);
      setStep('swap');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sendGCode, hotendTarget]);

  // Step 3: Purge the new filament.
  const runPurge = useCallback(async () => {
    try {
      setStep('purging');
      await sendGCode('M83');
      await sendGCode(`G1 E${purgeMm.toFixed(2)} F300`);
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sendGCode, purgeMm]);

  // Step 4: Resume.
  const runResume = useCallback(async () => {
    try {
      setStep('resuming');
      await resumePrint();
      setStep('done');
      // Auto-close after a short delay so the user sees the success state.
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = setTimeout(() => { setOpen(false); reset(); }, 1200);
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [resumePrint, reset]);

  if (!canStart) return null;

  return (
    <>
      <button
        type="button"
        className="fc__trigger"
        onClick={handleTrigger}
        title="Walk through a guided filament change"
      >
        <Replace size={13} />
        Change Filament
      </button>

      {open && (
        <div className="fc__overlay" onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); reset(); } }}>
          <div className="fc__dialog" role="dialog" aria-modal="true">
            <div className="fc__header">
              <div className="fc__title">
                <Replace size={14} /> Filament Change
              </div>
              <button className="fc__close" onClick={() => { setOpen(false); reset(); }} title="Close">
                <X size={14} />
              </button>
            </div>

            <div className="fc__steps">
              <Pill n={1} label="Pause & Park"    active={step === 'idle' || step === 'pausing'} done={['parked','heating','swap','purging','resuming','done'].includes(step)} />
              <Pill n={2} label="Heat & Swap"     active={step === 'parked' || step === 'heating' || step === 'swap'} done={['purging','resuming','done'].includes(step)} />
              <Pill n={3} label="Purge"           active={step === 'purging'} done={['resuming','done'].includes(step)} />
              <Pill n={4} label="Resume"          active={step === 'resuming' || step === 'done'} done={step === 'done'} />
            </div>

            <div className="fc__body">
              {step === 'idle' && (
                <>
                  <div className="fc__intro">
                    Guided pause → retract → park → swap → purge → resume. Tweak
                    the defaults below if your printer needs different numbers.
                  </div>
                  <div className="fc__mode">
                    <label>
                      <input
                        type="radio"
                        checked={useMacro === 'auto'}
                        onChange={() => setUseMacro('auto')}
                      /> Use <code>filament-change.g</code> if present
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={useMacro === 'manual'}
                        onChange={() => setUseMacro('manual')}
                      /> Manual sequence
                    </label>
                  </div>
                  <div className="fc__grid">
                    <LabelledInput label="Park X (mm)" value={parkX} onChange={setParkX} />
                    <LabelledInput label="Park Y (mm)" value={parkY} onChange={setParkY} />
                    <LabelledInput label="Park Z lift (mm)" value={parkZ} onChange={setParkZ} />
                    <LabelledInput label="Retract (mm)" value={retractMm} onChange={setRetractMm} />
                    <LabelledInput label="Purge (mm)" value={purgeMm} onChange={setPurgeMm} />
                    <LabelledInput label="Hotend (°C)" value={hotendTarget} onChange={setHotendTarget} />
                  </div>
                  <div className="fc__actions">
                    <button className="fc__btn fc__btn--primary" onClick={runPauseAndPark}>
                      <Pause size={13} /> Pause & Park
                    </button>
                  </div>
                </>
              )}

              {step === 'pausing' && (
                <div className="fc__status"><Loader2 className="fc__spin" size={16} /> Pausing print and moving to park…</div>
              )}

              {step === 'parked' && (
                <>
                  <div className="fc__intro">
                    Head is parked. Keep the hotend hot to make the swap easier,
                    or lower the temperature while you load the new spool.
                  </div>
                  <div className="fc__actions">
                    <button className="fc__btn fc__btn--primary" onClick={runHotendReady}>
                      <ArrowRight size={13} /> Keep hotend @ {hotendTarget}°C
                    </button>
                  </div>
                </>
              )}

              {step === 'heating' && (
                <div className="fc__status"><Loader2 className="fc__spin" size={16} /> Setting hotend target…</div>
              )}

              {step === 'swap' && (
                <>
                  <div className="fc__intro">
                    Swap the filament now. When the new filament is loaded and
                    primed at the nozzle, click <strong>Purge</strong>.
                  </div>
                  <div className="fc__actions">
                    <button className="fc__btn fc__btn--primary" onClick={runPurge}>
                      <ArrowRight size={13} /> Purge {purgeMm}mm
                    </button>
                  </div>
                </>
              )}

              {step === 'purging' && (
                <>
                  <div className="fc__status"><Loader2 className="fc__spin" size={16} /> Purging new filament…</div>
                  <div className="fc__actions">
                    <button className="fc__btn fc__btn--primary" onClick={runResume}>
                      <Play size={13} /> Resume print
                    </button>
                  </div>
                </>
              )}

              {step === 'resuming' && (
                <div className="fc__status"><Loader2 className="fc__spin" size={16} /> Resuming print…</div>
              )}

              {step === 'done' && (
                <div className="fc__status fc__status--success">
                  <Check size={16} /> Print resumed — closing.
                </div>
              )}

              {step === 'error' && (
                <>
                  <div className="fc__status fc__status--error">
                    Error: {error}
                  </div>
                  <div className="fc__actions">
                    <button className="fc__btn" onClick={reset}>Start over</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Pill({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`fc__pill${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
      <span className="fc__pill-num">{done ? <Check size={11} /> : n}</span>
      <span>{label}</span>
    </div>
  );
}

function LabelledInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="fc__field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step={1}
      />
    </label>
  );
}

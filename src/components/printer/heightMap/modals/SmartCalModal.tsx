import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, CheckCircle, ChevronRight, Crosshair, Home, Loader2,
  Minus, Plus, RefreshCw, Repeat2, Ruler, ScanLine, TriangleAlert, Wand2, X,
} from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import type { SmartCalOpts, SmartCalPreset, SmartCalResult, SmartCalStep } from '../types';

export function SmartCalModal({
  onConfirm, onCancel,
  isRunning, phase, liveSteps, result, onClear,
}: {
  onConfirm:  (opts: SmartCalOpts) => void;
  onCancel:   () => void;
  isRunning:  boolean;
  phase:      'homing' | 'leveling' | 'probing' | 'datum' | null;
  liveSteps:  SmartCalStep[];
  result:     SmartCalResult | null;
  onClear:    () => void;
}) {
  const [homeFirst,       setHomeFirst]       = useState(true);
  const [maxIterations,   setMaxIterations]   = useState(3);
  const [maxLevelPasses,  setMaxLevelPasses]  = useState(2);
  const [targetMean,      setTargetMean]      = useState(0.15);
  const [targetDeviation, setTargetDeviation] = useState(0.05);
  const [probePasses,     setProbePasses]     = useState(1);
  const [probesPerPoint,  setProbesPerPoint]  = useState(1);
  const [probeTolerance,  setProbeTolerance]  = useState(0.05);
  const [activePreset,    setActivePreset]    = useState<SmartCalPreset>('balanced');

  const logScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [liveSteps, result]);

  const handleConfirm = useCallback(() => onConfirm({
    homeFirst, maxIterations, maxLevelPasses, probePasses, targetMean, targetDeviation, probesPerPoint, probeTolerance,
  }), [homeFirst, maxIterations, maxLevelPasses, probePasses, targetMean, targetDeviation, probesPerPoint, probeTolerance, onConfirm]);

  const setPreset = (preset: Exclude<SmartCalPreset, 'custom'>) => {
    setActivePreset(preset);
    if (preset === 'quick') {
      setMaxIterations(2);
      setMaxLevelPasses(1);
      setProbePasses(1);
      setTargetMean(0.2);
      setTargetDeviation(0.08);
      setProbesPerPoint(1);
      setProbeTolerance(0.05);
      return;
    }
    if (preset === 'precise') {
      setMaxIterations(5);
      setMaxLevelPasses(3);
      setProbePasses(2);
      setTargetMean(0.08);
      setTargetDeviation(0.03);
      setProbesPerPoint(3);
      setProbeTolerance(0.03);
      return;
    }
    // balanced
    setMaxIterations(3);
    setMaxLevelPasses(2);
    setProbePasses(1);
    setTargetMean(0.15);
    setTargetDeviation(0.05);
    setProbesPerPoint(1);
    setProbeTolerance(0.05);
  };

  const setClampedNumber = (
    value: string,
    min: number,
    max: number,
    setter: (next: number) => void,
    round = false,
  ) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setActivePreset('custom');
    setter(Math.min(max, Math.max(min, round ? Math.round(parsed) : parsed)));
  };

  const stepNumber = (
    value: number,
    delta: number,
    min: number,
    max: number,
    setter: (next: number) => void,
    decimals = 2,
    round = false,
  ) => {
    const next = round ? Math.round(value + delta) : Number((value + delta).toFixed(decimals));
    setActivePreset('custom');
    setter(Math.min(max, Math.max(min, next)));
  };

  const phaseLabels: Record<NonNullable<typeof phase>, string> = {
    homing:   'Homing axes…',
    leveling: 'Leveling bed…',
    probing:  'Probing mesh…',
    datum:    'Calibrating Z datum…',
  };

  const STEP_META: Record<SmartCalStep['kind'], { color: string }> = {
    level:    { color: '#22c55e' },
    probe:    { color: '#3b82f6' },
    datum:    { color: '#a855f7' },
    decision: { color: '#f59e0b' },
    done:     { color: '#34d399' },
    info:     { color: '#94a3b8' },
  };

  const QUALITY_COLOR: Record<SmartCalStep['quality'], string> = {
    good: '#22c55e',
    warn: '#f59e0b',
    bad:  '#ef4444',
    info: '#94a3b8',
  };

  const stopLabels: Record<NonNullable<SmartCalResult['stopReason']>, string> = {
    converged:     'Converged — within targets',
    maxIterations: 'Max iterations reached',
    failed:        'Sequence failed',
  };

  const stopColors: Record<NonNullable<SmartCalResult['stopReason']>, string> = {
    converged:     '#22c55e',
    maxIterations: '#f59e0b',
    failed:        '#ef4444',
  };

  const cancelLabel = isRunning ? 'Hide' : result ? 'Close' : 'Cancel';

  return (
    <Modal
      onClose={onCancel}
      onEnter={isRunning ? undefined : handleConfirm}
      title="Smart Calibration"
      titleIcon={<Wand2 size={15} style={{ color: '#a855f7', flexShrink: 0 }} />}
      size="wide"
      className="hm-smartcal-modal"
    >
      <ModalBody className="hm-smartcal-body">
        <div className="hm-smartcal-hero">
          <div>
            <p className="hm-smartcal-kicker">Closed-loop calibration</p>
            <p className="hm-smartcal-intro">
              Smart Cal levels the bed, probes the mesh, checks the result, then repeats only when the data says it should.
            </p>
          </div>
          <button
            type="button"
            className={`hm-smartcal-home-toggle${homeFirst ? ' is-on' : ''}`}
            onClick={() => setHomeFirst((v) => !v)}
            disabled={isRunning}
          >
            <Home size={13} />
            {homeFirst ? 'Home first' : 'Skip home'}
          </button>
        </div>

        <div className="hm-smartcal-flow" aria-label="Smart calibration sequence">
          {[
            ['Level', <Home size={14} key="level" />],
            ['Probe', <Crosshair size={14} key="probe" />],
            ['Diagnose', <ScanLine size={14} key="diagnose" />],
            ['Repeat', <RefreshCw size={14} key="repeat" />],
          ].map(([label, icon], index) => (
            <div className="hm-smartcal-flow-step" key={String(label)}>
              <span className="hm-smartcal-flow-icon">{icon}</span>
              <span>{label}</span>
              {index < 3 && <ChevronRight size={13} className="hm-smartcal-flow-arrow" />}
            </div>
          ))}
        </div>

        <div className="hm-smartcal-presets" role="group" aria-label="Smart calibration presets">
          <button
            type="button"
            className={activePreset === 'quick' ? 'is-active' : ''}
            onClick={() => setPreset('quick')}
            disabled={isRunning}
          >
            Quick
          </button>
          <button
            type="button"
            className={activePreset === 'balanced' ? 'is-active' : ''}
            onClick={() => setPreset('balanced')}
            disabled={isRunning}
          >
            Balanced
          </button>
          <button
            type="button"
            className={activePreset === 'precise' ? 'is-active' : ''}
            onClick={() => setPreset('precise')}
            disabled={isRunning}
          >
            Precise
          </button>
        </div>

        <div className="hm-smartcal-grid hm-smartcal-grid--matrix">

          {/* ── Bed Leveling row ────────────────────────────────────────── */}
          <div className="hm-smartcal-row hm-smartcal-row--level">
            <div className="hm-smartcal-row-head">
              <Home size={14} />
              <div>
                <span>Bed Leveling</span>
                <small>Auto-trams the bed before each probe pass.</small>
              </div>
            </div>

            {/* Loop Limit */}
            <div className="hm-smartcal-card">
              <div className="hm-smartcal-card-head">
                <Repeat2 size={14} />
                <span>Loop Limit</span>
              </div>
              <label className="hm-smartcal-iter-label" title="Maximum total probe-and-diagnose iterations">
                Max iterations
              </label>
              <div className="hm-smartcal-iter-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`hm-smartcal-iter-btn${maxIterations === n ? ' is-on' : ''}`}
                    onClick={() => { setActivePreset('custom'); setMaxIterations(n); }}
                    title={`${n} maximum ${n === 1 ? 'iteration' : 'iterations'}`}
                    disabled={isRunning}
                  >{n}</button>
                ))}
              </div>
              <span className="hm-smartcal-card-note">Stops early when targets are met.</span>
            </div>

            {/* Level Cap */}
            <div className="hm-smartcal-card">
              <div className="hm-smartcal-card-head">
                <Repeat2 size={14} />
                <span>Level Cap</span>
              </div>
              <label className="hm-smartcal-iter-label" title="Hard cap on how many bed-leveling passes may run in one session">
                Max level passes
              </label>
              <div className="hm-smartcal-iter-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`hm-smartcal-iter-btn${maxLevelPasses === n ? ' is-on' : ''}`}
                    onClick={() => { setActivePreset('custom'); setMaxLevelPasses(n); }}
                    title={`Cap leveling at ${n} ${n === 1 ? 'pass' : 'passes'}`}
                    disabled={isRunning}
                  >{n}</button>
                ))}
              </div>
              <span className="hm-smartcal-card-note">Re-levels only when RMS target is missed.</span>
            </div>

            {/* Re-level threshold */}
            <div className="hm-smartcal-card">
              <div className="hm-smartcal-card-head">
                <Ruler size={14} />
                <span>Re-level Threshold</span>
              </div>
              <label className="hm-smartcal-field">
                <span>
                  RMS trigger
                  <small>Run another level pass when RMS exceeds this.</small>
                </span>
                <span className="hm-smartcal-input hm-smartcal-picker">
                  <button
                    type="button"
                    onClick={() => stepNumber(targetDeviation, -0.01, 0.01, 0.3, setTargetDeviation)}
                    disabled={targetDeviation <= 0.01 || isRunning}
                    title="Decrease re-level threshold"
                  ><Minus size={12} /></button>
                  <input
                    type="number" min={0.01} max={0.3} step={0.01}
                    value={targetDeviation}
                    disabled={isRunning}
                    onChange={(e) => setClampedNumber(e.target.value, 0.01, 0.3, setTargetDeviation)}
                  />
                  <button
                    type="button"
                    onClick={() => stepNumber(targetDeviation, 0.01, 0.01, 0.3, setTargetDeviation)}
                    disabled={targetDeviation >= 0.3 || isRunning}
                    title="Increase re-level threshold"
                  ><Plus size={12} /></button>
                  <em>mm</em>
                </span>
              </label>
            </div>
          </div>

          {/* ── Probe row ────────────────────────────────────────────────── */}
          <div className="hm-smartcal-row hm-smartcal-row--probe">
            <div className="hm-smartcal-row-head">
              <Crosshair size={14} />
              <div>
                <span>Probe</span>
                <small>Maps the surface and diagnoses convergence.</small>
              </div>
            </div>

            {/* Loop Limit — mesh sweeps per iteration */}
            <div className="hm-smartcal-card">
              <div className="hm-smartcal-card-head">
                <Repeat2 size={14} />
                <span>Loop Limit</span>
              </div>
              <label className="hm-smartcal-iter-label" title="Full mesh sweeps per Smart Cal iteration — the last result is used for analysis">
                Passes per iteration
              </label>
              <div className="hm-smartcal-iter-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`hm-smartcal-iter-btn${probePasses === n ? ' is-on' : ''}`}
                    onClick={() => { setActivePreset('custom'); setProbePasses(n); }}
                    title={`${n} full mesh sweep${n === 1 ? '' : 's'} per iteration`}
                    disabled={isRunning}
                  >{n}</button>
                ))}
              </div>
              <span className="hm-smartcal-card-note">Final sweep is used for mesh analysis.</span>
            </div>

            {/* Z Datum */}
            <div className="hm-smartcal-card">
              <div className="hm-smartcal-card-head">
                <Ruler size={14} />
                <span>Z Datum</span>
              </div>
              <label className="hm-smartcal-field">
                <span>
                  Datum threshold
                  <small>Recalibrate Z=0 when |mean| reaches this.</small>
                </span>
                <span className="hm-smartcal-input hm-smartcal-picker">
                  <button
                    type="button"
                    onClick={() => stepNumber(targetMean, -0.01, 0.02, 0.5, setTargetMean)}
                    disabled={targetMean <= 0.02 || isRunning}
                    title="Decrease Z datum threshold"
                  ><Minus size={12} /></button>
                  <input
                    type="number" min={0.02} max={0.5} step={0.01}
                    value={targetMean}
                    disabled={isRunning}
                    onChange={(e) => setClampedNumber(e.target.value, 0.02, 0.5, setTargetMean)}
                  />
                  <button
                    type="button"
                    onClick={() => stepNumber(targetMean, 0.01, 0.02, 0.5, setTargetMean)}
                    disabled={targetMean >= 0.5 || isRunning}
                    title="Increase Z datum threshold"
                  ><Plus size={12} /></button>
                  <em>mm</em>
                </span>
              </label>
            </div>

            {/* Probe Quality — dives per point + spread limit combined */}
            <div className="hm-smartcal-card hm-smartcal-card--quality">
              <div className="hm-smartcal-card-head">
                <ScanLine size={14} />
                <span>Probe Quality</span>
              </div>

              {/* Dives per point — integer 1–5 button picker */}
              <label className="hm-smartcal-iter-label" title="Z dives per probe point — averages out noisy samples">
                Dives per point
              </label>
              <div className="hm-smartcal-iter-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`hm-smartcal-iter-btn${probesPerPoint === n ? ' is-on' : ''}`}
                    onClick={() => { setActivePreset('custom'); setProbesPerPoint(n); }}
                    title={`${n} Z dive${n === 1 ? '' : 's'} per probe point`}
                    disabled={isRunning}
                  >{n}</button>
                ))}
              </div>

              {/* Spread limit — inline, dims when dives = 1 */}
              <label className={`hm-smartcal-field hm-smartcal-field--sub${probesPerPoint <= 1 ? ' is-dim' : ''}`}>
                <span>
                  Spread limit
                  <small>
                    {probesPerPoint > 1
                      ? 'Max allowed range between repeated dives.'
                      : 'Active when dives per point > 1.'}
                  </small>
                </span>
                <span className="hm-smartcal-input hm-smartcal-picker">
                  <button
                    type="button"
                    onClick={() => stepNumber(probeTolerance, -0.01, 0.01, 0.1, setProbeTolerance)}
                    disabled={probeTolerance <= 0.01 || probesPerPoint <= 1 || isRunning}
                    title="Decrease spread limit"
                  ><Minus size={12} /></button>
                  <input
                    type="number" min={0.01} max={0.1} step={0.01}
                    value={probeTolerance}
                    disabled={probesPerPoint <= 1 || isRunning}
                    onChange={(e) => setClampedNumber(e.target.value, 0.01, 0.1, setProbeTolerance)}
                  />
                  <button
                    type="button"
                    onClick={() => stepNumber(probeTolerance, 0.01, 0.01, 0.1, setProbeTolerance)}
                    disabled={probeTolerance >= 0.1 || probesPerPoint <= 1 || isRunning}
                    title="Increase spread limit"
                  ><Plus size={12} /></button>
                  <em>mm</em>
                </span>
              </label>
            </div>
          </div>

        </div>
        <p className="hm-smartcal-intro">
          Runs a closed-loop sequence: <strong>Level → Probe → Diagnose → Repeat</strong>.
          Adjusts the Z datum if mean offset is large, re-levels if RMS is still high.
        </p>

        {/* ── Activity / log section ── */}
        {(isRunning || liveSteps.length > 0 || result) && (
          <>
            {/* Scrollable log box */}
            <div className="hm-smartcal-activity" ref={logScrollRef}>
              <div className="hm-smartcal-activity__header">
                <Activity size={11} />
                Calibration log
              </div>
              <div className="hm-smartcal-activity__body">
                {liveSteps.map((step, i) => {
                  const meta = STEP_META[step.kind];
                  const qualColor = QUALITY_COLOR[step.quality];
                  return (
                    <div
                      key={i}
                      className="hm-smartcal-step"
                      style={{ '--step-color': qualColor } as React.CSSProperties}
                    >
                      <div
                        className="hm-smartcal-step__icon"
                        style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, borderColor: `color-mix(in srgb, ${meta.color} 30%, transparent)` }}
                      />
                      <div className="hm-smartcal-step__body">
                        <span className="hm-smartcal-step__label" style={{ color: qualColor }}>{step.label}</span>
                        {step.detail && <span className="hm-smartcal-step__detail">{step.detail}</span>}
                      </div>
                    </div>
                  );
                })}
                {isRunning && phase && (
                  <div className="hm-smartcal-activity__phase">
                    <Loader2 size={12} className="hm-smartcal-activity__spin" />
                    <span>{phaseLabels[phase]}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Final result summary — outside scroll box */}
            {result && !isRunning && (
              <div className="hm-smartcal-result">
                {result.stopReason !== 'maxIterations' && (
                  <div
                    className="hm-smartcal-stop-banner"
                    style={{ '--scr-color': stopColors[result.stopReason] } as React.CSSProperties}
                  >
                    {result.stopReason === 'converged' ? <CheckCircle size={13} /> : <TriangleAlert size={13} />}
                    {stopLabels[result.stopReason]}
                  </div>
                )}
                {result.finalStats && (
                  <div className="hm-smartcal-final-stats">
                    <div className="hm-smartcal-stat">
                      <span className="hm-smartcal-stat__label">Final RMS</span>
                      <span className="hm-smartcal-stat__val" style={{ color: result.finalStats.rms < 0.1 ? '#22c55e' : result.finalStats.rms < 0.2 ? '#f59e0b' : '#ef4444' }}>
                        {result.finalStats.rms.toFixed(4)} mm
                      </span>
                    </div>
                    <div className="hm-smartcal-stat">
                      <span className="hm-smartcal-stat__label">Final Mean</span>
                      <span className="hm-smartcal-stat__val" style={{ color: Math.abs(result.finalStats.mean) < 0.1 ? '#22c55e' : '#f59e0b' }}>
                        {result.finalStats.mean >= 0 ? '+' : ''}{result.finalStats.mean.toFixed(3)} mm
                      </span>
                    </div>
                    <div className="hm-smartcal-stat">
                      <span className="hm-smartcal-stat__label">Range</span>
                      <span className="hm-smartcal-stat__val">{(result.finalStats.max - result.finalStats.min).toFixed(3)} mm</span>
                    </div>
                  </div>
                )}
                <button type="button" className="hm-smartcal-clear-btn" onClick={onClear}>
                  <X size={12} />
                  Clear log
                </button>
              </div>
            )}
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>{cancelLabel}</button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm"
          onClick={handleConfirm}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 size={13} className="hm-smartcal-activity__spin" />
              Running…
            </>
          ) : (
            <>
              <Wand2 size={13} />
              Run Smart Cal
            </>
          )}
        </button>
      </ModalFooter>
    </Modal>
  );
}

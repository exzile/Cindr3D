import { useCallback, useState } from 'react';
import { ChevronRight, Crosshair, Home, Minus, Plus, RefreshCw, Repeat2, Ruler, ScanLine, Wand2 } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import type { SmartCalOpts, SmartCalPreset } from '../types';

export function SmartCalModal({
  onConfirm, onCancel,
}: {
  onConfirm: (opts: SmartCalOpts) => void;
  onCancel:  () => void;
}) {
  const [homeFirst,       setHomeFirst]       = useState(true);
  const [maxIterations,   setMaxIterations]   = useState(3);
  const [targetMean,      setTargetMean]      = useState(0.15);
  const [targetDeviation, setTargetDeviation] = useState(0.05);
  const [probesPerPoint,  setProbesPerPoint]  = useState(1);
  const [probeTolerance,  setProbeTolerance]  = useState(0.05);
  const [activePreset,    setActivePreset]    = useState<SmartCalPreset>('balanced');

  const handleConfirm = useCallback(() => onConfirm({
    homeFirst, maxIterations, targetMean, targetDeviation, probesPerPoint, probeTolerance,
  }), [homeFirst, maxIterations, targetMean, targetDeviation, probesPerPoint, probeTolerance, onConfirm]);

  const setPreset = (preset: Exclude<SmartCalPreset, 'custom'>) => {
    setActivePreset(preset);
    if (preset === 'quick') {
      setMaxIterations(2);
      setTargetMean(0.2);
      setTargetDeviation(0.08);
      setProbesPerPoint(1);
      setProbeTolerance(0.05);
      return;
    }
    if (preset === 'precise') {
      setMaxIterations(5);
      setTargetMean(0.08);
      setTargetDeviation(0.03);
      setProbesPerPoint(3);
      setProbeTolerance(0.03);
      return;
    }
    setMaxIterations(3);
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

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
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
          >
            Quick
          </button>
          <button
            type="button"
            className={activePreset === 'balanced' ? 'is-active' : ''}
            onClick={() => setPreset('balanced')}
          >
            Balanced
          </button>
          <button
            type="button"
            className={activePreset === 'precise' ? 'is-active' : ''}
            onClick={() => setPreset('precise')}
          >
            Precise
          </button>
        </div>

        <div className="hm-smartcal-grid">
          <div className="hm-smartcal-card">
            <div className="hm-smartcal-card-head">
              <Repeat2 size={14} />
              <span>Loop Limit</span>
            </div>
            <div className="hm-smartcal-iter-row">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  className={`hm-smartcal-iter-btn${maxIterations === n ? ' is-on' : ''}`}
                  onClick={() => { setActivePreset('custom'); setMaxIterations(n); }}
                  title={`${n} maximum ${n === 1 ? 'pass' : 'passes'}`}
                >{n}</button>
              ))}
            </div>
            <span className="hm-smartcal-card-note">Stops early when targets are met.</span>
          </div>

          <div className="hm-smartcal-card">
            <div className="hm-smartcal-card-head">
              <Ruler size={14} />
              <span>Convergence</span>
            </div>
            <label className="hm-smartcal-field">
              <span>
                Z datum threshold
                <small>Adjust datum when mean reaches this value.</small>
              </span>
              <span className="hm-smartcal-input hm-smartcal-picker">
                <button
                  type="button"
                  onClick={() => stepNumber(targetMean, -0.01, 0.02, 0.5, setTargetMean)}
                  disabled={targetMean <= 0.02}
                  title="Decrease Z datum threshold"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number" min={0.02} max={0.5} step={0.01}
                  value={targetMean}
                  onChange={(e) => setClampedNumber(e.target.value, 0.02, 0.5, setTargetMean)}
                />
                <button
                  type="button"
                  onClick={() => stepNumber(targetMean, 0.01, 0.02, 0.5, setTargetMean)}
                  disabled={targetMean >= 0.5}
                  title="Increase Z datum threshold"
                >
                  <Plus size={12} />
                </button>
                <em>mm</em>
              </span>
            </label>
            <label className="hm-smartcal-field">
              <span>
                Re-level threshold
                <small>Run another level pass when RMS reaches this value.</small>
              </span>
              <span className="hm-smartcal-input hm-smartcal-picker">
                <button
                  type="button"
                  onClick={() => stepNumber(targetDeviation, -0.01, 0.01, 0.3, setTargetDeviation)}
                  disabled={targetDeviation <= 0.01}
                  title="Decrease re-level threshold"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number" min={0.01} max={0.3} step={0.01}
                  value={targetDeviation}
                  onChange={(e) => setClampedNumber(e.target.value, 0.01, 0.3, setTargetDeviation)}
                />
                <button
                  type="button"
                  onClick={() => stepNumber(targetDeviation, 0.01, 0.01, 0.3, setTargetDeviation)}
                  disabled={targetDeviation >= 0.3}
                  title="Increase re-level threshold"
                >
                  <Plus size={12} />
                </button>
                <em>mm</em>
              </span>
            </label>
          </div>

          <div className="hm-smartcal-card">
            <div className="hm-smartcal-card-head">
              <ScanLine size={14} />
              <span>Probe Quality</span>
            </div>
            <label className="hm-smartcal-field">
              <span>
                Dives per point
                <small>Higher values take longer and reduce noisy samples.</small>
              </span>
              <span className="hm-smartcal-input hm-smartcal-picker">
                <button
                  type="button"
                  onClick={() => stepNumber(probesPerPoint, -1, 1, 5, setProbesPerPoint, 0, true)}
                  disabled={probesPerPoint <= 1}
                  title="Decrease dives per point"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number" min={1} max={5} step={1}
                  value={probesPerPoint}
                  onChange={(e) => setClampedNumber(e.target.value, 1, 5, setProbesPerPoint, true)}
                />
                <button
                  type="button"
                  onClick={() => stepNumber(probesPerPoint, 1, 1, 5, setProbesPerPoint, 0, true)}
                  disabled={probesPerPoint >= 5}
                  title="Increase dives per point"
                >
                  <Plus size={12} />
                </button>
              </span>
            </label>
            {probesPerPoint > 1 && (
              <label className="hm-smartcal-field">
                <span>
                  Dive tolerance
                  <small>Maximum spread allowed between repeated dives.</small>
                </span>
                <span className="hm-smartcal-input hm-smartcal-picker">
                  <button
                    type="button"
                    onClick={() => stepNumber(probeTolerance, -0.01, 0.01, 0.1, setProbeTolerance)}
                    disabled={probeTolerance <= 0.01}
                    title="Decrease dive tolerance"
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="number" min={0.01} max={0.1} step={0.01}
                    value={probeTolerance}
                    onChange={(e) => setClampedNumber(e.target.value, 0.01, 0.1, setProbeTolerance)}
                  />
                  <button
                    type="button"
                    onClick={() => stepNumber(probeTolerance, 0.01, 0.01, 0.1, setProbeTolerance)}
                    disabled={probeTolerance >= 0.1}
                    title="Increase dive tolerance"
                  >
                    <Plus size={12} />
                  </button>
                  <em>mm</em>
                </span>
              </label>
            )}
          </div>
        </div>
        <p className="hm-smartcal-intro">
          Runs a closed-loop sequence: <strong>Level → Probe → Diagnose → Repeat</strong>.
          Adjusts the Z datum if mean offset is large, re-levels if RMS is still high.
        </p>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
        <button className="bc-modal-btn bc-modal-btn--confirm" onClick={handleConfirm}>
          <Wand2 size={13} />
          Run Smart Cal
        </button>
      </ModalFooter>
    </Modal>
  );
}

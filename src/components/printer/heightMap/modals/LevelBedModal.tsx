import { useCallback, useState } from 'react';
import { Home, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import type { LevelBedOpts } from '../../../../store/printerStore';

export function LevelBedModal({
  onConfirm, onCancel,
}: {
  onConfirm: (opts: LevelBedOpts & { homeFirst: boolean }) => void;
  onCancel: () => void;
}) {
  const [homeFirst,        setHomeFirst]        = useState(false);
  const [repeat,           setRepeat]           = useState(1);
  const [autoConverge,     setAutoConverge]     = useState(false);
  const [maxPasses,        setMaxPasses]        = useState(5);
  const [targetDeviation,  setTargetDeviation]  = useState(0.05);
  const [probesPerPoint,   setProbesPerPoint]   = useState(1);
  const [probeTolerance,   setProbeTolerance]   = useState(0.05);

  const handleConfirm = useCallback(() => onConfirm({
    homeFirst,
    autoConverge,
    probesPerPoint,
    probeTolerance,
    ...(autoConverge
      ? { maxPasses, targetDeviation }
      : { repeat }),
  }), [autoConverge, homeFirst, maxPasses, onConfirm, probesPerPoint, probeTolerance, repeat, targetDeviation]);

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title="Level Bed — G32"
      titleIcon={<TriangleAlert size={15} className="bc-modal-warn-icon" />}
      ariaLabelledBy="hm-level-modal-title"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          Runs <code>bed_tilt.g</code> to tilt-correct the bed using independent Z motors.
          Make sure the bed is clear and the nozzle is clean before continuing.
        </p>

        <div className="bc-modal-steps">
          <label className={`bc-modal-step bc-modal-step--toggle${homeFirst ? '' : ' is-disabled'}`}>
            <input type="checkbox" className="bc-modal-checkbox" checked={homeFirst} onChange={(e) => setHomeFirst(e.target.checked)} />
            <Home size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">Home all axes first</span>
              <span className="bc-modal-step-cmd">G28</span>
            </div>
          </label>
        </div>

        <div className="bc-modal-probe-dives-group">
          <div className="bc-modal-repeat-row">
            <label className="bc-modal-repeat-label" htmlFor="hm-level-probes-per-point">Per point</label>
            <input
              id="hm-level-probes-per-point"
              type="number"
              className="bc-modal-num-input"
              min={1}
              max={5}
              value={probesPerPoint}
              onChange={(e) => setProbesPerPoint(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            />
            <span className="bc-modal-repeat-hint">
              {probesPerPoint === 1 ? 'probe dive' : 'probe dives'} · M558 A{probesPerPoint}
              {probesPerPoint > 1 && ` S${probeTolerance}`}
            </span>
          </div>
          {probesPerPoint > 1 && (
            <div className="bc-modal-repeat-row bc-modal-repeat-row--sub">
              <label className="bc-modal-repeat-label" htmlFor="hm-level-tolerance">Tolerance</label>
              <input
                id="hm-level-tolerance"
                type="number"
                className="bc-modal-num-input"
                min={0.01}
                max={0.5}
                step={0.01}
                value={probeTolerance}
                onChange={(e) => setProbeTolerance(Math.max(0.01, Math.min(0.5, Number(e.target.value) || 0.05)))}
              />
              <span className="bc-modal-repeat-hint">mm max spread · M558 S{probeTolerance}</span>
            </div>
          )}
        </div>

        {/* ── Mode toggle ── */}
        <div className="bc-modal-mode-row">
          <span className="bc-modal-mode-label">Mode</span>
          <div className="bc-modal-mode-toggle">
            <button
              type="button"
              className={`bc-modal-mode-btn${!autoConverge ? ' is-active' : ''}`}
              onClick={() => setAutoConverge(false)}
            >
              Fixed passes
            </button>
            <button
              type="button"
              className={`bc-modal-mode-btn${autoConverge ? ' is-active' : ''}`}
              onClick={() => setAutoConverge(true)}
            >
              Auto-converge
            </button>
          </div>
        </div>

        {/* ── Fixed mode fields ── */}
        {!autoConverge && (
          <div className="bc-modal-repeat-row">
            <label className="bc-modal-repeat-label" htmlFor="hm-level-repeat">Passes</label>
            <input
              id="hm-level-repeat"
              type="number"
              className="bc-modal-num-input"
              min={1} max={10}
              value={repeat}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n)) setRepeat(Math.max(1, Math.min(10, n)));
              }}
            />
            <span className="bc-modal-repeat-hint">
              {repeat === 1 ? 'tilt-correction pass' : 'tilt-correction passes'}
            </span>
          </div>
        )}

        {/* ── Auto-converge fields ── */}
        {autoConverge && (
          <div className="bc-modal-auto-fields">
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="hm-level-maxpasses">Max passes</label>
              <input
                id="hm-level-maxpasses"
                type="number"
                className="bc-modal-num-input"
                min={2} max={10}
                value={maxPasses}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n)) setMaxPasses(Math.max(2, Math.min(10, n)));
                }}
              />
              <span className="bc-modal-repeat-hint">safety cap</span>
            </div>
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="hm-level-target">Target</label>
              <input
                id="hm-level-target"
                type="number"
                className="bc-modal-num-input"
                min={0.01} max={0.5} step={0.01}
                value={targetDeviation}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) setTargetDeviation(Math.max(0.01, Math.min(0.5, n)));
                }}
              />
              <span className="bc-modal-repeat-hint">mm deviation</span>
            </div>
            <p className="bc-modal-auto-hint">
              Always runs at least 2 passes — pass 1 corrects, pass 2 measures the actual result.
              Stops early once the verified deviation is below target or improvement drops below 15%.
            </p>
          </div>
        )}

        <ul className="bc-modal-checklist">
          <li>Bed is clear of all objects and clips</li>
          <li>Nozzle is clean — no filament blobs</li>
        </ul>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level"
          onClick={handleConfirm}
          autoFocus
        >
          <Home size={13} />
          {homeFirst
            ? (autoConverge ? 'Home & Auto-Level' : `Home & Level${repeat > 1 ? ` ×${repeat}` : ''}`)
            : (autoConverge ? 'Auto-Level' : repeat > 1 ? `Level ×${repeat}` : 'Level Bed')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

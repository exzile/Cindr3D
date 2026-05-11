import { useCallback, useState } from 'react';
import { Crosshair, Grid3x3, Home, ScanLine, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import { Z_DATUM_SUGGEST_THRESHOLD, type ProbeOpts } from '../types';
import type { PrinterBoardType } from '../../../../types/duet';

export function ProbeConfirmModal({
  onConfirm, onCancel, m557Command, gridLabel, boardType, lastMapMean,
}: {
  onConfirm: (opts: ProbeOpts) => void;
  onCancel: () => void;
  m557Command: string;
  gridLabel: string;
  boardType: PrinterBoardType | undefined;
  /** Mean Z offset of the last loaded height map — used to auto-suggest datum calibration. */
  lastMapMean: number | null;
}) {
  const suggestDatum = lastMapMean !== null && Math.abs(lastMapMean) >= Z_DATUM_SUGGEST_THRESHOLD;
  const [homeFirst, setHomeFirst] = useState(true);
  const [calibrateZDatum, setCalibrateZDatum] = useState(suggestDatum);
  const [probesPerPoint, setProbesPerPoint] = useState(1);
  const [probeTolerance, setProbeTolerance] = useState(0.05);
  const [mode, setMode] = useState<'fixed' | 'converge'>('fixed');
  const [passes, setPasses] = useState(1);
  const [maxPasses, setMaxPasses] = useState(5);
  const [targetDiff, setTargetDiff] = useState(0.02);
  const isRRF = !boardType || boardType === 'duet';

  const handleConfirm = useCallback(
    () => onConfirm({ homeFirst, calibrateZDatum, probesPerPoint, probeTolerance, mode, passes, maxPasses, targetDiff }),
    [homeFirst, calibrateZDatum, probesPerPoint, probeTolerance, mode, passes, maxPasses, targetDiff, onConfirm],
  );

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title={`Probe Bed Mesh — ${gridLabel}`}
      titleIcon={<TriangleAlert size={15} className="bc-modal-warn-icon" />}
      ariaLabelledBy="hm-probe-modal-title"
      closeButtonTitle="Cancel"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          The toolhead will traverse the bed to measure surface deviation.
          Make sure the bed is clear before continuing.
        </p>
        <div className="bc-modal-steps">
          <div className="bc-modal-step">
            <Grid3x3 size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">Configure probe grid</span>
              <span className="bc-modal-step-cmd">{m557Command}</span>
            </div>
          </div>
          <div className="bc-modal-step-arrow">↓</div>
          <label className={`bc-modal-step bc-modal-step--toggle${homeFirst ? '' : ' is-disabled'}`}>
            <input type="checkbox" className="bc-modal-checkbox" checked={homeFirst} onChange={(e) => setHomeFirst(e.target.checked)} />
            <Home size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">Home all axes</span>
              <span className="bc-modal-step-cmd">G28</span>
            </div>
          </label>
          <div className="bc-modal-step-arrow">↓</div>
          <label className={`bc-modal-step bc-modal-step--toggle${calibrateZDatum ? '' : ' is-disabled'}`}>
            <input type="checkbox" className="bc-modal-checkbox" checked={calibrateZDatum} onChange={(e) => setCalibrateZDatum(e.target.checked)} />
            <Crosshair size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">
                Calibrate Z datum
                {suggestDatum && <span className="bc-modal-step-badge bc-modal-step-badge--warn">Recommended</span>}
              </span>
              <span className="bc-modal-step-cmd">G30 S-1</span>
            </div>
          </label>
          {suggestDatum && calibrateZDatum && (
            <div className="bc-modal-datum-hint">
              Last mesh mean was {lastMapMean! > 0 ? '+' : ''}{lastMapMean!.toFixed(3)} mm — Z probe trigger height may be off.
              G30 S-1 re-establishes Z=0 before probing.
            </div>
          )}
          <div className="bc-modal-step-arrow">↓</div>
          <div className="bc-modal-step">
            <ScanLine size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">Probe bed mesh</span>
              <span className="bc-modal-step-cmd">G29</span>
            </div>
          </div>
        </div>

        {isRRF && (
          <div className="bc-modal-probe-dives-group">
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="hm-probes-per-point">Per point</label>
              <input
                id="hm-probes-per-point"
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
                <label className="bc-modal-repeat-label" htmlFor="hm-probe-tolerance">Tolerance</label>
                <input
                  id="hm-probe-tolerance"
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
        )}

        <div className="bc-modal-mode-row">
          <span className="bc-modal-mode-label">Mode</span>
          <div className="bc-modal-mode-toggle">
            <button type="button" className={`bc-modal-mode-btn${mode === 'fixed' ? ' is-active' : ''}`} onClick={() => setMode('fixed')}>Fixed passes</button>
            <button type="button" className={`bc-modal-mode-btn${mode === 'converge' ? ' is-active' : ''}`} onClick={() => setMode('converge')}>Auto-converge</button>
          </div>
        </div>
        {mode === 'fixed' ? (
          <div className="bc-modal-repeat-row">
            <label className="bc-modal-repeat-label" htmlFor="hm-probe-passes">Passes</label>
            <input
              id="hm-probe-passes"
              type="number"
              className="bc-modal-num-input"
              min={1}
              max={10}
              value={passes}
              onChange={(e) => setPasses(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
            <span className="bc-modal-repeat-hint">{passes === 1 ? 'mesh pass' : 'mesh passes'}</span>
          </div>
        ) : (
          <div className="bc-modal-auto-fields">
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="hm-probe-maxpasses">Max passes</label>
              <input
                id="hm-probe-maxpasses"
                type="number"
                className="bc-modal-num-input"
                min={2}
                max={10}
                value={maxPasses}
                onChange={(e) => setMaxPasses(Math.max(2, Math.min(10, Number(e.target.value) || 2)))}
              />
              <span className="bc-modal-repeat-hint">safety cap</span>
            </div>
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="hm-probe-target">Target</label>
              <input
                id="hm-probe-target"
                type="number"
                className="bc-modal-num-input"
                min={0.005}
                max={0.5}
                step={0.005}
                value={targetDiff}
                onChange={(e) => setTargetDiff(Math.max(0.005, Math.min(0.5, Number(e.target.value) || 0.005)))}
              />
              <span className="bc-modal-repeat-hint">mm RMS change</span>
            </div>
            <p className="bc-modal-auto-hint">Repeats until mesh RMS shift is below target or max passes is reached.</p>
          </div>
        )}

        <ul className="bc-modal-checklist">
          <li>Bed is clear of all objects and clips</li>
          <li>Nozzle is clean — no filament blobs</li>
          <li>Bed is at print temperature (if using thermal expansion)</li>
        </ul>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
        <button className="bc-modal-btn bc-modal-btn--confirm" onClick={handleConfirm} autoFocus>
          <Crosshair size={13} />
          {homeFirst && calibrateZDatum
            ? (mode === 'converge' ? 'Home, Datum & Auto-Probe' : passes > 1 ? `Home, Datum & Probe x${passes}` : 'Home, Datum & Probe')
            : homeFirst
              ? (mode === 'converge' ? 'Home & Auto-Probe' : passes > 1 ? `Home & Probe x${passes}` : 'Home & Probe')
              : calibrateZDatum
                ? (mode === 'converge' ? 'Datum & Auto-Probe' : passes > 1 ? `Datum & Probe x${passes}` : 'Datum & Probe')
                : (mode === 'converge' ? 'Auto-Probe' : passes > 1 ? `Probe x${passes}` : 'Probe')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

import { useCallback, useState } from 'react';
import { Home, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../../ui/Modal';
import type { LevelBedOpts } from '../../../../../store/printerStore';

export function LevelBedModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (opts: LevelBedOpts) => void;
  onCancel: () => void;
}) {
  const [homeFirst, setHomeFirst] = useState(false);
  const [repeat, setRepeat] = useState(1);
  const [autoConverge, setAutoConverge] = useState(false);
  const [maxPasses, setMaxPasses] = useState(5);
  const [targetDeviation, setTargetDeviation] = useState(0.05);

  const handleConfirm = useCallback(() => {
    onConfirm({
      homeFirst,
      autoConverge,
      ...(autoConverge ? { maxPasses, targetDeviation } : { repeat }),
    });
  }, [autoConverge, homeFirst, maxPasses, onConfirm, repeat, targetDeviation]);

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title="Level Bed - G32"
      titleIcon={<TriangleAlert size={15} className="bc-modal-warn-icon" />}
      ariaLabelledBy="bc-level-modal-title"
      closeButtonTitle="Cancel"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          Runs <code>bed_tilt.g</code> to tilt-correct the bed using independent Z motors.
          Use fixed passes for manual control or auto-converge to verify the result.
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
        <div className="bc-modal-mode-row">
          <span className="bc-modal-mode-label">Mode</span>
          <div className="bc-modal-mode-toggle">
            <button type="button" className={`bc-modal-mode-btn${!autoConverge ? ' is-active' : ''}`} onClick={() => setAutoConverge(false)}>Fixed passes</button>
            <button type="button" className={`bc-modal-mode-btn${autoConverge ? ' is-active' : ''}`} onClick={() => setAutoConverge(true)}>Auto-converge</button>
          </div>
        </div>
        {!autoConverge ? (
          <div className="bc-modal-repeat-row">
            <label className="bc-modal-repeat-label" htmlFor="bc-level-repeat">Passes</label>
            <input id="bc-level-repeat" type="number" className="bc-modal-num-input" min={1} max={10} value={repeat}
              onChange={(e) => setRepeat(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            <span className="bc-modal-repeat-hint">{repeat === 1 ? 'tilt-correction pass' : 'tilt-correction passes'}</span>
          </div>
        ) : (
          <div className="bc-modal-auto-fields">
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="bc-level-maxpasses">Max passes</label>
              <input id="bc-level-maxpasses" type="number" className="bc-modal-num-input" min={2} max={10} value={maxPasses}
                onChange={(e) => setMaxPasses(Math.max(2, Math.min(10, Number(e.target.value) || 2)))} />
              <span className="bc-modal-repeat-hint">safety cap</span>
            </div>
            <div className="bc-modal-repeat-row">
              <label className="bc-modal-repeat-label" htmlFor="bc-level-target">Target</label>
              <input id="bc-level-target" type="number" className="bc-modal-num-input" min={0.01} max={0.5} step={0.01} value={targetDeviation}
                onChange={(e) => setTargetDeviation(Math.max(0.01, Math.min(0.5, Number(e.target.value) || 0.01)))} />
              <span className="bc-modal-repeat-hint">mm deviation</span>
            </div>
            <p className="bc-modal-auto-hint">Always runs at least two passes so the second pass verifies the correction.</p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
        <button className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level" onClick={handleConfirm} autoFocus>
          <Home size={13} />
          {homeFirst
            ? (autoConverge ? 'Home & Auto-Level' : `Home & Level${repeat > 1 ? ` x${repeat}` : ''}`)
            : (autoConverge ? 'Auto-Level' : repeat > 1 ? `Level x${repeat}` : 'Level Bed')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

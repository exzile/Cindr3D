import { useCallback, useState } from 'react';
import { Crosshair, Grid3x3, Home, Lock, LockOpen, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../../ui/Modal';
import type { PrinterBoardType } from '../../../../../types/duet';
import type { ProbeOpts } from '../types';

export function ProbeConfirmModal({
  onConfirm,
  onCancel,
  m557Command,
  gridLabel,
  spacingLabel,
  probeXMin,
  probeXMax,
  probeYMin,
  probeYMax,
  probePoints,
  probeGridLocked,
  probeFromConfig,
  probeGridUnlocked,
  configM557Line,
  boardType,
  xMinLimit,
  yMinLimit,
  onProbeXMinChange,
  onProbeXMaxChange,
  onProbeYMinChange,
  onProbeYMaxChange,
  onProbePointsChange,
  onToggleProbeGridLock,
}: {
  onConfirm: (opts: ProbeOpts) => void;
  onCancel: () => void;
  m557Command: string;
  gridLabel: string;
  spacingLabel: string;
  probeXMin: number;
  probeXMax: number;
  probeYMin: number;
  probeYMax: number;
  probePoints: number;
  probeGridLocked: boolean;
  probeFromConfig: boolean;
  probeGridUnlocked: boolean;
  configM557Line: string | null;
  boardType: PrinterBoardType | undefined;
  xMinLimit: number;
  yMinLimit: number;
  onProbeXMinChange: (value: number) => void;
  onProbeXMaxChange: (value: number) => void;
  onProbeYMinChange: (value: number) => void;
  onProbeYMaxChange: (value: number) => void;
  onProbePointsChange: (value: number) => void;
  onToggleProbeGridLock: () => void;
}) {
  const [homeFirst, setHomeFirst] = useState(true);
  const [probesPerPoint, setProbesPerPoint] = useState(1);
  const [mode, setMode] = useState<'fixed' | 'converge'>('fixed');
  const [passes, setPasses] = useState(1);
  const [maxPasses, setMaxPasses] = useState(5);
  const [targetDiff, setTargetDiff] = useState(0.02);
  const isRRF = !boardType || boardType === 'duet';

  const handleConfirm = useCallback(
    () => onConfirm({ homeFirst, probesPerPoint, mode, passes, maxPasses, targetDiff }),
    [homeFirst, probesPerPoint, mode, passes, maxPasses, targetDiff, onConfirm],
  );

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title={`Probe Bed Mesh - ${gridLabel}`}
      titleIcon={<TriangleAlert size={15} className="bc-modal-warn-icon" />}
      ariaLabelledBy="bc-modal-title"
      closeButtonTitle="Cancel"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          This will move the toolhead across the bed to measure surface deviation.
          Make sure the bed is clear before continuing. Probe spacing is approximately {spacingLabel}.
        </p>

        <div className="bc-grid-card bc-grid-card--modal">
          <div className="bc-grid-head">
            <span><Ruler size={11} /> Probe Grid</span>
            {probeFromConfig && (
              <button
                type="button"
                className={`bc-grid-lock${probeGridUnlocked ? ' is-unlocked' : ''}`}
                onClick={onToggleProbeGridLock}
                title={probeGridUnlocked ? 'Use config.g values again' : 'Unlock to override config.g values'}
              >
                {probeGridUnlocked ? <LockOpen size={11} /> : <Lock size={11} />}
                config.g
              </button>
            )}
          </div>
          <div className="bc-grid-ranges">
            <span className="bc-axis bc-axis--x">X</span>
            <input type="number" value={probeXMin} disabled={probeGridLocked} onChange={(e) => onProbeXMinChange(Number(e.target.value))} />
            <span className="bc-grid-sep">-</span>
            <input type="number" value={probeXMax} disabled={probeGridLocked} onChange={(e) => onProbeXMaxChange(Number(e.target.value))} />
            <span className="bc-axis bc-axis--y">Y</span>
            <input type="number" value={probeYMin} disabled={probeGridLocked} onChange={(e) => onProbeYMinChange(Number(e.target.value))} />
            <span className="bc-grid-sep">-</span>
            <input type="number" value={probeYMax} disabled={probeGridLocked} onChange={(e) => onProbeYMaxChange(Number(e.target.value))} />
          </div>
          {(xMinLimit > 0 || yMinLimit > 0) && (
            <div className="bc-grid-probe-offset-hint">
              <span>
                Probe offset margin
                {xMinLimit > 0 ? ` · X≥${xMinLimit}` : ''}
                {yMinLimit > 0 ? ` · Y≥${yMinLimit}` : ''}
              </span>
              <button
                type="button"
                className="bc-grid-offset-apply"
                disabled={probeGridLocked}
                title="Set X min and Y min to the safe probe offset margins"
                onClick={() => {
                  if (xMinLimit > 0) onProbeXMinChange(xMinLimit);
                  if (yMinLimit > 0) onProbeYMinChange(yMinLimit);
                }}
              >
                Apply
              </button>
            </div>
          )}
          <div className="bc-grid-points-row">
            <select value={probePoints} disabled={probeGridLocked} onChange={(e) => onProbePointsChange(Number(e.target.value))}>
              {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => <option key={n} value={n}>{n}x{n} ({n * n} pts)</option>)}
            </select>
            <span title="Approximate spacing between probe points">~{spacingLabel}</span>
          </div>
          {configM557Line && probeFromConfig && (
            <code className="bc-grid-source" title="Exact M557 line read from config.g">{configM557Line}</code>
          )}
          <code className="bc-grid-command" title="This command is sent before probing">{m557Command}</code>
        </div>

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
            <input
              type="checkbox"
              className="bc-modal-checkbox"
              checked={homeFirst}
              onChange={(e) => setHomeFirst(e.target.checked)}
            />
            <Home size={12} className="bc-modal-step-icon" />
            <div>
              <span className="bc-modal-step-label">Home all axes</span>
              <span className="bc-modal-step-cmd">G28</span>
            </div>
          </label>
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
          <div className="bc-modal-repeat-row">
            <label className="bc-modal-repeat-label" htmlFor="bc-probes-per-point">Per point</label>
            <input
              id="bc-probes-per-point"
              type="number"
              className="bc-modal-num-input"
              min={1}
              max={5}
              value={probesPerPoint}
              onChange={(e) => setProbesPerPoint(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            />
            <span className="bc-modal-repeat-hint">
              {probesPerPoint === 1 ? 'probe dive' : 'probe dives'} · M558 A{probesPerPoint}
            </span>
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
            <label className="bc-modal-repeat-label" htmlFor="bc-probe-passes">Passes</label>
            <input
              id="bc-probe-passes"
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
              <label className="bc-modal-repeat-label" htmlFor="bc-probe-maxpasses">Max passes</label>
              <input
                id="bc-probe-maxpasses"
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
              <label className="bc-modal-repeat-label" htmlFor="bc-probe-target">Target</label>
              <input
                id="bc-probe-target"
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
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>
          Cancel
        </button>
        <button className="bc-modal-btn bc-modal-btn--confirm" onClick={handleConfirm} autoFocus>
          <Crosshair size={13} />
          {homeFirst
            ? (mode === 'converge' ? 'Home & Auto-Probe' : passes > 1 ? `Home & Probe x${passes}` : 'Home & Probe')
            : (mode === 'converge' ? 'Auto-Probe' : passes > 1 ? `Probe x${passes}` : 'Probe')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

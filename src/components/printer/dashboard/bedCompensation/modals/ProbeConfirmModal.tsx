import { useCallback, useState } from 'react';
import { Crosshair, Grid3x3, Home, Lock, LockOpen, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../../ui/Modal';
import type { PrinterBoardType } from '../../../../../types/duet';
import type { ProbeOpts } from '../../../heightMap/types';

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
  xMinLimit,
  yMinLimit,
  onProbeXMinChange,
  onProbeXMaxChange,
  onProbeYMinChange,
  onProbeYMaxChange,
  onProbePointsChange,
  onToggleProbeGridLock,
  boardType,
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
  xMinLimit: number;
  yMinLimit: number;
  onProbeXMinChange: (v: number) => void;
  onProbeXMaxChange: (v: number) => void;
  onProbeYMinChange: (v: number) => void;
  onProbeYMaxChange: (v: number) => void;
  onProbePointsChange: (v: number) => void;
  onToggleProbeGridLock: () => void;
  boardType: PrinterBoardType | undefined;
}) {
  const isRRF = !boardType || boardType === 'duet';
  const [homeFirst, setHomeFirst] = useState(true);
  const [probesPerPoint, setProbesPerPoint] = useState(1);
  const [mode, setMode] = useState<'fixed' | 'converge'>('fixed');
  const [passes, setPasses] = useState(1);
  const [maxPasses, setMaxPasses] = useState(4);
  const [targetDiff, setTargetDiff] = useState(0.02);

  const handleConfirm = useCallback(() => {
    onConfirm({
      homeFirst,
      probesPerPoint: isRRF ? probesPerPoint : 1,
      mode,
      passes,
      maxPasses,
      targetDiff,
    });
  }, [onConfirm, homeFirst, isRRF, probesPerPoint, mode, passes, maxPasses, targetDiff]);

  return (
    <Modal
      onClose={onCancel}
      onEnter={handleConfirm}
      title="Probe Bed"
      titleIcon={<ScanLine size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      size="wide"
      ariaLabelledBy="bc-probe-confirm-title"
    >
      <ModalBody>
        {probeFromConfig && (
          <div className="bc-config-pill" title={configM557Line ? `Loaded from config.g: ${configM557Line}` : 'Probe grid loaded from M557 in config.g'}>
            <Lock size={11} />
            <span>Probe grid loaded from <code>config.g</code></span>
            <button
              type="button"
              className={`bc-config-pill__lock${probeGridUnlocked ? ' is-unlocked' : ''}`}
              onClick={onToggleProbeGridLock}
              title={probeGridUnlocked ? 'Re-lock — restores config.g values' : 'Unlock — override for this session only'}
            >
              {probeGridUnlocked ? <LockOpen size={11} /> : <Lock size={11} />}
            </button>
          </div>
        )}

        <div className="bc-card">
          <div className="bc-card-title"><Ruler size={11} /> Probe grid</div>
          <div className="bc-grid-row">
            <span className="bc-axis-label bc-axis-label--x">X</span>
            <label className="bc-field">
              <span className="bc-field-label">Min</span>
              <input
                type="number"
                className={`bc-input${probeGridLocked ? ' is-locked' : ''}`}
                value={probeXMin}
                min={xMinLimit}
                max={probeXMax - 1}
                disabled={probeGridLocked}
                onChange={(e) => onProbeXMinChange(Number(e.target.value))}
              />
            </label>
            <span className="bc-field-sep">→</span>
            <label className="bc-field">
              <span className="bc-field-label">Max</span>
              <input
                type="number"
                className={`bc-input${probeGridLocked ? ' is-locked' : ''}`}
                value={probeXMax}
                min={probeXMin + 1}
                disabled={probeGridLocked}
                onChange={(e) => onProbeXMaxChange(Number(e.target.value))}
              />
            </label>
            <span className="bc-field-unit">mm</span>
          </div>
          <div className="bc-grid-row">
            <span className="bc-axis-label bc-axis-label--y">Y</span>
            <label className="bc-field">
              <span className="bc-field-label">Min</span>
              <input
                type="number"
                className={`bc-input${probeGridLocked ? ' is-locked' : ''}`}
                value={probeYMin}
                min={yMinLimit}
                max={probeYMax - 1}
                disabled={probeGridLocked}
                onChange={(e) => onProbeYMinChange(Number(e.target.value))}
              />
            </label>
            <span className="bc-field-sep">→</span>
            <label className="bc-field">
              <span className="bc-field-label">Max</span>
              <input
                type="number"
                className={`bc-input${probeGridLocked ? ' is-locked' : ''}`}
                value={probeYMax}
                min={probeYMin + 1}
                disabled={probeGridLocked}
                onChange={(e) => onProbeYMaxChange(Number(e.target.value))}
              />
            </label>
            <span className="bc-field-unit">mm</span>
          </div>
          <div className="bc-grid-density-row">
            <span className="bc-grid-density-label"><Grid3x3 size={10} /> Density</span>
            <select
              className="bc-select"
              value={probePoints}
              disabled={probeGridLocked}
              onChange={(e) => onProbePointsChange(Number(e.target.value))}
            >
              {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <option key={n} value={n}>{n}×{n}</option>
              ))}
            </select>
            <span className="bc-grid-density-pts">{probePoints * probePoints} pts</span>
            <span className="bc-grid-density-sep">·</span>
            <span className="bc-grid-density-spacing">~{spacingLabel}</span>
          </div>
          <code className="bc-m557-preview" title={`Will be sent: ${m557Command}`}>{m557Command}</code>
        </div>

        <div className="bc-card">
          <div className="bc-card-title"><Home size={11} /> Behaviour</div>
          <label className="bc-checkbox">
            <input type="checkbox" checked={homeFirst} onChange={(e) => setHomeFirst(e.target.checked)} />
            <span>Home all axes first (G28)</span>
          </label>
          {isRRF && (
            <label className="bc-field bc-field--inline">
              <span className="bc-field-label">Probes per point</span>
              <select
                className="bc-select bc-select--narrow"
                value={probesPerPoint}
                onChange={(e) => setProbesPerPoint(Number(e.target.value))}
                title="M558 A — number of probes averaged per point"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="bc-field-hint">M558 A{probesPerPoint}</span>
            </label>
          )}
        </div>

        <div className="bc-card">
          <div className="bc-card-title"><Crosshair size={11} /> Repeat</div>
          <div className="bc-mode-toggle" role="tablist">
            <button
              type="button"
              className={mode === 'fixed' ? 'is-active' : ''}
              onClick={() => setMode('fixed')}
            >
              Fixed passes
            </button>
            <button
              type="button"
              className={mode === 'converge' ? 'is-active' : ''}
              onClick={() => setMode('converge')}
            >
              Until converged
            </button>
          </div>
          {mode === 'fixed' ? (
            <label className="bc-field bc-field--inline">
              <span className="bc-field-label">Passes</span>
              <input
                type="number"
                className="bc-input bc-input--narrow"
                value={passes}
                min={1}
                max={10}
                onChange={(e) => setPasses(Math.max(1, Math.min(10, Number(e.target.value))))}
              />
            </label>
          ) : (
            <>
              <label className="bc-field bc-field--inline">
                <span className="bc-field-label">Max passes</span>
                <input
                  type="number"
                  className="bc-input bc-input--narrow"
                  value={maxPasses}
                  min={2}
                  max={10}
                  onChange={(e) => setMaxPasses(Math.max(2, Math.min(10, Number(e.target.value))))}
                />
              </label>
              <label className="bc-field bc-field--inline">
                <span className="bc-field-label">Target RMS Δ (mm)</span>
                <input
                  type="number"
                  className="bc-input bc-input--narrow"
                  value={targetDiff}
                  min={0.001}
                  max={1}
                  step={0.001}
                  onChange={(e) => setTargetDiff(Math.max(0.001, Number(e.target.value)))}
                />
              </label>
              <p className="bc-card-hint">
                <TriangleAlert size={10} /> Stops when consecutive probe passes differ by less than this.
              </p>
            </>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--secondary" onClick={onCancel}>Cancel</button>
        <button className="bc-modal-btn bc-modal-btn--primary" onClick={handleConfirm}>
          <Crosshair size={12} /> Probe
        </button>
      </ModalFooter>
    </Modal>
  );
}

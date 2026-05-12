import { CheckCircle, RefreshCcw, ScanLine, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../../ui/Modal';
import type { HeightMapStats } from '../../../heightMap/utils';

export function ProbeResultsModal({
  stats,
  passes,
  onClose,
  onRunAgain,
}: {
  stats: HeightMapStats | null;
  passes: number;
  onClose: () => void;
  onRunAgain: () => void;
}) {
  const isGood = stats != null && stats.rms <= 0.1;
  const isWarn = stats != null && stats.rms > 0.1 && stats.rms <= 0.2;

  return (
    <Modal
      onClose={onClose}
      title="Probe Results"
      titleIcon={stats == null
        ? <TriangleAlert size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
        : <ScanLine size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      trailingHeader={passes > 1 ? <span className="bc-results-pass-badge">{passes} passes</span> : undefined}
      size="wide"
      ariaLabelledBy="bc-probe-results-title"
    >
      <ModalBody>
        {stats == null ? (
          <div className="bc-results-empty">
            <TriangleAlert size={22} style={{ color: '#f59e0b' }} />
            <div>
              <p className="bc-results-empty-title">No height map data available</p>
              <p className="bc-results-empty-sub">
                The probe sequence ran but the firmware did not return a valid height map.
                Check that all grid points are within the probe&apos;s reach and retry.
              </p>
            </div>
          </div>
        ) : (
          <div className="bc-results-content">
            <div className="bc-probe-result-save">
              <CheckCircle size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
              <span>Height map saved to <code>0:/sys/heightmap.csv</code></span>
            </div>

            <div className="bc-probe-result-grid">
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">Points probed</span>
                <span className="bc-probe-result-val">{stats.probePoints}</span>
              </div>
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">Grid</span>
                <span className="bc-probe-result-val">{stats.gridDimensions}</span>
              </div>
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">Min error</span>
                <span className={`bc-probe-result-val bc-probe-result-val--mono${stats.min < -0.2 ? ' is-bad' : stats.min < -0.1 ? ' is-warn' : ''}`}>
                  {stats.min.toFixed(3)} mm
                </span>
              </div>
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">Max error</span>
                <span className={`bc-probe-result-val bc-probe-result-val--mono${stats.max > 0.2 ? ' is-bad' : stats.max > 0.1 ? ' is-warn' : ''}`}>
                  {stats.max >= 0 ? '+' : ''}{stats.max.toFixed(3)} mm
                </span>
              </div>
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">Mean</span>
                <span className="bc-probe-result-val bc-probe-result-val--mono">
                  {stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)} mm
                </span>
              </div>
              <div className="bc-probe-result-stat">
                <span className="bc-probe-result-label">RMS deviation</span>
                <span className={`bc-probe-result-val bc-probe-result-val--mono${isGood ? ' is-good' : isWarn ? ' is-warn' : ' is-bad'}`}>
                  {stats.rms.toFixed(3)} mm
                </span>
              </div>
            </div>

            <div className={`bc-results-summary${isGood ? ' is-good' : isWarn ? ' is-warn' : ' is-bad'}`}>
              <div className="bc-results-summary-row">
                <span className="bc-results-summary-label">RMS deviation</span>
                <span className="bc-results-summary-val">{stats.rms.toFixed(3)} mm</span>
                <span className="bc-results-summary-verdict">
                  {isGood ? '✓ Excellent — bed surface is flat'
                    : isWarn ? '⚠ Acceptable — mesh compensation will correct this'
                    : '✕ High deviation — check bed leveling screws'}
                </span>
              </div>
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--secondary" onClick={onRunAgain}>
          <RefreshCcw size={12} /> Run Again
        </button>
        <button className="bc-modal-btn bc-modal-btn--primary" onClick={onClose}>
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}

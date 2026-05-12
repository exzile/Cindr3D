import { BarChart3, CheckCircle, FilePlus, RotateCcw, TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../../ui/Modal';
import type { LevelBedSummary } from '../../../../store/printerStore';

export function LevelBedResultsModal({
  summary,
  onClose,
  onRunAgain,
  onEditBedTilt,
}: {
  summary: LevelBedSummary;
  onClose: () => void;
  onRunAgain: () => void;
  onEditBedTilt?: () => void;
}) {
  const { results, autoConverge, stopReason, targetDeviation } = summary;

  const allEmpty = results.length > 0 && results.every(
    (r) => r.deviationBefore == null && r.deviationAfter == null,
  );

  const last      = results[results.length - 1];
  const firstDev  = results[0]?.deviationBefore;

  // The firmware's deviationAfter is a projection, not a re-measurement.
  // The best *verified* number we have is the last pass's deviationBefore
  // (the real probe result of the previous pass's corrections).
  const isMultiPass    = results.length >= 2;
  const finalDev       = isMultiPass ? last?.deviationBefore : last?.deviationAfter;
  const finalDevLabel  = isMultiPass ? 'verified' : 'projected';

  const totalImprovement = (firstDev != null && finalDev != null && firstDev > 0)
    ? ((firstDev - finalDev) / firstDev * 100)
    : null;
  const isGood = finalDev != null && finalDev <= 0.05;
  const isWarn = finalDev != null && finalDev > 0.05 && finalDev <= 0.1;
  const isBad  = finalDev != null && finalDev > 0.1;

  return (
    <Modal
      onClose={onClose}
      title="Level Bed Results"
      titleIcon={allEmpty
        ? <TriangleAlert size={15} className="bc-modal-warn-icon" />
        : <BarChart3 size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
      trailingHeader={results.length > 1
        ? <span className="bc-results-pass-badge">{results.length} passes</span>
        : undefined}
      size="wide"
      ariaLabelledBy="hm-results-modal-title"
    >
      <ModalBody>
        {/* ── Auto-converge stop-reason banner ── */}
        {autoConverge && !allEmpty && (
          <div className={`bc-results-converge bc-results-converge--${stopReason}`}>
            {stopReason === 'target' && (
              <>
                <CheckCircle size={13} />
                <span>
                  Target reached in {results.length} passes —
                  verified deviation{' '}
                  <strong>{finalDev != null ? `${finalDev.toFixed(3)} mm` : '—'}</strong>{' '}
                  is below the {targetDeviation.toFixed(3)} mm target
                </span>
              </>
            )}
            {stopReason === 'plateaued' && (
              <>
                <RotateCcw size={13} />
                <span>
                  Plateaued after {results.length} {results.length === 1 ? 'pass' : 'passes'} —
                  each additional pass yielded &lt;15% improvement; this is the best achievable result
                </span>
              </>
            )}
            {stopReason === 'maxPasses' && (
              <>
                <TriangleAlert size={13} />
                <span>
                  Max passes reached ({results.length}) without hitting target — deviation is still{' '}
                  <strong>{finalDev != null ? `${finalDev.toFixed(3)} mm` : 'unknown'}</strong>.
                  Check <code>M671</code> leadscrew positions.
                </span>
              </>
            )}
          </div>
        )}

        {allEmpty ? (
          /* ── No data received ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="bc-results-empty">
              <TriangleAlert size={22} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div>
                <p className="bc-results-empty-title">No tilt-correction data parsed</p>
                <p className="bc-results-empty-sub">
                  The firmware reply didn't contain recognisable deviation values.
                  {results[0]?.reply
                    ? ' Check the raw output below for clues.'
                    : <> The reply was empty — verify <code>M671</code> is in <code>config.g</code> and <code>bed_tilt.g</code> has active (uncommented) <code>G30</code> commands.</>}
                </p>
                {onEditBedTilt && (
                  <button
                    className="bc-modal-btn bc-modal-btn--secondary"
                    style={{ marginTop: 8 }}
                    onClick={onEditBedTilt}
                  >
                    <FilePlus size={12} /> Edit bed_tilt.g
                  </button>
                )}
              </div>
            </div>
            {/* Raw firmware reply — always shown when parsing fails */}
            <div className="bc-setup-code-wrap">
              <pre className="bc-setup-code" style={{ minHeight: 40, color: results[0]?.reply ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {results[0]?.reply || '(no output captured — firmware reply was empty)'}
              </pre>
            </div>
          </div>
        ) : (
          <>
            {/* ── Per-run table ── */}
            <div className="bc-results-table-wrap">
              <table className="bc-results-table">
                <thead>
                  <tr>
                    <th>Pass</th>
                    <th title="Real probe measurement at the start of each pass">Measured</th>
                    <th title="Improvement from previous pass's real measurement">Δ</th>
                    <th>Adjustments (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, idx) => {
                    const prev    = results[idx - 1];
                    const hasPrev = idx > 0 && prev?.deviationBefore != null && r.deviationBefore != null && prev.deviationBefore > 0;
                    const absImp  = hasPrev ? (prev!.deviationBefore! - r.deviationBefore!) : null;
                    const imp     = hasPrev ? (absImp! / prev!.deviationBefore! * 100) : null;

                    const devVal  = r.deviationBefore;
                    const devGood = devVal != null && devVal <= 0.05;
                    const devWarn = devVal != null && devVal > 0.05 && devVal <= 0.1;
                    const devBad  = devVal != null && devVal > 0.1;

                    return (
                      <tr key={r.run}>
                        <td className="bc-results-run">{r.run}</td>
                        <td className={`bc-results-num${devGood ? ' is-good' : devWarn ? ' is-warn' : devBad ? ' is-bad' : ''}`}>
                          {devVal != null ? `${devVal.toFixed(3)} mm` : '—'}
                        </td>
                        <td className={`bc-results-imp${imp != null && imp > 0 ? ' is-positive' : ''}`}>
                          {imp != null ? (
                            <>
                              <span className="bc-results-imp-pct">−{imp.toFixed(0)}%</span>
                              <span className="bc-results-imp-abs">{absImp! < 0 ? '+' : '−'}{Math.abs(absImp!).toFixed(3)} mm</span>
                            </>
                          ) : '—'}
                        </td>
                        <td className="bc-results-adj">
                          {r.adjustments.length > 0
                            ? r.adjustments.map((a, i) => (
                                <span
                                  key={i}
                                  className={`bc-results-adj-chip${Math.abs(a) < 0.01 ? ' is-zero' : ''}`}
                                >
                                  {a >= 0 ? '+' : ''}{a.toFixed(3)}
                                </span>
                              ))
                            : <span className="bc-results-adj-none">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Summary card ── */}
            {last && (
              <div className={`bc-results-summary${isGood ? ' is-good' : isWarn ? ' is-warn' : isBad ? ' is-bad' : ''}`}>
                <div className="bc-results-summary-row">
                  <span className="bc-results-summary-label">
                    Final deviation
                    <span className="bc-results-summary-label-note"> ({finalDevLabel})</span>
                  </span>
                  <span className="bc-results-summary-val">
                    {finalDev != null ? `${finalDev.toFixed(3)} mm` : 'unknown'}
                  </span>
                  <span className="bc-results-summary-verdict">
                    {isGood ? '✓ Excellent — bed is level'
                      : isWarn ? '⚠ Acceptable — consider another pass'
                      : isBad  ? '✗ Run again for better results'
                      : ''}
                  </span>
                </div>
                {totalImprovement != null && firstDev != null && finalDev != null && (
                  <div className="bc-results-summary-sub">
                    {(() => {
                      const absTotal = firstDev - finalDev;
                      const suffix = isMultiPass ? 'verified' : 'projected';
                      const passText = results.length > 1 ? ` over ${results.length} passes` : '';
                      return `−${totalImprovement.toFixed(0)}%${passText} · ${firstDev.toFixed(3)} → ${finalDev.toFixed(3)} mm (−${absTotal.toFixed(3)} mm ${suffix})`;
                    })()}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onClose}>Close</button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level"
          onClick={onRunAgain}
        >
          <RotateCcw size={13} />
          {allEmpty ? 'Retry' : 'Run Again'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

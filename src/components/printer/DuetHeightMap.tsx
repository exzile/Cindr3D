import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import './DuetHeightMap.css';
import {
  RefreshCw, Crosshair, Loader2, BarChart3, Grid3x3, Download, Save,
  FolderOpen, GitCompareArrows, X, Map,
  Home, ScanLine, TriangleAlert, RotateCcw, Camera, Ruler, ChevronRight,
  Copy, CheckCircle, FilePlus, Lock, LockOpen,
} from 'lucide-react';
import type { DuetService } from '../../services/DuetService';
import { addToast } from '../../store/toastStore';
import type { LevelBedSummary } from '../../store/printerStore';
import { usePrinterStore } from '../../store/printerStore';
import {
  ColorScaleLegend, Heatmap2D, Scene3D, getBedQuality,
  CAMERA_POSITIONS, type CameraPreset, type ConfiguredProbeGrid, type BedBounds,
} from './heightMap/visualization';
import { computeDiffMap, computeStats, exportHeightMapCSV } from './heightMap/utils';
import type { DuetHeightMap as HeightMapData } from '../../types/duet';

/* ── bed_tilt.g content generator ──────────────────────────────────────────── */

const TILT_TEMPLATE = `\
; bed_tilt.g — tilt-correction only (no G29 / M374)
; TODO: Edit the G30 lines below to match your leadscrew positions.
; Refer to your M671 configuration in config.g for XY coordinates.
M561                             ; clear any active bed transform
G28                              ; home all axes
; G30 P0 X55  Y450 Z-99999      ; leadscrew 1
; G30 P1 X55  Y0   Z-99999      ; leadscrew 2
; G30 P2 X420 Y220 Z-99999 S3   ; leadscrew 3 — S3 triggers tilt correction`;

async function generateBedTiltContent(
  service: DuetService,
): Promise<{ content: string; derived: boolean }> {
  try {
    const blob = await service.downloadFile('0:/sys/bed.g');
    const text = await blob.text();

    // Strip G29 and M374 lines — those are for mesh probing, not tilt correction.
    const filtered = text
      .split('\n')
      .filter((line) => !/^\s*(G29|M374)\b/i.test(line))
      .join('\n')
      .trimEnd();

    // If bed.g has no G30 tilt lines it's not useful as a base.
    const hasTilt = /^\s*G30\b/im.test(filtered);
    if (!hasTilt) return { content: TILT_TEMPLATE, derived: false };

    const header = '; bed_tilt.g — derived from bed.g (G29 / M374 removed)\n';
    return { content: header + filtered, derived: true };
  } catch {
    return { content: TILT_TEMPLATE, derived: false };
  }
}

/* ── Bed-tilt setup modal ───────────────────────────────────────────────────── */

function BedTiltSetupModal({
  content,
  derived,
  creating,
  onCreateFile,
  onClose,
}: {
  content: string;
  derived: boolean;
  creating: boolean;
  onCreateFile: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch { /* ignore */ }
  }, [content]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="bc-modal-overlay" onClick={onClose}>
      <div
        className="bc-modal bc-modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hm-setup-modal-title"
      >
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <FilePlus size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />
            <span id="hm-setup-modal-title" className="bc-modal-title">
              bed_tilt.g — Setup Required
            </span>
          </div>
          <button className="bc-modal-close" onClick={onClose} title="Cancel"><X size={13} /></button>
        </div>

        <div className="bc-modal-body">
          <p className="bc-modal-desc">
            {derived
              ? <>
                  <strong>bed_tilt.g</strong> was not found on your printer. The content below
                  was derived from your <code>bed.g</code> with <code>G29</code> and{' '}
                  <code>M374</code> removed — click <em>Create File &amp; Continue</em> to
                  upload it automatically.
                </>
              : <>
                  <strong>bed_tilt.g</strong> was not found and <code>bed.g</code> could not
                  be read or contains no tilt-correction commands. Fill in the{' '}
                  <code>G30</code> coordinates below (matching your <code>M671</code> leadscrew
                  positions in <code>config.g</code>) and then create the file.
                </>}
          </p>

          <div className="bc-setup-code-wrap">
            <pre className="bc-setup-code">{content}</pre>
            <button
              className={`bc-setup-copy-btn${copied ? ' is-copied' : ''}`}
              onClick={() => void handleCopy()}
              title="Copy to clipboard"
            >
              {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onClose}>Cancel</button>
          <button
            className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level"
            onClick={onCreateFile}
            disabled={creating}
            autoFocus
          >
            {creating
              ? <Loader2 size={13} className="hm-spin" />
              : <FilePlus size={13} />}
            {creating
              ? 'Creating…'
              : derived ? 'Create File & Continue' : 'Create Template & Continue'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Level bed results modal ────────────────────────────────────────────────── */

function LevelBedResultsModal({
  summary,
  onClose,
  onRunAgain,
}: {
  summary: LevelBedSummary;
  onClose: () => void;
  onRunAgain: () => void;
}) {
  const { results, autoConverge, stopReason, targetDeviation } = summary;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allEmpty = results.length > 0 && results.every(
    (r) => r.deviationBefore == null && r.deviationAfter == null,
  );

  const last      = results[results.length - 1];
  const firstDev  = results[0]?.deviationBefore;

  // The firmware's deviationAfter is a projection, not a re-measurement.
  // The best *verified* number we have is the last pass's deviationBefore
  // (the real probe result of the previous pass's corrections).
  // For a single pass we have nothing to verify against, so we fall back to
  // the projected deviationAfter and flag it as unverified.
  const isMultiPass    = results.length >= 2;
  const finalDev       = isMultiPass ? last?.deviationBefore : last?.deviationAfter;
  const finalDevLabel  = isMultiPass ? 'verified' : 'projected';

  const totalImprovement = (firstDev != null && finalDev != null && firstDev > 0)
    ? ((firstDev - finalDev) / firstDev * 100)
    : null;
  const isGood = finalDev != null && finalDev <= 0.05;
  const isWarn = finalDev != null && finalDev > 0.05 && finalDev <= 0.1;
  const isBad  = finalDev != null && finalDev > 0.1;

  return createPortal(
    <div className="bc-modal-overlay" onClick={onClose}>
      <div
        className="bc-modal bc-modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hm-results-modal-title"
      >
        {/* Header */}
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            {allEmpty
              ? <TriangleAlert size={15} className="bc-modal-warn-icon" />
              : <BarChart3 size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
            <span id="hm-results-modal-title" className="bc-modal-title">
              Level Bed Results
            </span>
            {results.length > 1 && (
              <span className="bc-results-pass-badge">{results.length} passes</span>
            )}
          </div>
          <button className="bc-modal-close" onClick={onClose} title="Close"><X size={13} /></button>
        </div>

        <div className="bc-modal-body">
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
                    Check the raw output below — if it's empty, verify{' '}
                    <code>M671</code> is in <code>config.g</code> and{' '}
                    <code>bed_tilt.g</code> has your <code>G30</code> commands.
                  </p>
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
                      // Δ = measured improvement between passes (prev.before → this.before).
                      // Pass 1 has no prior measurement to compare, so shows "—".
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
        </div>

        {/* Footer */}
        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onClose}>Close</button>
          <button
            className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level"
            onClick={onRunAgain}
          >
            <RotateCcw size={13} />
            {allEmpty ? 'Retry' : 'Run Again'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Probe confirm modal ────────────────────────────────────────────────────── */

function ProbeConfirmModal({
  onConfirm, onCancel, m557Command, gridLabel,
}: {
  onConfirm: (homeFirst: boolean) => void;
  onCancel: () => void;
  m557Command: string;
  gridLabel: string;
}) {
  const [homeFirst, setHomeFirst] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm(homeFirst);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel, homeFirst]);

  return createPortal(
    <div className="bc-modal-overlay" onClick={onCancel}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="hm-probe-modal-title">
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <TriangleAlert size={15} className="bc-modal-warn-icon" />
            <span id="hm-probe-modal-title" className="bc-modal-title">Probe Bed Mesh — {gridLabel}</span>
          </div>
          <button className="bc-modal-close" onClick={onCancel} title="Cancel"><X size={13} /></button>
        </div>

        <div className="bc-modal-body">
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
            <div className="bc-modal-step">
              <ScanLine size={12} className="bc-modal-step-icon" />
              <div>
                <span className="bc-modal-step-label">Probe bed mesh</span>
                <span className="bc-modal-step-cmd">G29</span>
              </div>
            </div>
          </div>
          <ul className="bc-modal-checklist">
            <li>Bed is clear of all objects and clips</li>
            <li>Nozzle is clean — no filament blobs</li>
            <li>Bed is at print temperature (if using thermal expansion)</li>
          </ul>
        </div>

        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="bc-modal-btn bc-modal-btn--confirm" onClick={() => onConfirm(homeFirst)} autoFocus>
            <Crosshair size={13} />
            {homeFirst ? 'Home & Probe' : 'Probe'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Level bed modal ────────────────────────────────────────────────────────── */

function LevelBedModal({
  onConfirm, onCancel,
}: {
  onConfirm: (opts: import('../../store/printerStore').LevelBedOpts & { homeFirst: boolean }) => void;
  onCancel: () => void;
}) {
  const [homeFirst,       setHomeFirst]       = useState(false);
  const [repeat,          setRepeat]          = useState(1);
  const [autoConverge,    setAutoConverge]    = useState(false);
  const [maxPasses,       setMaxPasses]       = useState(5);
  const [targetDeviation, setTargetDeviation] = useState(0.05);

  const handleConfirm = () => onConfirm({
    homeFirst,
    autoConverge,
    ...(autoConverge
      ? { maxPasses, targetDeviation }
      : { repeat }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') handleConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onConfirm, onCancel, homeFirst, repeat, autoConverge, maxPasses, targetDeviation]);

  return createPortal(
    <div className="bc-modal-overlay" onClick={onCancel}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="hm-level-modal-title">
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <TriangleAlert size={15} className="bc-modal-warn-icon" />
            <span id="hm-level-modal-title" className="bc-modal-title">Level Bed — G32</span>
          </div>
          <button className="bc-modal-close" onClick={onCancel} title="Cancel"><X size={13} /></button>
        </div>

        <div className="bc-modal-body">
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
        </div>

        <div className="bc-modal-footer">
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
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Demo mesh ──────────────────────────────────────────────────────────────── */

const DEMO_HEIGHT_MAP: HeightMapData = {
  xMin: 0, xMax: 235, xSpacing: 29.375,
  yMin: 0, yMax: 235, ySpacing: 29.375,
  radius: -1,
  numX: 9, numY: 9,
  points: [
    [ 0.042,  0.033,  0.018,  0.004, -0.008, -0.016, -0.021, -0.014,  0.031],
    [ 0.035,  0.027,  0.011, -0.002, -0.019, -0.028, -0.038, -0.022,  0.014],
    [ 0.021,  0.012, -0.004, -0.018, -0.031, -0.039, -0.047, -0.030, -0.006],
    [ 0.008, -0.001, -0.013, -0.027, -0.039, -0.048, -0.055, -0.037, -0.013],
    [-0.003, -0.011, -0.023, -0.036, -0.048, -0.057, -0.062, -0.044, -0.018],
    [-0.008, -0.015, -0.026, -0.038, -0.049, -0.055, -0.057, -0.040, -0.014],
    [-0.005, -0.012, -0.021, -0.031, -0.037, -0.044, -0.051, -0.035, -0.011],
    [ 0.009,  0.002, -0.008, -0.015, -0.021, -0.028, -0.038, -0.024,  0.003],
    [ 0.023,  0.015,  0.004, -0.004, -0.015, -0.019, -0.026, -0.012,  0.016],
  ],
};

/* ── Sidebar preference persistence ────────────────────────────────────────── */

const HM_PREFS_KEY = 'designcad:heightmap-prefs';

interface HeightMapPrefs {
  viewMode:        '3d' | '2d';
  diverging:       boolean;
  sidebarOpen:     boolean;
  showProbePoints: boolean;
  probePointScale: number;
  selectedCsv:     string;
  // Probe grid values
  probeXMin:        number;
  probeXMax:        number;
  probeYMin:        number;
  probeYMax:        number;
  probePoints:      number;
  // Whether the user has explicitly unlocked the probe grid (overriding config.g)
  probeGridUnlocked: boolean;
}

const HM_PREFS_DEFAULTS: HeightMapPrefs = {
  viewMode:        '3d',
  diverging:       false,
  sidebarOpen:     true,
  showProbePoints: true,
  probePointScale: 1,
  selectedCsv:     '0:/sys/heightmap.csv',
  probeXMin:        0,
  probeXMax:        235,
  probeYMin:        0,
  probeYMax:        235,
  probePoints:      9,
  probeGridUnlocked: false,
};

function loadHeightMapPrefs(): HeightMapPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Partial<HeightMapPrefs>;
    return {
      viewMode:        raw.viewMode === '2d' ? '2d' : '3d',
      diverging:       raw.diverging       ?? HM_PREFS_DEFAULTS.diverging,
      sidebarOpen:     raw.sidebarOpen     ?? HM_PREFS_DEFAULTS.sidebarOpen,
      showProbePoints: raw.showProbePoints ?? HM_PREFS_DEFAULTS.showProbePoints,
      probePointScale: typeof raw.probePointScale === 'number'
        ? raw.probePointScale
        : HM_PREFS_DEFAULTS.probePointScale,
      selectedCsv: typeof raw.selectedCsv === 'string' && raw.selectedCsv
        ? raw.selectedCsv
        : HM_PREFS_DEFAULTS.selectedCsv,
      probeXMin:        typeof raw.probeXMin   === 'number' ? raw.probeXMin   : HM_PREFS_DEFAULTS.probeXMin,
      probeXMax:        typeof raw.probeXMax   === 'number' ? raw.probeXMax   : HM_PREFS_DEFAULTS.probeXMax,
      probeYMin:        typeof raw.probeYMin   === 'number' ? raw.probeYMin   : HM_PREFS_DEFAULTS.probeYMin,
      probeYMax:        typeof raw.probeYMax   === 'number' ? raw.probeYMax   : HM_PREFS_DEFAULTS.probeYMax,
      probePoints:      typeof raw.probePoints === 'number' ? raw.probePoints : HM_PREFS_DEFAULTS.probePoints,
      probeGridUnlocked: raw.probeGridUnlocked === true,
    };
  } catch {
    return { ...HM_PREFS_DEFAULTS };
  }
}

/**
 * Parse the last M557 command from a config.g text blob.
 * Supports both P (points-per-axis) and S (spacing-mm) variants.
 * Returns null if no valid M557 line is found.
 * Also returns `rawLine` — the original text of the M557 line — for display.
 */
function parseM557(configText: string): {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  numPoints: number;
  rawLine: string;
} | null {
  let result: ReturnType<typeof parseM557> = null;
  for (const raw of configText.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!/^M557\b/i.test(line)) continue;
    const xm = line.match(/X(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)/i);
    const ym = line.match(/Y(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)/i);
    if (!xm || !ym) continue;
    const xMin = parseFloat(xm[1]);
    const xMax = parseFloat(xm[2]);
    const yMin = parseFloat(ym[1]);
    const yMax = parseFloat(ym[2]);
    if (xMax <= xMin || yMax <= yMin) continue; // malformed
    const pm = line.match(/P(\d+(?:\.\d+)?)/i);
    const sm = line.match(/S(\d+(?:\.\d+)?)/i);
    let numPoints: number;
    if (pm) {
      numPoints = Math.max(2, Math.round(parseFloat(pm[1])));
    } else if (sm) {
      const spacing = parseFloat(sm[1]);
      const span = Math.max(xMax - xMin, yMax - yMin);
      numPoints = Math.max(2, Math.round(span / spacing) + 1);
    } else {
      numPoints = 9;
    }
    result = { xMin, xMax, yMin, yMax, numPoints, rawLine: raw.trim() };
    // keep looping — last M557 wins
  }
  return result;
}

/* ── Main component ─────────────────────────────────────────────────────────── */

export default function DuetHeightMap() {
  const heightMap     = usePrinterStore((s) => s.heightMap);
  const loadHeightMap = usePrinterStore((s) => s.loadHeightMap);
  const probeGrid     = usePrinterStore((s) => s.probeGrid);
  const levelBed      = usePrinterStore((s) => s.levelBed);
  const sendGCode     = usePrinterStore((s) => s.sendGCode);
  const service       = usePrinterStore((s) => s.service);
  const connected     = usePrinterStore((s) => s.connected);
  const compensationType = usePrinterStore((s) => s.model.move?.compensation?.type);
  const axes             = usePrinterStore((s) => s.model.move?.axes);

  const [loading, setLoading]               = useState(false);
  const [loadError, setLoadError]           = useState<string | null>(null);
  const [probing, setProbing]               = useState(false);
  const [leveling, setLeveling]             = useState(false);
  const [showProbeModal, setShowProbeModal]   = useState(false);
  const [showLevelModal, setShowLevelModal]   = useState(false);
  const [showSetupModal,    setShowSetupModal]    = useState(false);
  const [bedTiltContent,    setBedTiltContent]    = useState('');
  const [bedTiltDerived,    setBedTiltDerived]    = useState(false);
  const [creatingTiltFile,  setCreatingTiltFile]  = useState(false);
  const [showResultsModal,  setShowResultsModal]  = useState(false);
  const [levelSummary,      setLevelSummary]      = useState<LevelBedSummary | null>(null);
  const lastLevelOptsRef = useRef<import('../../store/printerStore').LevelBedOpts | null>(null);
  const [viewMode, setViewMode]             = useState<'3d' | '2d'>(() => loadHeightMapPrefs().viewMode);
  const [csvFiles, setCsvFiles]             = useState<string[]>([]);
  const [selectedCsv, setSelectedCsv]      = useState(() => loadHeightMapPrefs().selectedCsv);
  const [loadingCsvList, setLoadingCsvList] = useState(false);
  const [compareMode, setCompareMode]       = useState(false);
  const [compareCsv, setCompareCsv]         = useState('');
  const [compareMap, setCompareMap]         = useState<typeof heightMap | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Sidebar open/collapsed
  const [sidebarOpen, setSidebarOpen] = useState(() => loadHeightMapPrefs().sidebarOpen);

  // 3D camera / scene controls
  const [sceneKey, setSceneKey]     = useState(0);
  const [cameraPos, setCameraPos]   = useState<[number, number, number]>(CAMERA_POSITIONS.iso);
  const [diverging, setDiverging]   = useState(() => loadHeightMapPrefs().diverging);

  // Probe grid configuration — mirrors Duet M557 parameters
  const [probeXMin, setProbeXMin]       = useState(() => loadHeightMapPrefs().probeXMin);
  const [probeXMax, setProbeXMax]       = useState(() => loadHeightMapPrefs().probeXMax);
  const [probeYMin, setProbeYMin]       = useState(() => loadHeightMapPrefs().probeYMin);
  const [probeYMax, setProbeYMax]       = useState(() => loadHeightMapPrefs().probeYMax);
  const [probePoints, setProbePoints]   = useState(() => loadHeightMapPrefs().probePoints);

  // Probe point display
  const [showProbePoints, setShowProbePoints] = useState(() => loadHeightMapPrefs().showProbePoints);
  const [probePointScale, setProbePointScale] = useState(() => loadHeightMapPrefs().probePointScale);

  // Track whether M557 was loaded from config.g (drives the locked-UI state).
  const m557LoadedRef = useRef(false);
  const [probeFromConfig, setProbeFromConfig] = useState(false);
  // Raw M557 line from config.g — shown in the UI so users can see exactly what was loaded.
  const [configM557Line, setConfigM557Line] = useState<string | null>(null);
  // Whether the user has explicitly unlocked the probe grid to override config.g values.
  // Persisted in localStorage so unlock + custom values survive page refreshes.
  const [probeGridUnlocked, setProbeGridUnlocked] = useState(
    () => loadHeightMapPrefs().probeGridUnlocked,
  );
  // Ref so the async M557 effect can read the current unlock state without
  // capturing a stale closure (effect deps are only [connected, service]).
  const probeGridUnlockedRef = useRef(probeGridUnlocked);
  useEffect(() => { probeGridUnlockedRef.current = probeGridUnlocked; }, [probeGridUnlocked]);

  const probeGridLocked = probeFromConfig && !probeGridUnlocked;

  /* ── Load M557 probe grid from config.g on connect ── */
  useEffect(() => {
    if (!connected || !service) {
      // Allow re-read on next connect; preserve unlock/value state across disconnects.
      m557LoadedRef.current = false;
      setProbeFromConfig(false);
      setConfigM557Line(null);
      return;
    }
    // Only run once per connection session.
    if (m557LoadedRef.current) return;
    void (async () => {
      try {
        const blob = await service.downloadFile('0:/sys/config.g');
        const text = await blob.text();
        const parsed = parseM557(text);
        if (parsed) {
          m557LoadedRef.current = true;
          setProbeFromConfig(true);
          setConfigM557Line(parsed.rawLine);
          // Only overwrite the probe grid values if the user has NOT manually
          // unlocked and edited them — this preserves their override on re-connect.
          if (!probeGridUnlockedRef.current) {
            setProbeXMin(parsed.xMin);
            setProbeXMax(parsed.xMax);
            setProbeYMin(parsed.yMin);
            setProbeYMax(parsed.yMax);
            setProbePoints(parsed.numPoints);
          }
        }
      } catch {
        // config.g not accessible — fall through to axes fallback below
      }
    })();
  }, [connected, service]);

  // Sync probe ranges from real axis limits when no M557 was found in config.g.
  // We skip values that are zero or negative — those indicate the object model
  // hasn't populated yet and would lock out the correct values when they arrive.
  const lastAxesMaxRef = useRef<{ xMax: number; yMax: number } | null>(null);
  useEffect(() => {
    // Skip if config.g M557 already populated the grid — it has intentional margins.
    if (m557LoadedRef.current) return;
    if (!axes || axes.length < 2) return;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    if (!xAxis || !yAxis) return;
    const xMax = xAxis.max ?? 0;
    const yMax = yAxis.max ?? 0;
    // Only sync when the firmware reports plausible values (> 10 mm).
    if (xMax <= 10 || yMax <= 10) return;
    const last = lastAxesMaxRef.current;
    if (!last || last.xMax !== xMax || last.yMax !== yMax) {
      lastAxesMaxRef.current = { xMax, yMax };
      setProbeXMin(xAxis.min ?? 0);
      setProbeXMax(xMax);
      setProbeYMin(yAxis.min ?? 0);
      setProbeYMax(yMax);
    }
  }, [axes]);

  /* ── Persist sidebar prefs to localStorage ── */
  useEffect(() => {
    try {
      const prefs: HeightMapPrefs = {
        viewMode, diverging, sidebarOpen, showProbePoints, probePointScale, selectedCsv,
        probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
        probeGridUnlocked,
      };
      localStorage.setItem(HM_PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable — ignore */ }
  }, [viewMode, diverging, sidebarOpen, showProbePoints, probePointScale, selectedCsv,
      probeXMin, probeXMax, probeYMin, probeYMax, probePoints, probeGridUnlocked]);

  /* ── File list ── */
  const refreshCsvList = useCallback(async () => {
    if (!service) return;
    setLoadingCsvList(true);
    try {
      const entries = await service.listFiles('0:/sys');
      setCsvFiles(
        entries
          .filter((e) => e.type === 'f' && e.name.toLowerCase().endsWith('.csv'))
          .map((e) => e.name)
          .sort(),
      );
    } catch {
      setCsvFiles([]);
    } finally {
      setLoadingCsvList(false);
    }
  }, [service]);

  useEffect(() => { if (connected) void refreshCsvList(); }, [connected, refreshCsvList]);

  /* ── Derived ── */
  const isCompensationEnabled = !!compensationType && compensationType !== 'none';
  const isDemo   = !heightMap;
  const diffMap  = useMemo(
    () => (compareMode && heightMap && compareMap ? computeDiffMap(heightMap, compareMap) : null),
    [compareMap, compareMode, heightMap],
  );
  const displayMap   = diffMap ?? heightMap ?? DEMO_HEIGHT_MAP;
  const stats        = useMemo(() => computeStats(displayMap), [displayMap]);
  const quality      = getBedQuality(stats.rms);
  const useDiverging = compareMode || diverging;

  // Configured probe grid — drives the 3D marker positions in Scene3D.
  // Recomputed whenever any of the four range inputs or the points selector changes.
  const configuredGrid = useMemo<ConfiguredProbeGrid>(
    () => ({ xMin: probeXMin, xMax: probeXMax, yMin: probeYMin, yMax: probeYMax, numPoints: probePoints }),
    [probeXMin, probeXMax, probeYMin, probeYMax, probePoints],
  );

  // Physical bed extents from the printer's axis limits (M208).
  // When available these drive the full plate size + safety margin overlay in Scene3D.
  const bedBounds = useMemo<BedBounds | undefined>(() => {
    if (!axes || axes.length < 2) return undefined;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    if (!xAxis || !yAxis) return undefined;
    const xMax = xAxis.max ?? 0;
    const yMax = yAxis.max ?? 0;
    // Only use plausible values — the object model often initialises to 0.
    if (xMax <= 10 || yMax <= 10) return undefined;
    return { xMin: xAxis.min ?? 0, xMax, yMin: yAxis.min ?? 0, yMax };
  }, [axes]);

  // Probe grid derived values
  const m557Command = `M557 X${probeXMin}:${probeXMax} Y${probeYMin}:${probeYMax} P${probePoints}`;
  const spacingX    = probePoints > 1 ? ((probeXMax - probeXMin) / (probePoints - 1)).toFixed(1) : '—';
  const spacingY    = probePoints > 1 ? ((probeYMax - probeYMin) / (probePoints - 1)).toFixed(1) : '—';
  const gridLabel   = `${probePoints}×${probePoints}`;

  /* ── Camera presets ── */
  function applyPreset(preset: CameraPreset) {
    setCameraPos(CAMERA_POSITIONS[preset]);
    setSceneKey((k) => k + 1);
  }

  /* ── Actions ── */
  const handleLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await loadHeightMap(selectedCsv);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // 404 / file-not-found gives a terse message; make it readable
      if (/404|not found|no such/i.test(msg)) {
        setLoadError(`File not found on printer: ${selectedCsv.split('/').pop()}`);
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [loadHeightMap, selectedCsv]);

  const handleCompensationToggle = useCallback(() => {
    if (isCompensationEnabled) {
      void sendGCode('M561');
      return;
    }
    // Enabling — check if Z is homed; if not, show a toast with action buttons
    const zAxis = axes?.find((a) => a.letter === 'Z');
    if (!zAxis?.homed) {
      addToast(
        'warning',
        'Z axis not homed',
        'Apply anyway, or home first to set Z=0 datum and avoid a height offset.',
        [
          { label: 'Enable Anyway', onClick: () => void sendGCode('G29 S1') },
          {
            label: 'Home & Enable',
            onClick: () => {
              void sendGCode('G28').then(() => sendGCode('G29 S1'));
            },
          },
        ],
      );
      return;
    }
    void sendGCode('G29 S1');
  }, [isCompensationEnabled, axes, sendGCode]);

  const runProbe = useCallback(async (homeFirst: boolean) => {
    setShowProbeModal(false);
    setProbing(true);
    try {
      await sendGCode(m557Command);
      if (homeFirst) await sendGCode('G28');
      await probeGrid();
    } finally { setProbing(false); }
  }, [probeGrid, sendGCode, m557Command]);

  /** Validate prerequisites before opening the Level Bed modal. */
  const handleLevelBedOpen = useCallback(async () => {
    if (!service) return;

    // bed_tilt.g must exist — levelBed calls M98 against it.
    try {
      await service.getFileInfo('0:/sys/bed_tilt.g');
      setShowLevelModal(true);
    } catch {
      // File missing — generate content from bed.g (or template) and show setup modal.
      const { content, derived } = await generateBedTiltContent(service);
      setBedTiltContent(content);
      setBedTiltDerived(derived);
      setShowSetupModal(true);
    }
  }, [service]);

  /** Upload bed_tilt.g then open the Level Bed modal. */
  const handleCreateBedTilt = useCallback(async () => {
    if (!service) return;
    setCreatingTiltFile(true);
    try {
      const blob = new Blob([bedTiltContent], { type: 'text/plain' });
      await service.uploadFile('0:/sys/bed_tilt.g', blob);
      setShowSetupModal(false);
      setShowLevelModal(true);
    } catch (err) {
      addToast('error', 'Failed to create bed_tilt.g', (err as Error).message, undefined, 12_000);
    } finally {
      setCreatingTiltFile(false);
    }
  }, [service, bedTiltContent]);

  const handleLevelBed = useCallback(async (opts: import('../../store/printerStore').LevelBedOpts) => {
    setShowLevelModal(false);
    setLeveling(true);
    lastLevelOptsRef.current = opts;
    try {
      const summary = await levelBed(opts);
      setLevelSummary(summary);
      setShowResultsModal(true);
    } catch (err) {
      addToast('error', 'Level bed failed', (err as Error).message, undefined, 15_000);
    } finally {
      setLeveling(false);
    }
  }, [levelBed]);

  const handleRunAgain = useCallback(() => {
    setShowResultsModal(false);
    if (lastLevelOptsRef.current) void handleLevelBed(lastLevelOptsRef.current);
  }, [handleLevelBed]);

  const handleSaveAs = useCallback(async () => {
    const filename = prompt('Save height map as (filename without path/extension):', 'heightmap_backup');
    if (!filename) return;
    await sendGCode(`M374 P"0:/sys/${filename.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv"`);
    void refreshCsvList();
  }, [refreshCsvList, sendGCode]);

  const handleLoadCompare = useCallback(async (path: string) => {
    if (!service || !path) return;
    setCompareCsv(path);
    setLoadingCompare(true);
    setDiverging(true);
    try {
      setCompareMap(await service.getHeightMap(path));
      setCompareMode(true);
    } catch {
      setCompareMap(null);
      setCompareMode(false);
      setDiverging(false);
    } finally { setLoadingCompare(false); }
  }, [service]);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setCompareMap(null);
    setCompareCsv('');
    setDiverging(false);
  }, []);

  /* ── Render ── */
  return (
    <div className="hm-root">
      {showSetupModal && (
        <BedTiltSetupModal
          content={bedTiltContent}
          derived={bedTiltDerived}
          creating={creatingTiltFile}
          onCreateFile={() => void handleCreateBedTilt()}
          onClose={() => setShowSetupModal(false)}
        />
      )}
      {showResultsModal && levelSummary && (
        <LevelBedResultsModal
          summary={levelSummary}
          onClose={() => setShowResultsModal(false)}
          onRunAgain={handleRunAgain}
        />
      )}
      {showProbeModal && (
        <ProbeConfirmModal
          onConfirm={(homeFirst) => void runProbe(homeFirst)}
          onCancel={() => setShowProbeModal(false)}
          m557Command={m557Command}
          gridLabel={gridLabel}
        />
      )}
      {showLevelModal && (
        <LevelBedModal
          onConfirm={(opts) => void handleLevelBed(opts)}
          onCancel={() => setShowLevelModal(false)}
        />
      )}

      {/* ── Title bar (slim) ─────────────────────────────────────────── */}
      <div className="hm-topbar">
        <Map size={13} className="hm-topbar__icon" />
        <span className="hm-topbar__title">Bed Height Map</span>
        {isDemo && <span className="hm-topbar__demo-badge">Demo</span>}
        {probing && (
          <span className="hm-topbar__probing">
            <Loader2 size={11} className="hm-spin" />
            Probing bed…
          </span>
        )}
        {leveling && (
          <span className="hm-topbar__probing">
            <Loader2 size={11} className="hm-spin" />
            Leveling bed…
          </span>
        )}
      </div>

      {/* ── Compare banner ───────────────────────────────────────────── */}
      {compareMode && (
        <div className="hm-compare-banner">
          <GitCompareArrows size={12} />
          Δ <strong>{compareCsv.split('/').pop()}</strong> vs <strong>{selectedCsv.split('/').pop()}</strong>
          <span className="hm-compare-banner__hint">red = higher · blue = lower</span>
          <button className="hm-btn hm-btn--warning" style={{ marginLeft: 'auto' }} onClick={exitCompare}>
            <X size={11} /> Exit Compare
          </button>
        </div>
      )}

      {/* ── Split: viewport + sidebar ────────────────────────────────── */}
      <div className={`hm-split${sidebarOpen ? '' : ' hm-split--collapsed'}`}>

        {/* Viewport */}
        <div className="hm-viewport">
          {/* Sidebar toggle button — sits on the seam */}
          <button
            className={`hm-sidebar-toggle${sidebarOpen ? ' is-open' : ''}`}
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? 'Collapse panel' : 'Expand panel'}
          >
            <ChevronRight size={14} />
          </button>
          {compareMode && !diffMap ? (
            <div className="hm-empty">
              <div className="hm-empty__icon"><GitCompareArrows size={28} /></div>
              <p className="hm-empty__title">{loadingCompare ? 'Loading comparison map…' : 'Grid dimensions do not match'}</p>
              {!loadingCompare && <p className="hm-empty__sub">The two height maps must have the same grid size to compare.</p>}
            </div>
          ) : (
            <>
              {viewMode === '3d' ? (
                <div className="hm-viz-3d">
                  <Scene3D
                    key={sceneKey}
                    heightMap={displayMap}
                    diverging={useDiverging}
                    cameraPosition={cameraPos}
                    showProbePoints={showProbePoints}
                    probePointScale={probePointScale}
                    showMesh={!isDemo}
                    configuredGrid={configuredGrid}
                    bedBounds={bedBounds}
                  />
                </div>
              ) : (
                <Heatmap2D heightMap={displayMap} diverging={useDiverging} />
              )}
              {isDemo && (
                <div className="hm-demo-badge">
                  <Map size={11} />
                  Preview — load or probe a real map to see your bed
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────── */}
        <aside className={`hm-sidebar${sidebarOpen ? ' is-open' : ''}`}>

          {/* ── Actions ── */}
          <div className="hm-side-section hm-side-section--actions">
            <div className="hm-side-title">
              <span className={`hm-conn-dot${connected ? ' is-live' : ''}`} />
              Actions
            </div>

            <div className="hm-hero-row">
              <button
                className={`hm-probe-hero${probing ? ' is-probing' : ''}`}
                onClick={() => setShowProbeModal(true)}
                disabled={loading || probing || leveling || !connected}
                title="Probe the bed surface to measure deviation (M557 + G29)"
              >
                <span className="hm-probe-hero__icon">
                  {probing ? <Loader2 size={18} className="hm-spin" /> : <Crosshair size={18} />}
                </span>
                <span className="hm-probe-hero__body">
                  <span className="hm-probe-hero__label">{probing ? 'Probing…' : 'Probe Bed'}</span>
                  <span className="hm-probe-hero__sub">{gridLabel} · {spacingX}×{spacingY} mm</span>
                </span>
              </button>

              <button
                className={`hm-probe-hero hm-probe-hero--level${leveling ? ' is-probing' : ''}`}
                onClick={() => void handleLevelBedOpen()}
                disabled={loading || probing || leveling || !connected}
                title="Run true bed leveling using independent Z motors (G32)"
              >
                <span className="hm-probe-hero__icon">
                  {leveling ? <Loader2 size={18} className="hm-spin" /> : <Home size={18} />}
                </span>
                <span className="hm-probe-hero__body">
                  <span className="hm-probe-hero__label">{leveling ? 'Leveling…' : 'Level Bed'}</span>
                  <span className="hm-probe-hero__sub">G32 · tilt correction</span>
                </span>
              </button>
            </div>

            <div className="hm-action-row">
              <button className="hm-action-btn" onClick={() => void handleLoad()} disabled={loading || probing}
                title="Load height map from printer">
                {loading ? <Loader2 size={15} className="hm-spin" /> : <RefreshCw size={15} />}
                Load
              </button>
              <button className="hm-action-btn" onClick={() => heightMap && exportHeightMapCSV(heightMap)} disabled={!heightMap}
                title="Export height map as CSV to your computer">
                <Download size={15} />Export
              </button>
              <button className="hm-action-btn" onClick={() => void handleSaveAs()} disabled={!heightMap || !connected}
                title="Save a backup copy of the height map on the printer filesystem">
                <Save size={15} />Save As
              </button>
            </div>

            {loadError && (
              <div className="hm-load-error" role="alert">
                <TriangleAlert size={12} className="hm-load-error__icon" />
                <span>{loadError}</span>
                <button className="hm-load-error__dismiss" onClick={() => setLoadError(null)} title="Dismiss">
                  <X size={11} />
                </button>
              </div>
            )}

            <button
              className={`hm-comp-btn${isCompensationEnabled ? ' is-on' : ''}`}
              onClick={handleCompensationToggle}
              title={isCompensationEnabled
                ? 'Disable mesh bed compensation — M561 clears the active bed transform. The height map file stays on the printer and can be re-enabled with G29 S1.'
                : 'Enable mesh bed compensation — loads and applies the height map (G29 S1)'}
            >
              <span className={`hm-pill-switch${isCompensationEnabled ? ' is-on' : ''}`}><span className="hm-pill-switch__thumb" /></span>
              Mesh Compensation
              <span className={`hm-comp-badge${isCompensationEnabled ? ' is-on' : ''}`}>{isCompensationEnabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          {/* ── Statistics ── */}
          <div className="hm-side-section hm-side-section--stats">
            <div className="hm-side-title">Statistics</div>

            {/* Quality badge + RMS on one row */}
            <div className={`hm-stat-header${isDemo ? ' is-demo' : ''}`} style={{ '--qc': quality.color } as React.CSSProperties}
              title={`Bed flatness: ${quality.label} — RMS deviation ${stats.rms.toFixed(4)} mm`}>
              <div className="hm-quality-inline">
                <span className="hm-quality-dot" />
                <div>
                  <span className="hm-quality-label">{quality.label}</span>
                  <span className="hm-quality-sub">Bed Flatness</span>
                </div>
              </div>
              <div className="hm-rms-inline">
                <span className="hm-rms-label">RMS</span>
                <span className="hm-rms-val" style={stats.rms > 0.2 ? { color: '#f59e0b' } : { color: '#34d399' }}>
                  {stats.rms.toFixed(4)} mm
                </span>
              </div>
            </div>

            {/* RMS bar */}
            <div className={`hm-rms-track-wrap${isDemo ? ' is-demo' : ''}`}>
              <div className="hm-rms-track">
                <div className="hm-rms-fill" style={{ width: `${Math.min(100, stats.rms / 0.5 * 100)}%` }} />
              </div>
              <div className="hm-rms-scale"><span>0</span><span>0.1</span><span>0.25</span><span>0.5+mm</span></div>
            </div>

            {/* Min/Max chips */}
            <div className={`hm-minmax-row${isDemo ? ' is-demo' : ''}`}>
              <div className="hm-minmax-chip hm-minmax-chip--low"
                title="Lowest measured deviation — bed is below nozzle at this point">
                <span className="hm-minmax-chip__tag">LOW</span>
                <span className="hm-minmax-chip__val">{stats.min >= 0 ? '+' : ''}{stats.min.toFixed(3)} mm</span>
              </div>
              <div className="hm-minmax-chip hm-minmax-chip--high"
                title="Highest measured deviation — bed is above nozzle at this point">
                <span className="hm-minmax-chip__tag">HIGH</span>
                <span className="hm-minmax-chip__val">{stats.max >= 0 ? '+' : ''}{stats.max.toFixed(3)} mm</span>
              </div>
            </div>

            {/* 2-column stat grid */}
            <div className={`hm-stat-grid${isDemo ? ' is-demo' : ''}`}>
              <div className="hm-stat-cell" title="Mean deviation — average offset across all probe points">
                <span className="hm-stat-label">Mean</span>
                <span className="hm-stat-value">{stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)} mm</span>
              </div>
              <div className="hm-stat-cell" title="Probe grid dimensions and total number of sampled points">
                <span className="hm-stat-label">Grid</span>
                <span className="hm-stat-value">{stats.gridDimensions} ({stats.probePoints} pts)</span>
              </div>
            </div>
          </div>

          {/* ── Visualization (View + Color + Camera merged) ── */}
          <div className="hm-side-section">
            <div className="hm-side-title">Visualization</div>

            {/* View mode + color mode on same row */}
            <div className="hm-vis-top-row">
              <div className="hm-view-toggle" style={{ flex: 1 }}>
                <button className={`hm-toggle-btn${viewMode === '3d' ? ' is-active' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setViewMode('3d')}
                  title="3D surface view — drag to rotate, scroll to zoom, Shift+drag to pan">
                  <BarChart3 size={12} /> 3D
                </button>
                <button className={`hm-toggle-btn${viewMode === '2d' ? ' is-active' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setViewMode('2d')}
                  title="2D top-down heatmap — hover cells for exact values">
                  <Grid3x3 size={12} /> 2D
                </button>
              </div>
              <div className="hm-view-toggle" style={{ flex: 1 }}>
                <button className={`hm-toggle-btn${!useDiverging ? ' is-active' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => !compareMode && setDiverging(false)} disabled={compareMode}
                  title="Deviation palette — green = flat, yellow/red = warped">Dev</button>
                <button className={`hm-toggle-btn${useDiverging ? ' is-active' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => !compareMode && setDiverging(true)} disabled={compareMode}
                  title="Diverging palette — blue = low, red = high, white = zero">Div</button>
              </div>
            </div>

            {!isDemo && <ColorScaleLegend min={stats.min} max={stats.max} diverging={useDiverging} />}

            {/* Camera presets — 3D only, inline row */}
            {viewMode === '3d' && (
              <>
                <div className="hm-subsection-label"><Camera size={9} />Camera</div>
                <div className="hm-preset-row">
                  {([ ['iso','⬡','Iso','Isometric view — best for seeing overall warping'], ['top','↓','Top','Top-down view — directly above the bed'], ['front','→','Front','Front view — see the Y-axis curvature'], ['side','↗','Side','Side view — see the X-axis curvature'] ] as [CameraPreset, string, string, string][]).map(([preset, icon, label, tip]) => (
                    <button key={preset} className="hm-preset-btn" onClick={() => applyPreset(preset)} title={tip}>
                      <span className="hm-preset-btn__icon">{icon}</span>
                      {label}
                    </button>
                  ))}
                  <button className="hm-preset-btn hm-preset-btn--reset" onClick={() => setSceneKey((k) => k + 1)} title="Reset camera and re-render the scene">
                    <RotateCcw size={11} />
                  </button>
                </div>
                <div className="hm-mouse-hint">
                  <span>Drag</span> rotate · <span>Scroll</span> zoom · <span>⇧+Drag</span> pan
                </div>
              </>
            )}
          </div>

          {/* ── Probe Grid ── */}
          <div className="hm-side-section">
            <div className="hm-side-title">
              <Ruler size={9} style={{ marginRight: 4 }} />Probe Grid
              {probeFromConfig && (
                <>
                  <span
                    className="hm-probe-config-badge"
                    title="Probe grid loaded from M557 in config.g"
                  >
                    <Lock size={8} />config.g
                  </span>
                  <button
                    className={`hm-probe-lock-btn${probeGridUnlocked ? ' is-unlocked' : ''}`}
                    onClick={() => setProbeGridUnlocked((v) => !v)}
                    title={probeGridUnlocked
                      ? 'Re-lock — values will be restored from config.g on next connect'
                      : 'Unlock — override for this session only (config.g is unchanged)'}
                  >
                    {probeGridUnlocked ? <LockOpen size={10} /> : <Lock size={10} />}
                  </button>
                </>
              )}
            </div>

            {/* X and Y ranges on one row */}
            <div className="hm-range-row">
              <span className="hm-range-axis hm-range-axis--x" title="X axis probe range (mm)">X</span>
              <input
                className={`hm-grid-input hm-grid-input--sm${probeGridLocked ? ' is-locked' : ''}`}
                type="number" value={probeXMin} min={0} max={probeXMax - 1}
                disabled={probeGridLocked}
                onChange={(e) => setProbeXMin(Number(e.target.value))}
                title={probeGridLocked ? 'X start — set by M557 in config.g (unlock to override)' : 'X axis start position (mm)'}
              />
              <span className="hm-grid-sep">–</span>
              <input
                className={`hm-grid-input hm-grid-input--sm${probeGridLocked ? ' is-locked' : ''}`}
                type="number" value={probeXMax} min={probeXMin + 1}
                disabled={probeGridLocked}
                onChange={(e) => setProbeXMax(Number(e.target.value))}
                title={probeGridLocked ? 'X end — set by M557 in config.g (unlock to override)' : 'X axis end position (mm)'}
              />
              <span className="hm-range-axis hm-range-axis--y" title="Y axis probe range (mm)">Y</span>
              <input
                className={`hm-grid-input hm-grid-input--sm${probeGridLocked ? ' is-locked' : ''}`}
                type="number" value={probeYMin} min={0} max={probeYMax - 1}
                disabled={probeGridLocked}
                onChange={(e) => setProbeYMin(Number(e.target.value))}
                title={probeGridLocked ? 'Y start — set by M557 in config.g (unlock to override)' : 'Y axis start position (mm)'}
              />
              <span className="hm-grid-sep">–</span>
              <input
                className={`hm-grid-input hm-grid-input--sm${probeGridLocked ? ' is-locked' : ''}`}
                type="number" value={probeYMax} min={probeYMin + 1}
                disabled={probeGridLocked}
                onChange={(e) => setProbeYMax(Number(e.target.value))}
                title={probeGridLocked ? 'Y end — set by M557 in config.g (unlock to override)' : 'Y axis end position (mm)'}
              />
              <span className="hm-grid-unit">mm</span>
            </div>

            {/* Points + spacing on one row */}
            <div className="hm-probe-pts-row">
              <select
                className="hm-select"
                value={probePoints}
                disabled={probeGridLocked}
                onChange={(e) => setProbePoints(Number(e.target.value))}
                title={probeGridLocked
                  ? 'Points per axis — set by M557 in config.g (unlock to override)'
                  : 'Number of probe points per axis — more points = finer mesh, longer probe time'}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                  <option key={n} value={n}>{n}×{n} ({n * n} pts)</option>
                ))}
              </select>
              <span className="hm-probe-spacing" title="Approximate spacing between probe points">~{spacingX}×{spacingY} mm</span>
            </div>

            {/* Raw config.g M557 line — shown when loaded from config */}
            {probeFromConfig && configM557Line && (
              <div className="hm-probe-config-source" title="Exact M557 line read from 0:/sys/config.g">
                <span className="hm-probe-config-source-label">config.g</span>
                <code className="hm-probe-config-source-cmd">{configM557Line}</code>
              </div>
            )}

            {/* Warning when probe min values start at 0 — almost always means no safety margin */}
            {(probeXMin === 0 || probeYMin === 0) && (
              <div className="hm-probe-origin-warn">
                <TriangleAlert size={11} />
                <span>
                  {probeXMin === 0 && probeYMin === 0
                    ? 'X and Y start at 0'
                    : probeXMin === 0 ? 'X starts at 0' : 'Y starts at 0'
                  } — the probe may not reach the origin due to its nozzle offset.
                  {probeGridLocked
                    ? ' Unlock and set a safe margin, or fix M557 in config.g.'
                    : ' Set a safe minimum (e.g. 10–30 mm) above.'}
                </span>
              </div>
            )}

            {/* M557 command that will be sent — the effective values */}
            <code className="hm-grid-cmd hm-grid-cmd--block" title="This M557 will be sent to the printer when you probe">{m557Command}</code>

            {/* Markers + size — 3D only */}
            {viewMode === '3d' && (
              <div className="hm-markers-row">
                <button
                  className={`hm-pill-toggle${showProbePoints ? ' is-on' : ''}`}
                  onClick={() => setShowProbePoints((v) => !v)}
                  title={showProbePoints ? 'Hide probe point markers on the 3D surface' : 'Show probe point markers — hover for exact coordinates'}
                >
                  <span className="hm-pill-toggle__track"><span className="hm-pill-toggle__thumb" /></span>
                  <span className="hm-pill-toggle__label">Markers</span>
                </button>
                {showProbePoints && (
                  <div className="hm-marker-size" title="Adjust the size of the probe point spheres">
                    <input type="range" className="hm-size-slider" min={0.25} max={3} step={0.05}
                      value={probePointScale} onChange={(e) => setProbePointScale(Number(e.target.value))}
                      title={`Marker size: ${probePointScale.toFixed(2)}× (drag to resize)`} />
                    <span className="hm-grid-unit" style={{ minWidth: 30, textAlign: 'right' }}>{probePointScale.toFixed(2)}×</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Files & Compare (merged) ── */}
          <div className="hm-side-section">
            <div className="hm-side-title">Files</div>

            <div className="hm-file-row">
              <span title="Height map files on the printer (0:/sys/*.csv)">
                <FolderOpen size={12} className="hm-icon-muted" />
              </span>
              <select className="hm-select hm-select--fill" value={selectedCsv} onChange={(e) => setSelectedCsv(e.target.value)} disabled={loadingCsvList || csvFiles.length === 0}
                title="Select a height map CSV file from the printer filesystem — click Load to apply">
                {csvFiles.length === 0 && <option value="0:/sys/heightmap.csv">heightmap.csv</option>}
                {csvFiles.map((file) => <option key={file} value={`0:/sys/${file}`}>{file}</option>)}
              </select>
              <button className="hm-icon-btn" onClick={() => void refreshCsvList()} disabled={loadingCsvList} title="Refresh file list from printer">
                {loadingCsvList ? <Loader2 size={11} className="hm-spin" /> : <RefreshCw size={11} />}
              </button>
            </div>

            <div className="hm-subsection-label"><GitCompareArrows size={9} />Compare</div>

            {!compareMode ? (
              <div className="hm-file-row">
                <select className="hm-select hm-select--fill" value="" onChange={(e) => { if (e.target.value) void handleLoadCompare(e.target.value); }} disabled={!heightMap || loadingCompare || csvFiles.length === 0}
                  title="Load a second height map and overlay the difference — useful for comparing before/after calibration">
                  <option value="">Compare with…</option>
                  {csvFiles.filter((f) => `0:/sys/${f}` !== selectedCsv).map((f) => <option key={f} value={`0:/sys/${f}`}>{f}</option>)}
                </select>
                {loadingCompare && <Loader2 size={11} className="hm-spin hm-icon-muted" />}
              </div>
            ) : (
              <div className="hm-side-compare-active">
                <span className="hm-side-compare-label">{compareCsv.split('/').pop()}</span>
                <button className="hm-btn hm-btn--warning hm-full-btn" onClick={exitCompare}><X size={11} /> Exit Compare</button>
              </div>
            )}
          </div>

        </aside>
      </div>
    </div>
  );
}

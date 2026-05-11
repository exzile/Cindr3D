import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Layers, RefreshCcw, Crosshair, Loader2, Download,
  ToggleLeft, ToggleRight, AlertCircle, X, CheckCircle,
  Home, ScanLine, TriangleAlert, Grid3x3, Ruler, Lock, LockOpen,
} from 'lucide-react';
import { usePrinterStore, type LevelBedOpts } from '../../../store/printerStore';
import { computeStats, computeMeshRmsDiff, deviationColor, exportHeightMapCSV, parseProbeOffset, type HeightMapStats } from '../heightMap/utils';
import {
  CAMERA_POSITIONS,
  Scene3D,
  type BedBounds,
  type ConfiguredProbeGrid,
} from '../heightMap/visualization';
import type { DuetHeightMap, PrinterBoardType } from '../../../types/duet';

/* ─── demo mesh shown when no real map is loaded ───────────────── */

const DEMO_HEIGHT_MAP: DuetHeightMap = {
  xMin: 0, xMax: 235, xSpacing: 47,
  yMin: 0, yMax: 235, ySpacing: 47,
  radius: -1,
  numX: 6, numY: 6,
  points: [
    [ 0.042,  0.018, -0.008, -0.021, -0.012,  0.031],
    [ 0.029,  0.011, -0.019, -0.038, -0.024,  0.014],
    [ 0.007, -0.013, -0.031, -0.047, -0.033, -0.006],
    [-0.014, -0.029, -0.048, -0.062, -0.044, -0.018],
    [-0.008, -0.021, -0.037, -0.051, -0.038, -0.011],
    [ 0.023,  0.004, -0.015, -0.026, -0.019,  0.016],
  ],
};

const HM_PREFS_KEY = 'designcad:heightmap-prefs';

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

interface ProbeGridPrefs {
  probeXMin: number;
  probeXMax: number;
  probeYMin: number;
  probeYMax: number;
  probePoints: number;
  probeGridUnlocked: boolean;
}

const DEFAULT_GRID_PREFS: ProbeGridPrefs = {
  probeXMin: 0,
  probeXMax: 235,
  probeYMin: 0,
  probeYMax: 235,
  probePoints: 9,
  probeGridUnlocked: false,
};

function loadProbeGridPrefs(): ProbeGridPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Partial<ProbeGridPrefs>;
    return {
      probeXMin: typeof raw.probeXMin === 'number' ? raw.probeXMin : DEFAULT_GRID_PREFS.probeXMin,
      probeXMax: typeof raw.probeXMax === 'number' ? raw.probeXMax : DEFAULT_GRID_PREFS.probeXMax,
      probeYMin: typeof raw.probeYMin === 'number' ? raw.probeYMin : DEFAULT_GRID_PREFS.probeYMin,
      probeYMax: typeof raw.probeYMax === 'number' ? raw.probeYMax : DEFAULT_GRID_PREFS.probeYMax,
      probePoints: typeof raw.probePoints === 'number' ? raw.probePoints : DEFAULT_GRID_PREFS.probePoints,
      probeGridUnlocked: raw.probeGridUnlocked === true,
    };
  } catch {
    return { ...DEFAULT_GRID_PREFS };
  }
}

function saveProbeGridPrefs(prefs: ProbeGridPrefs) {
  try {
    const existing = JSON.parse(localStorage.getItem(HM_PREFS_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(HM_PREFS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch { /* storage unavailable */ }
}


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
    if (xMax <= xMin || yMax <= yMin) continue;

    const pm = line.match(/P(\d+(?:\.\d+)?)/i);
    const sm = line.match(/S(\d+(?:\.\d+)?)/i);
    const span = Math.max(xMax - xMin, yMax - yMin);
    const numPoints = pm
      ? Math.max(2, Math.round(parseFloat(pm[1])))
      : sm ? Math.max(2, Math.round(span / parseFloat(sm[1])) + 1) : 9;

    result = { xMin, xMax, yMin, yMax, numPoints, rawLine: raw.trim() };
  }
  return result;
}

interface ProbeOpts {
  homeFirst: boolean;
  probesPerPoint: number;
  mode: 'fixed' | 'converge';
  passes: number;
  maxPasses: number;
  targetDiff: number;
}

/* ─── probe results modal ──────────────────────────────────────── */

function ProbeResultsModal({
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isGood = stats != null && stats.rms <= 0.1;
  const isWarn = stats != null && stats.rms > 0.1 && stats.rms <= 0.2;

  return createPortal(
    <div className="bc-modal-overlay" onClick={onClose}>
      <div
        className="bc-modal bc-modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bc-probe-results-title"
      >
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            {stats == null
              ? <TriangleAlert size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
              : <ScanLine size={15} style={{ color: '#60a5fa', flexShrink: 0 }} />}
            <span id="bc-probe-results-title" className="bc-modal-title">Probe Results</span>
            {passes > 1 && <span className="bc-results-pass-badge">{passes} passes</span>}
          </div>
          <button className="bc-modal-close" onClick={onClose} title="Close"><X size={13} /></button>
        </div>

        <div className="bc-modal-body">
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
        </div>

        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--secondary" onClick={onRunAgain}>
            <RefreshCcw size={12} /> Run Again
          </button>
          <button className="bc-modal-btn bc-modal-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── probe confirm modal ──────────────────────────────────────── */

function ProbeConfirmModal({
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

  const buildOpts = useCallback(
    (): ProbeOpts => ({ homeFirst, probesPerPoint, mode, passes, maxPasses, targetDiff }),
    [homeFirst, probesPerPoint, mode, passes, maxPasses, targetDiff],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !isEditableKeyTarget(e.target)) {
        e.preventDefault();
        onConfirm(buildOpts());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel, buildOpts]);

  return createPortal(
    <div className="bc-modal-overlay" onClick={onCancel}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bc-modal-title">
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <TriangleAlert size={15} className="bc-modal-warn-icon" />
            <span id="bc-modal-title" className="bc-modal-title">Probe Bed Mesh - {gridLabel}</span>
          </div>
          <button className="bc-modal-close" onClick={onCancel} title="Cancel">
            <X size={13} />
          </button>
        </div>

        <div className="bc-modal-body">
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
        </div>

        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="bc-modal-btn bc-modal-btn--confirm" onClick={() => onConfirm(buildOpts())} autoFocus>
            <Crosshair size={13} />
            {homeFirst
              ? (mode === 'converge' ? 'Home & Auto-Probe' : passes > 1 ? `Home & Probe x${passes}` : 'Home & Probe')
              : (mode === 'converge' ? 'Auto-Probe' : passes > 1 ? `Probe x${passes}` : 'Probe')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── mini heatmap ─────────────────────────────────────────────── */

function LevelBedModal({
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

  return createPortal(
    <div className="bc-modal-overlay" onClick={onCancel}>
      <div className="bc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bc-level-modal-title">
        <div className="bc-modal-header">
          <div className="bc-modal-title-row">
            <TriangleAlert size={15} className="bc-modal-warn-icon" />
            <span id="bc-level-modal-title" className="bc-modal-title">Level Bed - G32</span>
          </div>
          <button className="bc-modal-close" onClick={onCancel} title="Cancel"><X size={13} /></button>
        </div>
        <div className="bc-modal-body">
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
        </div>
        <div className="bc-modal-footer">
          <button className="bc-modal-btn bc-modal-btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="bc-modal-btn bc-modal-btn--confirm bc-modal-btn--level" onClick={handleConfirm} autoFocus>
            <Home size={13} />
            {homeFirst
              ? (autoConverge ? 'Home & Auto-Level' : `Home & Level${repeat > 1 ? ` x${repeat}` : ''}`)
              : (autoConverge ? 'Auto-Level' : repeat > 1 ? `Level x${repeat}` : 'Level Bed')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MiniHeatmap({ heightMap }: { heightMap: DuetHeightMap }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stats      = useMemo(() => computeStats(heightMap), [heightMap]);

  const drawRef = useRef<() => void>(() => {});
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cellW = W / heightMap.numX;
    const cellH = H / heightMap.numY;
    for (let y = 0; y < heightMap.numY; y++) {
      for (let x = 0; x < heightMap.numX; x++) {
        const val = heightMap.points[y]?.[x] ?? 0;
        ctx.fillStyle = deviationColor(val, stats.min, stats.max);
        ctx.fillRect(
          Math.floor(x * cellW),
          Math.floor(y * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH),
        );
      }
    }
  }, [heightMap, stats]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 4 || rect.height < 4) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      drawRef.current();
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="bc-canvas-wrap">
      <canvas ref={canvasRef} className="bc-canvas" title="Bed mesh deviation heatmap" />
    </div>
  );
}

/* ─── scale legend ─────────────────────────────────────────────── */

function ScaleLegend({ min, max }: { min: number; max: number }) {
  const steps = 5;
  return (
    <div className="bc-legend">
      {Array.from({ length: steps }, (_, i) => {
        const t   = i / (steps - 1);
        const val = min + t * (max - min);
        return (
          <div key={i} className="bc-legend-step">
            <div className="bc-legend-swatch" style={{ background: deviationColor(val, min, max) }} />
            <span className="bc-legend-label">{val >= 0 ? '+' : ''}{val.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── main panel ───────────────────────────────────────────────── */

export default function BedCompensationPanel() {
  const heightMap        = usePrinterStore((s) => s.heightMap);
  const loadHeightMap    = usePrinterStore((s) => s.loadHeightMap);
  const probeGrid        = usePrinterStore((s) => s.probeGrid);
  const levelBed         = usePrinterStore((s) => s.levelBed);
  const sendGCode        = usePrinterStore((s) => s.sendGCode);
  const service          = usePrinterStore((s) => s.service);
  const connected        = usePrinterStore((s) => s.connected);
  const boardType        = usePrinterStore((s) => s.config.boardType);
  const compensationType = usePrinterStore((s) => s.model?.move?.compensation?.type);
  const axes             = usePrinterStore((s) => s.model?.move?.axes);

  const [loading,      setLoading]      = useState(false);
  const [probing,      setProbing]      = useState(false);
  const [leveling,     setLeveling]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [viewMode,     setViewMode]     = useState<'2d' | '3d'>('2d');
  const [showProbeModal, setShowProbeModal] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [showProbeResultModal, setShowProbeResultModal] = useState(false);
  const [probeResult, setProbeResult] = useState<{ stats: HeightMapStats | null; passes: number } | null>(null);
  const [probeXMin, setProbeXMin]       = useState(() => loadProbeGridPrefs().probeXMin);
  const [probeXMax, setProbeXMax]       = useState(() => loadProbeGridPrefs().probeXMax);
  const [probeYMin, setProbeYMin]       = useState(() => loadProbeGridPrefs().probeYMin);
  const [probeYMax, setProbeYMax]       = useState(() => loadProbeGridPrefs().probeYMax);
  const [probePoints, setProbePoints]   = useState(() => loadProbeGridPrefs().probePoints);
  const [probeFromConfig, setProbeFromConfig] = useState(false);
  const [configM557Line, setConfigM557Line] = useState<string | null>(null);
  const [probeXMinLimit, setProbeXMinLimit] = useState(0);
  const [probeYMinLimit, setProbeYMinLimit] = useState(0);
  const [probeGridUnlocked, setProbeGridUnlocked] = useState(() => loadProbeGridPrefs().probeGridUnlocked);
  const m557LoadedRef = useRef(false);
  const probeGridUnlockedRef = useRef(probeGridUnlocked);
  const configGridRef = useRef<{ xMin: number; xMax: number; yMin: number; yMax: number; numPoints: number } | null>(null);

  const isEnabled = !!compensationType && compensationType !== 'none';
  const activeMap = heightMap ?? DEMO_HEIGHT_MAP;
  const isDemo    = !heightMap;
  const stats     = useMemo(() => computeStats(activeMap), [activeMap]);
  const probeGridLocked = probeFromConfig && !probeGridUnlocked;
  const m557Command = `M557 X${probeXMin}:${probeXMax} Y${probeYMin}:${probeYMax} P${probePoints}`;
  const spacingX = probePoints > 1 ? ((probeXMax - probeXMin) / (probePoints - 1)).toFixed(1) : '-';
  const spacingY = probePoints > 1 ? ((probeYMax - probeYMin) / (probePoints - 1)).toFixed(1) : '-';
  const gridLabel = `${probePoints}x${probePoints}`;
  const spacingLabel = `${spacingX}x${spacingY} mm`;
  const configuredGrid = useMemo<ConfiguredProbeGrid>(
    () => ({ xMin: probeXMin, xMax: probeXMax, yMin: probeYMin, yMax: probeYMax, numPoints: probePoints }),
    [probeXMin, probeXMax, probeYMin, probeYMax, probePoints],
  );
  const bedBounds = useMemo<BedBounds | undefined>(() => {
    if (!axes || axes.length < 2) return undefined;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    const xMax = xAxis?.max ?? 0;
    const yMax = yAxis?.max ?? 0;
    if (xMax <= 10 || yMax <= 10) return undefined;
    return {
      xMin: xAxis.min ?? 0,
      xMax,
      yMin: yAxis.min ?? 0,
      yMax,
    };
  }, [axes]);

  const compensationLabel = (() => {
    if (!compensationType || compensationType === 'none') return 'None';
    if (compensationType === 'mesh') return 'Mesh';
    if (compensationType.includes('point') || compensationType === '3point') return '3-Point';
    return compensationType;
  })();

  useEffect(() => {
    probeGridUnlockedRef.current = probeGridUnlocked;
  }, [probeGridUnlocked]);

  useEffect(() => {
    saveProbeGridPrefs({ probeXMin, probeXMax, probeYMin, probeYMax, probePoints, probeGridUnlocked });
  }, [probeXMin, probeXMax, probeYMin, probeYMax, probePoints, probeGridUnlocked]);

  useEffect(() => {
    if (!connected || !service) {
      m557LoadedRef.current = false;
      setProbeFromConfig(false);
      setConfigM557Line(null);
      return;
    }
    if (m557LoadedRef.current) return;
    void (async () => {
      try {
        const blob = await service.downloadFile('0:/sys/config.g');
        const text = await blob.text();
        let g31 = parseProbeOffset(text);
        if (!g31) {
          try {
            const overrideBlob = await service.downloadFile('0:/sys/config-override.g');
            g31 = parseProbeOffset(await overrideBlob.text());
          } catch { /* config-override.g is optional */ }
        }
        if (g31) {
          const xLim = Math.max(0, g31.xOffset);
          const yLim = Math.max(0, g31.yOffset);
          setProbeXMinLimit(xLim);
          setProbeYMinLimit(yLim);
          if (!probeGridUnlockedRef.current) {
            setProbeXMin((v) => Math.max(v, xLim));
            setProbeYMin((v) => Math.max(v, yLim));
          }
        }
        const parsed = parseM557(text);
        if (!parsed) return;
        m557LoadedRef.current = true;
        configGridRef.current = { xMin: parsed.xMin, xMax: parsed.xMax, yMin: parsed.yMin, yMax: parsed.yMax, numPoints: parsed.numPoints };
        setProbeFromConfig(true);
        setConfigM557Line(parsed.rawLine);
        if (!probeGridUnlockedRef.current) {
          setProbeXMin(parsed.xMin);
          setProbeXMax(parsed.xMax);
          setProbeYMin(parsed.yMin);
          setProbeYMax(parsed.yMax);
          setProbePoints(parsed.numPoints);
        }
      } catch {
        // config.g is optional for dashboard use.
      }
    })();
  }, [connected, service]);

  useEffect(() => {
    if (m557LoadedRef.current || probeGridUnlockedRef.current || !axes || axes.length < 2) return;
    const xAxis = axes.find((a) => a.letter === 'X') ?? axes[0];
    const yAxis = axes.find((a) => a.letter === 'Y') ?? axes[1];
    const xMax = xAxis?.max ?? 0;
    const yMax = yAxis?.max ?? 0;
    if (xMax <= 10 || yMax <= 10) return;
    setProbeXMin(xAxis.min ?? 0);
    setProbeXMax(xMax);
    setProbeYMin(yAxis.min ?? 0);
    setProbeYMax(yMax);
  }, [axes]);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { await loadHeightMap(); }
    catch { setError('Failed to load height map'); }
    finally { setLoading(false); }
  }, [loadHeightMap]);

  const runProbe = useCallback(async (opts: ProbeOpts) => {
    setShowProbeModal(false);
    setProbing(true);
    setError(null);
    const isRRF = !boardType || boardType === 'duet';
    const shouldRestoreProbeSamples = isRRF && opts.probesPerPoint > 1;
    let passCount = 0;
    try {
      await sendGCode(m557Command);
      if (opts.homeFirst) await sendGCode('G28');
      if (shouldRestoreProbeSamples) await sendGCode(`M558 A${opts.probesPerPoint}`);
      let prevMap: DuetHeightMap | null = null;
      const maxIter = opts.mode === 'fixed' ? opts.passes : opts.maxPasses;
      for (let i = 0; i < maxIter; i++) {
        await probeGrid();
        passCount++;
        const curr = usePrinterStore.getState().heightMap;
        if (opts.mode === 'converge' && prevMap && curr) {
          if (computeMeshRmsDiff(prevMap, curr) <= opts.targetDiff) break;
        }
        if (curr) prevMap = curr;
      }
      if (isRRF && opts.probesPerPoint > 1) await sendGCode('M558 A1');
      const finalMap = usePrinterStore.getState().heightMap;
      setProbeResult({ stats: finalMap ? computeStats(finalMap) : null, passes: passCount });
      setShowProbeResultModal(true);
    } catch {
      setError('Probing failed');
    } finally {
      if (shouldRestoreProbeSamples) {
        try { await sendGCode('M558 A1'); } catch { /* best-effort cleanup */ }
      }
      setProbing(false);
    }
  }, [boardType, m557Command, probeGrid, sendGCode]);

  const handleLevelBed = useCallback(async (opts: LevelBedOpts) => {
    setShowLevelModal(false);
    setLeveling(true);
    setError(null);
    try {
      await levelBed(opts);
      // Level results are shown by DuetPrinterPanel via levelBedPendingResult — no toast needed.
    } catch {
      setError('Level bed failed');
    } finally {
      setLeveling(false);
    }
  }, [levelBed]);

  const handleToggle = useCallback(() => {
    void sendGCode(isEnabled ? 'G29 S2' : 'G29 S1');
  }, [sendGCode, isEnabled]);

  return (
    <div className="bc-panel">

      {showProbeModal && (
        <ProbeConfirmModal
          onConfirm={(opts) => void runProbe(opts)}
          onCancel={() => setShowProbeModal(false)}
          m557Command={m557Command}
          boardType={boardType}
          gridLabel={gridLabel}
          spacingLabel={spacingLabel}
          probeXMin={probeXMin}
          probeXMax={probeXMax}
          probeYMin={probeYMin}
          probeYMax={probeYMax}
          probePoints={probePoints}
          probeGridLocked={probeGridLocked}
          probeFromConfig={probeFromConfig}
          probeGridUnlocked={probeGridUnlocked}
          configM557Line={configM557Line}
          xMinLimit={probeXMinLimit}
          yMinLimit={probeYMinLimit}
          onProbeXMinChange={(v) => { setProbeXMin(v); setProbeGridUnlocked(true); }}
          onProbeXMaxChange={(v) => { setProbeXMax(v); setProbeGridUnlocked(true); }}
          onProbeYMinChange={(v) => { setProbeYMin(v); setProbeGridUnlocked(true); }}
          onProbeYMaxChange={(v) => { setProbeYMax(v); setProbeGridUnlocked(true); }}
          onProbePointsChange={(v) => { setProbePoints(v); setProbeGridUnlocked(true); }}
          onToggleProbeGridLock={() => {
            const wasUnlocked = probeGridUnlocked;
            if (wasUnlocked && configGridRef.current) {
              const g = configGridRef.current;
              setProbeXMin(g.xMin);
              setProbeXMax(g.xMax);
              setProbeYMin(g.yMin);
              setProbeYMax(g.yMax);
              setProbePoints(g.numPoints);
            }
            setProbeGridUnlocked((v) => !v);
          }}
        />
      )}
      {showProbeResultModal && probeResult && (
        <ProbeResultsModal
          stats={probeResult.stats}
          passes={probeResult.passes}
          onClose={() => setShowProbeResultModal(false)}
          onRunAgain={() => { setShowProbeResultModal(false); setShowProbeModal(true); }}
        />
      )}
      {showLevelModal && (
        <LevelBedModal
          onConfirm={(opts) => void handleLevelBed(opts)}
          onCancel={() => setShowLevelModal(false)}
        />
      )}

      {/* ── status bar ── */}
      <div className="bc-status-bar">
        <div className="bc-status-left">
          <Layers size={13} className={`bc-status-icon${isEnabled ? ' bc-status-icon--on' : ''}`} />
          <span className={`bc-type-badge${isEnabled ? ' bc-type-badge--on' : ''}`}>
            {compensationLabel}
          </span>
          <span className="bc-rms-badge" title="RMS deviation">
            ±{stats.rms.toFixed(3)} mm
          </span>
        </div>
        <button
          className={`bc-toggle-btn${isEnabled ? ' bc-toggle-btn--on' : ''}`}
          onClick={handleToggle}
          disabled={!connected}
          title={isEnabled ? 'Disable (G29 S2)' : 'Enable (G29 S1)'}
        >
          {isEnabled ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
          {isEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {/* ── heatmap + stats ── */}
      <div className="bc-viz-row">
        <div className="bc-canvas-col">
          <div className="bc-view-toggle" role="tablist" aria-label="Mesh preview view">
            <button
              type="button"
              className={viewMode === '2d' ? 'is-active' : ''}
              onClick={() => setViewMode('2d')}
              role="tab"
              aria-selected={viewMode === '2d'}
              title="2D heatmap view"
            >
              2D
            </button>
            <button
              type="button"
              className={viewMode === '3d' ? 'is-active' : ''}
              onClick={() => setViewMode('3d')}
              role="tab"
              aria-selected={viewMode === '3d'}
              title="3D surface view"
            >
              3D
            </button>
          </div>
          {viewMode === '3d' ? (
            <div className="bc-scene-wrap">
              <Scene3D
                heightMap={activeMap}
                cameraPosition={CAMERA_POSITIONS.iso}
                showProbePoints
                probePointScale={0.55}
                showZRuler={false}
                showXYRulers={false}
                configuredGrid={configuredGrid}
                bedBounds={bedBounds}
              />
              <span className="bc-scene-hint">drag rotate · scroll zoom</span>
            </div>
          ) : (
            <MiniHeatmap heightMap={activeMap} />
          )}
          {isDemo && <span className="bc-demo-badge">demo</span>}
        </div>
        <div className="bc-right-col">
          <div className="bc-stats">
            <div className="bc-stat">
              <span className="bc-stat-label">Min</span>
              <span className="bc-stat-val bc-stat-val--low">{stats.min >= 0 ? '+' : ''}{stats.min.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Max</span>
              <span className="bc-stat-val bc-stat-val--high">{stats.max >= 0 ? '+' : ''}{stats.max.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Mean</span>
              <span className="bc-stat-val">{stats.mean >= 0 ? '+' : ''}{stats.mean.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">RMS</span>
              <span className="bc-stat-val">{stats.rms.toFixed(3)}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Grid</span>
              <span className="bc-stat-val">{isDemo ? '6 × 6' : stats.gridDimensions}</span>
            </div>
            <div className="bc-stat">
              <span className="bc-stat-label">Points</span>
              <span className="bc-stat-val">{isDemo ? '—' : stats.probePoints}</span>
            </div>
          </div>
          <ScaleLegend min={stats.min} max={stats.max} />
        </div>
      </div>

      {/* ── error ── */}
      {error && (
        <div className="bc-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* ── file selector ── */}
      {/* ── actions ── */}
      <div className="bc-actions">
        <button
          className="bc-btn"
          onClick={() => void handleLoad()}
          disabled={!connected || loading || probing}
          title="Load the printer's default height map"
        >
          {loading ? <Loader2 size={12} className="bc-spin" /> : <RefreshCcw size={12} />}
          Load Map
        </button>
        <button
          className="bc-btn bc-btn--probe"
          onClick={() => setShowProbeModal(true)}
          disabled={!connected || loading || probing || leveling}
          title="Configure grid, then home axes and probe bed mesh"
        >
          {probing ? <Loader2 size={12} className="bc-spin" /> : <Crosshair size={12} />}
          {probing ? 'Probing…' : 'Probe Bed'}
        </button>
        <button
          className="bc-btn bc-btn--level"
          onClick={() => setShowLevelModal(true)}
          disabled={!connected || loading || probing || leveling}
          title="Run bed_tilt.g tilt correction"
        >
          {leveling ? <Loader2 size={12} className="bc-spin" /> : <Home size={12} />}
          {leveling ? 'Leveling...' : 'Level Bed'}
        </button>
        <button
          className="bc-btn"
          onClick={() => heightMap && exportHeightMapCSV(heightMap)}
          disabled={!heightMap}
          title="Export height map as CSV"
        >
          <Download size={12} />
          Export
        </button>
      </div>

    </div>
  );
}

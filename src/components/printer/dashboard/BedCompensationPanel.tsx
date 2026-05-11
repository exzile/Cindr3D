import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layers, RefreshCcw, Crosshair, Loader2, Download,
  ToggleLeft, ToggleRight, AlertCircle, Home,
} from 'lucide-react';
import { usePrinterStore, type LevelBedOpts } from '../../../store/printerStore';
import { computeStats, computeMeshRmsDiff, exportHeightMapCSV, type HeightMapStats } from '../heightMap/utils';
import { useProbeGridConfig } from '../heightMap/hooks/useProbeGridConfig';
import {
  CAMERA_POSITIONS,
  Scene3D,
  type BedBounds,
  type ConfiguredProbeGrid,
} from '../heightMap/visualization';
import type { DuetHeightMap } from '../../../types/duet';
import { DEMO_HEIGHT_MAP } from './bedCompensation/demo';
import { loadProbeGridPrefs, saveProbeGridPrefs } from './bedCompensation/prefs';
import type { ProbeOpts } from './bedCompensation/types';
import { MiniHeatmap } from './bedCompensation/MiniHeatmap';
import { ScaleLegend } from './bedCompensation/ScaleLegend';
import { ProbeConfirmModal } from './bedCompensation/modals/ProbeConfirmModal';
import { ProbeResultsModal } from './bedCompensation/modals/ProbeResultsModal';
import { LevelBedModal } from './bedCompensation/modals/LevelBedModal';

/* ─── main panel ───────────────────────────────── */

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
  const [probeGridUnlocked, setProbeGridUnlocked] = useState(() => loadProbeGridPrefs().probeGridUnlocked);

  /* ── Probe-grid config (M557/G31 from config.g + axes fallback) ── */
  const {
    probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
    setProbeXMin, setProbeXMax, setProbeYMin, setProbeYMax, setProbePoints,
    probeFromConfig, configM557Line, configGridRef, g31Offset,
  } = useProbeGridConfig({
    service, connected, axes,
    initial: {
      probeXMin:   loadProbeGridPrefs().probeXMin,
      probeXMax:   loadProbeGridPrefs().probeXMax,
      probeYMin:   loadProbeGridPrefs().probeYMin,
      probeYMax:   loadProbeGridPrefs().probeYMax,
      probePoints: loadProbeGridPrefs().probePoints,
    },
    unlocked: probeGridUnlocked,
  });

  // G31 sets a minimum allowed travel for the probe tip; surface it so the
  // ProbeGridSection's number inputs can clamp to it.
  const probeXMinLimit = Math.max(0, g31Offset?.x ?? 0);
  const probeYMinLimit = Math.max(0, g31Offset?.y ?? 0);

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
    saveProbeGridPrefs({ probeXMin, probeXMax, probeYMin, probeYMax, probePoints, probeGridUnlocked });
  }, [probeXMin, probeXMax, probeYMin, probeYMax, probePoints, probeGridUnlocked]);

  // Auto-load the default heightmap when a printer first connects so the panel
  // renders with real data instead of the demo placeholder.
  useEffect(() => {
    if (connected) void loadHeightMap();
  }, [connected, loadHeightMap]);

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
    // Capture the user's M558 baseline so we restore it (not a hardcoded A1).
    const liveProbe = service?.getModel().sensors?.probes?.[0];
    const prevProbeA = liveProbe?.maxProbeCount ?? 1;
    const prevProbeS = liveProbe?.tolerance ?? 0.01;
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
      const finalMap = usePrinterStore.getState().heightMap;
      setProbeResult({ stats: finalMap ? computeStats(finalMap) : null, passes: passCount });
      setShowProbeResultModal(true);
    } catch {
      setError('Probing failed');
    } finally {
      // Restore M558 even when the probe sequence threw; do it once, here.
      if (shouldRestoreProbeSamples) {
        try { await sendGCode(`M558 A${prevProbeA} S${prevProbeS}`); } catch { /* best-effort cleanup */ }
      }
      setProbing(false);
    }
  }, [boardType, m557Command, probeGrid, sendGCode, service]);

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

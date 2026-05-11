import { useState, useEffect, useMemo, useCallback } from 'react';
import './DuetHeightMap.css';
import {
  Map, GitCompareArrows, X,
  RotateCcw, ChevronRight,
} from 'lucide-react';
import { addToast } from '../../store/toastStore';
import { usePrinterStore } from '../../store/printerStore';
import {
  Heatmap2D, Scene3D, getBedQuality,
  CAMERA_POSITIONS, type CameraPreset, type ConfiguredProbeGrid, type BedBounds,
} from './heightMap/visualization';
import {
  computeDiffMap, computeStats,
} from './heightMap/utils';
import {
  DEMO_HEIGHT_MAP, HM_PREFS_KEY, type HeightMapPrefs, loadHeightMapPrefs,
} from './heightMap/prefs';
import { generateBedTiltContent } from './heightMap/bedTilt';
import { HeightMapSidebar } from './heightMap/sidebar/HeightMapSidebar';
import { HeightMapTopbar } from './heightMap/HeightMapTopbar';
import { HeightMapModalsHost } from './heightMap/HeightMapModalsHost';
import { useHeightMapRunners } from './heightMap/hooks/useHeightMapRunners';
import { useProbeGridConfig } from './heightMap/hooks/useProbeGridConfig';

// Re-export for the printer-panel chrome that imports this from DuetHeightMap.
export { LevelBedResultsModal } from './heightMap/modals/LevelBedResultsModal';

/* ── Main component ──────────────────────────────────────────────── */

export default function DuetHeightMap() {
  const heightMap         = usePrinterStore((s) => s.heightMap);
  const loadHeightMap     = usePrinterStore((s) => s.loadHeightMap);
  const probeGrid         = usePrinterStore((s) => s.probeGrid);
  const levelBed          = usePrinterStore((s) => s.levelBed);
  const levelBedProgress  = usePrinterStore((s) => s.levelBedProgress);
  const sendGCode         = usePrinterStore((s) => s.sendGCode);
  const service           = usePrinterStore((s) => s.service);
  const connected         = usePrinterStore((s) => s.connected);
  const compensationType = usePrinterStore((s) => s.model.move?.compensation?.type);
  const axes             = usePrinterStore((s) => s.model.move?.axes);
  const boardType        = usePrinterStore((s) => s.config.boardType);
  // Current M558 probe settings from object model (live A/S values).
  // Selecting primitive fields separately avoids the object-identity churn that
  // would re-render this component on every unrelated model update.
  const probeMaxCount = usePrinterStore((s) => s.model.sensors?.probes?.[0]?.maxProbeCount);
  const probeTol      = usePrinterStore((s) => s.model.sensors?.probes?.[0]?.tolerance);

  const [loading, setLoading]               = useState(false);
  const [loadError, setLoadError]           = useState<string | null>(null);
  const [showProbeModal, setShowProbeModal]   = useState(false);
  const [showLevelModal, setShowLevelModal]   = useState(false);
  const [showSetupModal,    setShowSetupModal]    = useState(false);
  const [bedTiltContent,    setBedTiltContent]    = useState('');
  const [bedTiltDerived,    setBedTiltDerived]    = useState(false);
  const [bedTiltNoG30,      setBedTiltNoG30]      = useState(false);
  const [creatingTiltFile,  setCreatingTiltFile]  = useState(false);
  // Smart Calibration
  const [showSmartCalModal,       setShowSmartCalModal]       = useState(false);
  // Save As modal
  const [showSaveAsModal,         setShowSaveAsModal]         = useState(false);
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
  const [mirrorX,   setMirrorX]     = useState(() => loadHeightMapPrefs().mirrorX);

  // Probe point display
  const [showProbePoints, setShowProbePoints] = useState(() => loadHeightMapPrefs().showProbePoints);
  const [probePointScale, setProbePointScale] = useState(() => loadHeightMapPrefs().probePointScale);

  // Whether the user has explicitly unlocked the probe grid to override config.g values.
  // Persisted in localStorage so unlock + custom values survive page refreshes.
  const [probeGridUnlocked, setProbeGridUnlocked] = useState(
    () => loadHeightMapPrefs().probeGridUnlocked,
  );

  /* ── Probe-grid config (M557/G31 from config.g + axes fallback) ── */
  const {
    probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
    setProbeXMin, setProbeXMax, setProbeYMin, setProbeYMax, setProbePoints,
    probeFromConfig, configM557Line, configGridRef, g31Offset,
  } = useProbeGridConfig({
    service, connected, axes,
    initial: {
      probeXMin:   loadHeightMapPrefs().probeXMin,
      probeXMax:   loadHeightMapPrefs().probeXMax,
      probeYMin:   loadHeightMapPrefs().probeYMin,
      probeYMax:   loadHeightMapPrefs().probeYMax,
      probePoints: loadHeightMapPrefs().probePoints,
    },
    unlocked: probeGridUnlocked,
  });

  const safeBounds = useMemo(() => {
    if (!g31Offset) return null;
    const xAxis = axes?.find((a) => a.letter === 'X');
    const yAxis = axes?.find((a) => a.letter === 'Y');
    const axXMin = xAxis?.min ?? 0;
    const axXMax = xAxis?.max ?? 0;
    const axYMin = yAxis?.min ?? 0;
    const axYMax = yAxis?.max ?? 0;
    return {
      xMin: axXMin + Math.max(0, g31Offset.x),
      xMax: axXMax > 0 ? axXMax + Math.min(0, g31Offset.x) : null,
      yMin: axYMin + Math.max(0, g31Offset.y),
      yMax: axYMax > 0 ? axYMax + Math.min(0, g31Offset.y) : null,
    };
  }, [g31Offset, axes]);

  const probeGridLocked = probeFromConfig && !probeGridUnlocked;

  /* ── Persist sidebar prefs to localStorage ── */
  useEffect(() => {
    try {
      const prefs: HeightMapPrefs = {
        viewMode, diverging, mirrorX, sidebarOpen, showProbePoints, probePointScale, selectedCsv,
        probeXMin, probeXMax, probeYMin, probeYMax, probePoints,
        probeGridUnlocked,
      };
      localStorage.setItem(HM_PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable — ignore */ }
  }, [viewMode, diverging, mirrorX, sidebarOpen, showProbePoints, probePointScale, selectedCsv,
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

  /* ── Long-running runners (probe / level / smart-cal) ── */
  const runners = useHeightMapRunners({
    service, sendGCode, probeGrid, levelBed,
    m557Command, probeXMin, probeXMax, probeYMin, probeYMax,
    boardType, setLoadError,
  });
  const {
    probing, probeProgress, probeResult,
    showProbeResultModal, setShowProbeResultModal,
    runProbe,
    leveling,
    runLevel,
    smartCalRunning, smartCalPhase, smartCalResult,
    showSmartCalResultModal, setShowSmartCalResultModal,
    runSmartCal,
  } = runners;
  const smartCalActive = smartCalRunning || smartCalPhase !== null;

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
              void (async () => {
                try {
                  await sendGCode('G28');
                  await sendGCode('G29 S1');
                } catch (err) {
                  addToast('error', 'Failed to home & enable compensation', (err as Error).message);
                }
              })();
            },
          },
        ],
      );
      return;
    }
    void sendGCode('G29 S1');
  }, [isCompensationEnabled, axes, sendGCode]);

  /** Validate prerequisites before opening the Level Bed modal. */
  const handleLevelBedOpen = useCallback(async () => {
    if (!service) return;
    try {
      await service.getFileInfo('0:/sys/bed_tilt.g');
      setShowLevelModal(true);
    } catch {
      const { content, derived } = await generateBedTiltContent(service);
      setBedTiltContent(content);
      setBedTiltDerived(derived);
      setBedTiltNoG30(false);
      setShowSetupModal(true);
    }
  }, [service]);

  /** Upload bed_tilt.g then open the Level Bed modal. */
  const handleCreateBedTilt = useCallback(async (content: string) => {
    if (!service) return;
    setCreatingTiltFile(true);
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      await service.uploadFile('0:/sys/bed_tilt.g', blob);
      setShowSetupModal(false);
      setShowLevelModal(true);
    } catch (err) {
      addToast('error', 'Failed to save bed_tilt.g', (err as Error).message, undefined, 12_000);
    } finally {
      setCreatingTiltFile(false);
    }
  }, [service]);

  const handleSaveAs = useCallback((filename: string) => {
    const safe = filename.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) return;
    void (async () => {
      try {
        await sendGCode(`M374 P"0:/sys/${safe}.csv"`);
        await refreshCsvList();
        addToast('info', 'Height map saved', `0:/sys/${safe}.csv`);
      } catch (err) {
        addToast('error', 'Save failed', (err as Error).message);
      }
    })();
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
      <HeightMapModalsHost
        showSetupModal={showSetupModal}
        showProbeModal={showProbeModal}
        showProbeResultModal={showProbeResultModal}
        showLevelModal={showLevelModal}
        showSmartCalModal={showSmartCalModal}
        showSmartCalResultModal={showSmartCalResultModal}
        showSaveAsModal={showSaveAsModal}
        bedTiltContent={bedTiltContent}
        bedTiltDerived={bedTiltDerived}
        bedTiltNoG30={bedTiltNoG30}
        creatingTiltFile={creatingTiltFile}
        onCreateBedTilt={(content) => void handleCreateBedTilt(content)}
        closeSetup={() => setShowSetupModal(false)}
        probeResult={probeResult}
        closeProbeResult={() => setShowProbeResultModal(false)}
        reopenProbe={() => { setShowProbeResultModal(false); setShowProbeModal(true); }}
        enableCompensation={() => {
          setShowProbeResultModal(false);
          void sendGCode('G29 S1');
        }}
        m557Command={m557Command}
        gridLabel={gridLabel}
        boardType={boardType}
        heightMap={heightMap}
        closeProbe={() => setShowProbeModal(false)}
        runProbe={(opts) => { setShowProbeModal(false); void runProbe(opts); }}
        closeLevel={() => setShowLevelModal(false)}
        runLevel={(opts) => { setShowLevelModal(false); void runLevel(opts); }}
        closeSmartCal={() => setShowSmartCalModal(false)}
        runSmartCal={(opts) => { setShowSmartCalModal(false); void runSmartCal(opts); }}
        smartCalResult={smartCalResult}
        closeSmartCalResult={() => setShowSmartCalResultModal(false)}
        reopenSmartCal={() => { setShowSmartCalResultModal(false); setShowSmartCalModal(true); }}
        closeSaveAs={() => setShowSaveAsModal(false)}
        onSaveAsConfirm={(name) => { setShowSaveAsModal(false); handleSaveAs(name); }}
      />

      {/* ── Title bar ───────────────────────────────────────────────── */}
      <HeightMapTopbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        useDiverging={useDiverging}
        setDiverging={setDiverging}
        compareMode={compareMode}
        probing={probing}
        probeProgress={probeProgress}
        leveling={leveling}
        levelBedProgress={levelBedProgress}
        smartCalRunning={smartCalRunning}
        smartCalPhase={smartCalPhase}
      />

      {/* ── Compare banner ──────────────────────────────────────────── */}
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

      {/* ── Split: viewport + sidebar ──────────────────────────────────── */}
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
                    mirrorX={mirrorX}
                  />
                </div>
              ) : (
                <Heatmap2D heightMap={displayMap} diverging={useDiverging} mirrorX={mirrorX} />
              )}
              {isDemo && (
                <div className="hm-demo-badge">
                  <Map size={11} />
                  Preview — load or probe a real map to see your bed
                </div>
              )}

              {/* Camera presets — top-right canvas overlay, 3D only */}
              {viewMode === '3d' && (
                <div className="hm-cam-overlay">
                  {([ ['iso','⬡','Iso','Isometric view'], ['top','↓','Top','Top-down view'], ['front','→','Front','Front view'], ['side','↗','Side','Side view'] ] as [CameraPreset, string, string, string][]).map(([preset, icon, label, tip]) => (
                    <button key={preset} className="hm-preset-btn" onClick={() => applyPreset(preset)} title={tip}>
                      <span className="hm-preset-btn__icon">{icon}</span>
                      {label}
                    </button>
                  ))}
                  <button className="hm-preset-btn hm-preset-btn--reset" onClick={() => setSceneKey((k) => k + 1)} title="Reset camera">
                    <RotateCcw size={11} />
                  </button>
                </div>
              )}

              {/* Color scale legend — always visible at center-bottom of canvas */}
              <div className="hm-legend-overlay">
                <div className="hm-legend-wrap">
                  <span className="hm-legend-val">{stats.min.toFixed(3)}</span>
                  <div
                    className="hm-legend-gradient"
                    style={{
                      background: useDiverging
                        ? 'linear-gradient(to right, rgb(59,130,246), rgb(255,255,255), rgb(239,68,68))'
                        : 'linear-gradient(to right, rgb(34,100,255), rgb(34,197,94), rgb(239,68,68))',
                    }}
                    title={`Color scale: ${stats.min.toFixed(3)} mm (low) → 0 mm (flat) → ${stats.max.toFixed(3)} mm (high)`}
                  />
                  <span className="hm-legend-val">{stats.max.toFixed(3)}</span>
                  <span className="hm-legend-mm">mm</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <HeightMapSidebar
          open={sidebarOpen}
          connected={connected}
          loading={loading}
          probing={probing}
          leveling={leveling}
          smartCalRunning={smartCalRunning}
          smartCalActive={smartCalActive}
          gridLabel={gridLabel}
          spacingX={spacingX}
          spacingY={spacingY}
          loadError={loadError}
          heightMap={heightMap}
          isCompensationEnabled={isCompensationEnabled}
          onProbe={() => setShowProbeModal(true)}
          onLevel={() => void handleLevelBedOpen()}
          onSmartCal={() => setShowSmartCalModal(true)}
          onLoad={() => void handleLoad()}
          onSaveAs={() => setShowSaveAsModal(true)}
          onDismissError={() => setLoadError(null)}
          onCompensationToggle={handleCompensationToggle}
          stats={stats}
          isDemo={isDemo}
          quality={quality}
          probeFromConfig={probeFromConfig}
          configM557Line={configM557Line}
          probeGridUnlocked={probeGridUnlocked}
          setProbeGridUnlocked={setProbeGridUnlocked}
          configGridRef={configGridRef}
          probeGridLocked={probeGridLocked}
          probeXMin={probeXMin}
          probeXMax={probeXMax}
          probeYMin={probeYMin}
          probeYMax={probeYMax}
          probePoints={probePoints}
          setProbeXMin={setProbeXMin}
          setProbeXMax={setProbeXMax}
          setProbeYMin={setProbeYMin}
          setProbeYMax={setProbeYMax}
          setProbePoints={setProbePoints}
          safeBounds={safeBounds}
          m557Command={m557Command}
          probeMaxCount={probeMaxCount}
          probeTol={probeTol}
          mirrorX={mirrorX}
          setMirrorX={setMirrorX}
          viewMode={viewMode}
          showProbePoints={showProbePoints}
          setShowProbePoints={setShowProbePoints}
          probePointScale={probePointScale}
          setProbePointScale={setProbePointScale}
          selectedCsv={selectedCsv}
          setSelectedCsv={setSelectedCsv}
          csvFiles={csvFiles}
          loadingCsvList={loadingCsvList}
          refreshCsvList={refreshCsvList}
          compareMode={compareMode}
          compareCsv={compareCsv}
          loadingCompare={loadingCompare}
          handleLoadCompare={handleLoadCompare}
          exitCompare={exitCompare}
        />
      </div>
    </div>
  );
}

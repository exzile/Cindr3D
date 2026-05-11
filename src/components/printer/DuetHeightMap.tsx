import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './DuetHeightMap.css';
import {
  Map, GitCompareArrows, X,
  RotateCcw, ChevronRight,
} from 'lucide-react';
import { addToast } from '../../store/toastStore';
import type { LevelBedOpts } from '../../store/printerStore';
import { usePrinterStore } from '../../store/printerStore';
import {
  Heatmap2D, Scene3D, getBedQuality,
  CAMERA_POSITIONS, type CameraPreset, type ConfiguredProbeGrid, type BedBounds,
} from './heightMap/visualization';
import {
  computeDiffMap, computeMeshRmsDiff, computeStats,
  parseM557, parseProbeOffset, type HeightMapStats,
} from './heightMap/utils';
import type { DuetHeightMap as HeightMapData } from '../../types/duet';
import {
  DEMO_HEIGHT_MAP, HM_PREFS_KEY, type HeightMapPrefs, loadHeightMapPrefs,
} from './heightMap/prefs';
import { generateBedTiltContent } from './heightMap/bedTilt';
import type { ProbeOpts, SmartCalOpts, SmartCalResult, SmartCalStep } from './heightMap/types';
import { HeightMapSidebar } from './heightMap/sidebar/HeightMapSidebar';
import { HeightMapTopbar } from './heightMap/HeightMapTopbar';
import { HeightMapModalsHost } from './heightMap/HeightMapModalsHost';

// Re-export for the printer-panel chrome that imports this from DuetHeightMap.
export { LevelBedResultsModal } from './heightMap/modals/LevelBedResultsModal';

/* ── Main component ─────────────────────────────────────────────── */

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
  const [probing, setProbing]               = useState(false);
  const [leveling, setLeveling]             = useState(false);
  // Live probe progress during a G29 sequence (component-local, avoids store changes)
  const [probeProgress, setProbeProgress]   = useState<{
    pass: number; totalPasses: number; done: number; total: number | null;
  } | null>(null);
  const [showProbeModal, setShowProbeModal]   = useState(false);
  const [showLevelModal, setShowLevelModal]   = useState(false);
  const [showSetupModal,    setShowSetupModal]    = useState(false);
  const [bedTiltContent,    setBedTiltContent]    = useState('');
  const [bedTiltDerived,    setBedTiltDerived]    = useState(false);
  const [bedTiltNoG30,      setBedTiltNoG30]      = useState(false);
  const [creatingTiltFile,  setCreatingTiltFile]  = useState(false);
  const [showProbeResultModal, setShowProbeResultModal] = useState(false);
  const [probeResult,       setProbeResult]       = useState<{ stats: HeightMapStats | null; passes: number } | null>(null);
  const [m557Copied, setM557Copied] = useState(false);
  const m557CopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Smart Calibration
  const [showSmartCalModal,       setShowSmartCalModal]       = useState(false);
  const [showSmartCalResultModal, setShowSmartCalResultModal] = useState(false);
  const [smartCalRunning,         setSmartCalRunning]         = useState(false);
  const [smartCalPhase,           setSmartCalPhase]           = useState<'homing' | 'leveling' | 'probing' | 'datum' | null>(null);
  const [smartCalResult,          setSmartCalResult]          = useState<SmartCalResult | null>(null);
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
  useEffect(() => () => {
    if (m557CopyTimerRef.current) clearTimeout(m557CopyTimerRef.current);
  }, []);
  const [g31Offset, setG31Offset] = useState<{ x: number; y: number } | null>(null);
  const configGridRef = useRef<{ xMin: number; xMax: number; yMin: number; yMax: number; numPoints: number } | null>(null);

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
        // G31 may be in config-override.g (written by M500 auto-tune) rather than config.g.
        // Try config.g first, then fall back to config-override.g.
        let g31 = parseProbeOffset(text);
        if (!g31) {
          try {
            const overrideBlob = await service.downloadFile('0:/sys/config-override.g');
            g31 = parseProbeOffset(await overrideBlob.text());
          } catch { /* config-override.g is optional */ }
        }
        if (g31) setG31Offset({ x: g31.xOffset, y: g31.yOffset });
        const parsed = parseM557(text);
        if (parsed) {
          m557LoadedRef.current = true;
          configGridRef.current = { xMin: parsed.xMin, xMax: parsed.xMax, yMin: parsed.yMin, yMax: parsed.yMax, numPoints: parsed.numPoints };
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
    // Skip if the user has unlocked and customized the grid — preserve their values.
    if (probeGridUnlockedRef.current) return;
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
  const smartCalActive = smartCalRunning || smartCalPhase !== null;

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

  const runProbe = useCallback(async (opts: ProbeOpts) => {
    setShowProbeModal(false);
    setProbing(true);
    setProbeProgress(null);
    setLoadError(null);
    const isRRF = !boardType || boardType === 'duet';
    const shouldRestoreProbeSamples = isRRF && opts.probesPerPoint > 1;
    // Snapshot the firmware's current M558 sampling so we restore the user's
    // baseline rather than stomping it with a hardcoded "A1 S0.01".
    const liveProbe = service?.getModel().sensors?.probes?.[0];
    const prevProbeA = liveProbe?.maxProbeCount ?? 1;
    const prevProbeS = liveProbe?.tolerance ?? 0.01;
    let passCount = 0;
    try {
      await sendGCode(m557Command);
      if (opts.homeFirst) await sendGCode('G28');

      // G30 S-1: move to bed centre first so we probe in a representative location,
      // then set Z=0 datum without saving to G31.
      if (opts.calibrateZDatum) {
        const cx = ((probeXMin + probeXMax) / 2).toFixed(1);
        const cy = ((probeYMin + probeYMax) / 2).toFixed(1);
        // Use service directly (not store action) so we can capture the reply.
        if (service) {
          await service.sendGCode(`G1 X${cx} Y${cy} F6000`);
          await service.sendGCode('G30 S-1');
          // Offer to persist the calibrated datum to config-override.g
          addToast(
            'info',
            'Z datum calibrated',
            `Probed at bed centre (${cx}, ${cy}) — Z=0 reference set for this session.`,
            [{ label: 'Persist (M500)', onClick: () => void sendGCode('M500') }],
            10_000,
          );
        } else {
          await sendGCode(`G1 X${cx} Y${cy} F6000`);
          await sendGCode('G30 S-1');
        }
      }

      if (shouldRestoreProbeSamples) await sendGCode(`M558 A${opts.probesPerPoint} S${opts.probeTolerance}`);

      let prevMap: HeightMapData | null = null;
      const maxIter = opts.mode === 'fixed' ? opts.passes : opts.maxPasses;

      // ── Live probe progress tracking ──────────────────────────────────
      // Watch move.probing transitions in the cached model — zero extra HTTP calls.
      let probesDone = 0;
      let wasProbing = false;
      let probesPerRunLearned: number | null = null;

      const probeTracker = service ? setInterval(() => {
        const isProbing = service.getModel().move?.probing ?? false;
        if (wasProbing && !isProbing) {
          probesDone++;
          setProbeProgress((prev) => prev ? { ...prev, done: probesDone, total: probesPerRunLearned } : null);
        }
        wasProbing = isProbing;
      }, 200) : null;

      try {
        for (let i = 0; i < maxIter; i++) {
          // Reset per-pass counters
          probesDone = 0;
          wasProbing = false;
          setProbeProgress({ pass: i + 1, totalPasses: maxIter, done: 0, total: probesPerRunLearned });

          await probeGrid();
          passCount++;

          if (probesDone > 0 && probesPerRunLearned === null) {
            probesPerRunLearned = probesDone;
          }

          const curr = usePrinterStore.getState().heightMap;
          if (opts.mode === 'converge' && prevMap && curr) {
            if (computeMeshRmsDiff(prevMap, curr) <= opts.targetDiff) break;
          }
          if (curr) prevMap = curr;
        }
      } finally {
        if (probeTracker !== null) clearInterval(probeTracker);
        setProbeProgress(null);
      }

      // Always open the results modal — pass null stats if the map isn't available
      // (e.g. getHeightMap failed or returned empty), so the user sees the "no data"
      // fallback rather than just stale gcode-command toasts.
      const finalMap = usePrinterStore.getState().heightMap;
      setProbeResult({ stats: finalMap ? computeStats(finalMap) : null, passes: passCount });
      setShowProbeResultModal(true);
    } catch {
      setLoadError('Probing failed');
      addToast('error', 'Probing failed', 'The probe sequence did not complete.');
    } finally {
      if (shouldRestoreProbeSamples) {
        try { await sendGCode(`M558 A${prevProbeA} S${prevProbeS}`); } catch { /* best-effort cleanup */ }
      }
      setProbing(false);
    }
  }, [boardType, m557Command, probeGrid, probeXMin, probeXMax, probeYMin, probeYMax, sendGCode, service]);

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

  const handleLevelBed = useCallback(async (opts: LevelBedOpts) => {
    setShowLevelModal(false);
    setLeveling(true);
    try {
      await levelBed(opts);
    } catch (err) {
      addToast('error', 'Level bed failed', (err as Error).message, undefined, 15_000);
    } finally {
      setLeveling(false);
    }
  }, [levelBed]);


  /** Closed-loop calibration: level → probe → diagnose → repeat. */
  const runSmartCal = useCallback(async (opts: SmartCalOpts) => {
    setShowSmartCalModal(false);
    setSmartCalRunning(true);
    setSmartCalPhase(null);
    setSmartCalResult(null);

    const steps: SmartCalStep[] = [];
    let finalStats: HeightMapStats | null = null;
    let stopReason: SmartCalResult['stopReason'] = 'maxIterations';
    let shouldLevel = true;

    // Snapshot the firmware's current M558 so we can restore the user's
    // baseline in `finally` — survives any throw mid-sequence.
    const liveProbe = service?.getModel().sensors?.probes?.[0];
    const prevProbeA = liveProbe?.maxProbeCount ?? 1;
    const prevProbeS = liveProbe?.tolerance ?? 0.01;
    const m558Modified = opts.probesPerPoint > 1;

    try {
      if (opts.homeFirst) {
        setSmartCalPhase('homing');
        await sendGCode('G28');
        steps.push({ kind: 'info', label: 'Homed all axes', quality: 'info' });
      }

      // Set the requested probe sampling once for the whole closed loop.
      if (m558Modified) {
        await sendGCode(`M558 A${opts.probesPerPoint} S${opts.probeTolerance}`);
      }

      for (let i = 0; i < opts.maxIterations; i++) {
        /* ── Level ── */
        if (shouldLevel) {
          setSmartCalPhase('leveling');
          try {
            await levelBed({ homeFirst: false });
            steps.push({ kind: 'level', label: `Bed leveled (iteration ${i + 1})`, quality: 'good' });
          } catch (err) {
            steps.push({ kind: 'level', label: 'Leveling failed', detail: (err as Error).message, quality: 'bad' });
            stopReason = 'failed';
            break;
          }
          shouldLevel = false;
        }

        /* ── Probe ── */
        setSmartCalPhase('probing');
        try {
          await sendGCode(m557Command);
          await probeGrid();
        } catch (err) {
          steps.push({ kind: 'probe', label: `Probe failed (iteration ${i + 1})`, detail: (err as Error).message, quality: 'bad' });
          stopReason = 'failed';
          break;
        }

        /* ── Analyse ── */
        const currentMap = usePrinterStore.getState().heightMap;
        if (!currentMap) {
          steps.push({ kind: 'probe', label: 'No probe data returned', quality: 'bad' });
          stopReason = 'failed';
          break;
        }
        const s = computeStats(currentMap);
        finalStats = s;
        const meanBad = Math.abs(s.mean) >= opts.targetMean;
        const devBad  = s.rms             >= opts.targetDeviation;
        steps.push({
          kind:    'probe',
          label:   `Probed (iteration ${i + 1}) — RMS ${s.rms.toFixed(4)} mm · mean ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)} mm`,
          quality: (!meanBad && !devBad) ? 'good' : 'warn',
        });

        if (!meanBad && !devBad) {
          steps.push({ kind: 'done', label: 'Bed calibrated — within all targets ✓', quality: 'good' });
          stopReason = 'converged';
          break;
        }

        /* ── Z datum recalibration ── */
        if (meanBad) {
          setSmartCalPhase('datum');
          const cx = ((probeXMin + probeXMax) / 2).toFixed(1);
          const cy = ((probeYMin + probeYMax) / 2).toFixed(1);
          try {
            if (service) {
              await service.sendGCode(`G1 X${cx} Y${cy} F6000`);
              await service.sendGCode('G30 S-1');
            } else {
              await sendGCode(`G1 X${cx} Y${cy} F6000`);
              await sendGCode('G30 S-1');
            }
            steps.push({
              kind:   'datum',
              label:  `Z datum recalibrated at centre (${cx}, ${cy})`,
              detail: `Mean was ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)} mm — target ±${opts.targetMean.toFixed(2)} mm`,
              quality: 'info',
            });
          } catch (err) {
            steps.push({ kind: 'datum', label: 'Z datum calibration failed', detail: (err as Error).message, quality: 'bad' });
          }
        }

        /* ── Re-level decision ── */
        if (devBad) {
          steps.push({
            kind:   'decision',
            label:  `RMS ${s.rms.toFixed(4)} mm exceeds target ${opts.targetDeviation.toFixed(2)} mm — will re-level`,
            quality: 'warn',
          });
          shouldLevel = true;
        }

        if (i === opts.maxIterations - 1) {
          steps.push({ kind: 'done', label: `Max iterations (${opts.maxIterations}) reached`, quality: 'warn' });
        }
      }
    } catch (err) {
      steps.push({ kind: 'done', label: `Smart Cal error: ${(err as Error).message}`, quality: 'bad' });
      stopReason = 'failed';
    } finally {
      // Restore M558 even when the closed loop bailed mid-iteration.
      if (m558Modified) {
        try { await sendGCode(`M558 A${prevProbeA} S${prevProbeS}`); } catch { /* best-effort cleanup */ }
      }
      setSmartCalRunning(false);
      setSmartCalPhase(null);
    }

    const result: SmartCalResult = { steps, finalStats, stopReason };
    setSmartCalResult(result);
    setShowSmartCalResultModal(true);
  }, [levelBed, m557Command, probeGrid, probeXMin, probeXMax, probeYMin, probeYMax, sendGCode, service]);

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
        runProbe={(opts) => void runProbe(opts)}
        closeLevel={() => setShowLevelModal(false)}
        runLevel={(opts) => void handleLevelBed(opts)}
        closeSmartCal={() => setShowSmartCalModal(false)}
        runSmartCal={(opts) => void runSmartCal(opts)}
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

      {/* ── Compare banner ────────────────────────────────────────────── */}
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

      {/* ── Split: viewport + sidebar ─────────────────────────────────────── */}
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

        {/* ── Sidebar ───────────────────────────────────────────── */}
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
          m557Copied={m557Copied}
          setM557Copied={setM557Copied}
          m557CopyTimerRef={m557CopyTimerRef}
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

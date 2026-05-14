/**
 * useHeightMapRunners — owns the probe / level / smart-cal runner state and
 * the long-running async sequences that drive them.
 *
 * Splitting this out of DuetHeightMap keeps the component focused on layout
 * and prop wiring, and isolates the M558-snapshot/restore + probe-progress
 * tracking machinery in one place.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { addToast } from '../../../../store/toastStore';
import {
  usePrinterStore,
  type LevelBedOpts,
} from '../../../../store/printerStore';
import type { DuetService } from '../../../../services/DuetService';
import type { DuetHeightMap as HeightMapData, PrinterBoardType } from '../../../../types/duet';
import { computeMeshRmsDiff, computeStats, type HeightMapStats } from '../utils';
import type { ProbeOpts, SmartCalOpts, SmartCalResult, SmartCalStep } from '../types';

export interface ProbeProgress {
  pass: number;
  totalPasses: number;
  done: number;
  total: number | null;
}

export type SmartCalPhase = 'homing' | 'leveling' | 'probing' | 'datum' | null;

export interface ProbeResult {
  stats: HeightMapStats | null;
  passes: number;
}

export interface HeightMapRunnersDeps {
  service: DuetService | null;
  sendGCode: (code: string) => Promise<void>;
  probeGrid: () => Promise<void>;
  levelBed: (opts?: LevelBedOpts) => Promise<unknown>;
  m557Command: string;
  probeXMin: number;
  probeXMax: number;
  probeYMin: number;
  probeYMax: number;
  boardType: PrinterBoardType | undefined;
  setLoadError: (msg: string | null) => void;
}

export interface HeightMapRunnersApi {
  // Probe
  probing: boolean;
  probeProgress: ProbeProgress | null;
  probeResult: ProbeResult | null;
  showProbeResultModal: boolean;
  setShowProbeResultModal: (b: boolean) => void;
  runProbe: (opts: ProbeOpts) => Promise<void>;

  // Level
  leveling: boolean;
  runLevel: (opts: LevelBedOpts) => Promise<void>;

  // Smart Cal
  smartCalRunning: boolean;
  smartCalPhase: SmartCalPhase;
  smartCalResult: SmartCalResult | null;
  smartCalLiveSteps: SmartCalStep[];
  showSmartCalResultModal: boolean;
  setShowSmartCalResultModal: (b: boolean) => void;
  runSmartCal: (opts: SmartCalOpts) => Promise<void>;
  clearSmartCalResult: () => void;
}

export function useHeightMapRunners(deps: HeightMapRunnersDeps): HeightMapRunnersApi {
  const {
    service, sendGCode, probeGrid, levelBed,
    m557Command, probeXMin, probeXMax, probeYMin, probeYMax,
    boardType, setLoadError,
  } = deps;

  const setSuppressPrinterAlerts = usePrinterStore((s) => s.setSuppressPrinterAlerts);

  // Probe state
  const [probing, setProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState<ProbeProgress | null>(null);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [showProbeResultModal, setShowProbeResultModal] = useState(false);

  // Level state
  const [leveling, setLeveling] = useState(false);

  // Smart Cal state
  const [smartCalRunning, setSmartCalRunning] = useState(false);
  const [smartCalPhase, setSmartCalPhase] = useState<SmartCalPhase>(null);
  const [smartCalResult, setSmartCalResult] = useState<SmartCalResult | null>(null);
  const [smartCalLiveSteps, setSmartCalLiveSteps] = useState<SmartCalStep[]>([]);
  const [showSmartCalResultModal, setShowSmartCalResultModal] = useState(false);

  // Guards against (a) setState after unmount mid-sequence and (b) re-entry
  // when the same runner is invoked twice before the first finishes (e.g.
  // two callers, or a keystroke during a long probe).
  //
  // NOTE: the effect body must set mountedRef.current = true so that React
  // Strict Mode's intentional unmount→remount cycle doesn't leave the ref
  // permanently false (cleanup fires on the simulated unmount; without the
  // reset inside the body the ref is false for the entire real lifetime).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const probeInFlightRef = useRef(false);
  const smartCalInFlightRef = useRef(false);
  const levelInFlightRef = useRef(false);

  const runProbe = useCallback(async (opts: ProbeOpts) => {
    if (probeInFlightRef.current) return;
    probeInFlightRef.current = true;
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
        if (service) {
          await service.sendGCode(`G1 X${cx} Y${cy} F6000`);
          await service.sendGCode('G30 S-1');
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

      if (shouldRestoreProbeSamples) await sendGCode(`M558 A${opts.probesPerPoint} S${opts.probeTolerance ?? 0.01}`);

      let prevMap: HeightMapData | null = null;
      const maxIter = opts.mode === 'fixed' ? opts.passes : opts.maxPasses;

      // Live probe progress: watch move.probing transitions in the cached
      // model so we don't add extra HTTP traffic during the sequence.
      let probesDone = 0;
      let wasProbing = false;
      let probesPerRunLearned: number | null = null;

      const probeTracker = service ? setInterval(() => {
        if (!mountedRef.current) return;
        const isProbing = service.getModel().move?.probing ?? false;
        if (wasProbing && !isProbing) {
          probesDone++;
          setProbeProgress((prev) => prev ? { ...prev, done: probesDone, total: probesPerRunLearned } : null);
        }
        wasProbing = isProbing;
      }, 200) : null;

      try {
        for (let i = 0; i < maxIter; i++) {
          probesDone = 0;
          wasProbing = false;
          if (mountedRef.current) {
            setProbeProgress({ pass: i + 1, totalPasses: maxIter, done: 0, total: probesPerRunLearned });
          }

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
        if (mountedRef.current) setProbeProgress(null);
      }

      // Always open the results modal — pass null stats if the map isn't
      // available so the user sees the "no data" fallback rather than just
      // stale gcode-command toasts.
      if (mountedRef.current) {
        const finalMap = usePrinterStore.getState().heightMap;
        setProbeResult({ stats: finalMap ? computeStats(finalMap) : null, passes: passCount });
        setShowProbeResultModal(true);
      }
    } catch {
      if (mountedRef.current) setLoadError('Probing failed');
      addToast('error', 'Probing failed', 'The probe sequence did not complete.');
    } finally {
      if (shouldRestoreProbeSamples) {
        try { await sendGCode(`M558 A${prevProbeA} S${prevProbeS}`); } catch { /* best-effort cleanup */ }
      }
      if (mountedRef.current) setProbing(false);
      probeInFlightRef.current = false;
    }
  }, [boardType, m557Command, probeGrid, sendGCode, service, setLoadError]);

  const runLevel = useCallback(async (opts: LevelBedOpts) => {
    if (levelInFlightRef.current) return;
    levelInFlightRef.current = true;
    setLeveling(true);
    try {
      await levelBed(opts);
    } catch (err) {
      addToast('error', 'Level bed failed', (err as Error).message, undefined, 15_000);
    } finally {
      if (mountedRef.current) setLeveling(false);
      levelInFlightRef.current = false;
    }
  }, [levelBed]);

  /** Closed-loop calibration: level → probe → diagnose → repeat. */
  const runSmartCal = useCallback(async (opts: SmartCalOpts) => {
    if (smartCalInFlightRef.current) return;
    smartCalInFlightRef.current = true;
    setSmartCalRunning(true);
    setSmartCalPhase(null);
    setSmartCalResult(null);

    // Reset live steps before starting
    setSmartCalLiveSteps([]);
    setSuppressPrinterAlerts(true);

    const steps: SmartCalStep[] = [];
    const pushStep = (step: SmartCalStep) => {
      steps.push(step);
      if (mountedRef.current) setSmartCalLiveSteps([...steps]);
    };

    let finalStats: HeightMapStats | null = null;
    let stopReason: SmartCalResult['stopReason'] = 'maxIterations';
    let shouldLevel = true;
    let levelPassCount = 0;

    // Snapshot current M558 so we restore the user's baseline in `finally` —
    // survives any throw mid-sequence.
    const liveProbe = service?.getModel().sensors?.probes?.[0];
    const prevProbeA = liveProbe?.maxProbeCount ?? 1;
    const prevProbeS = liveProbe?.tolerance ?? 0.01;
    const m558Modified = opts.probesPerPoint > 1;

    try {
      console.log('[SmartCal] Starting — opts:', opts);

      if (opts.homeFirst) {
        if (mountedRef.current) setSmartCalPhase('homing');
        console.log('[SmartCal] Homing all axes…');
        await sendGCode('G28');
        pushStep({ kind: 'info', label: 'Homed all axes', quality: 'info' });
        console.log('[SmartCal] Homing complete.');
      }

      if (m558Modified) {
        await sendGCode(`M558 A${opts.probesPerPoint} S${opts.probeTolerance}`);
      }

      for (let i = 0; i < opts.maxIterations; i++) {
        console.log(`[SmartCal] ── Iteration ${i + 1} / ${opts.maxIterations} ──`);

        /* ── Level ── */
        if (shouldLevel) {
          if (levelPassCount >= opts.maxLevelPasses) {
            console.log(`[SmartCal] Level pass skipped — reached max level passes (${opts.maxLevelPasses}).`);
            pushStep({
              kind:    'decision',
              label:   `Leveling budget exhausted (${opts.maxLevelPasses} of ${opts.maxLevelPasses} passes used)`,
              quality: 'warn',
            });
          } else {
            levelPassCount++;
            console.log(`[SmartCal] Leveling bed (level pass ${levelPassCount} / ${opts.maxLevelPasses})…`);
            if (mountedRef.current) setSmartCalPhase('leveling');
            try {
              const levelSummary = await levelBed({
                homeFirst:      false,
                repeat:         1,
                autoConverge:   false,
                probesPerPoint: opts.probesPerPoint,
                probeTolerance: opts.probeTolerance,
                suppressResult: true,
              });
              const lastRun = (levelSummary as { results?: Array<{ deviationBefore: number | null }> }).results?.at(-1);
              const devBefore = lastRun?.deviationBefore;
              pushStep({
                kind:    'level',
                label:   `Bed leveled (pass ${levelPassCount} of ${opts.maxLevelPasses})`,
                detail:  devBefore != null && devBefore > 0
                  ? `Tilt before adjustment: ${devBefore.toFixed(4)} mm`
                  : undefined,
                quality: 'good',
              });
              console.log('[SmartCal] Leveling complete.');
            } catch (err) {
              console.warn('[SmartCal] Leveling failed:', err);
              pushStep({ kind: 'level', label: 'Leveling failed', detail: (err as Error).message, quality: 'bad' });
              stopReason = 'failed';
              break;
            }
          }
          shouldLevel = false;
        }

        /* ── Probe ── */
        console.log(`[SmartCal] Probing mesh (iteration ${i + 1}, ${opts.probePasses} pass${opts.probePasses > 1 ? 'es' : ''})…`);
        if (mountedRef.current) setSmartCalPhase('probing');
        try {
          await sendGCode(m557Command);
          for (let p = 0; p < opts.probePasses; p++) {
            await probeGrid();
          }
        } catch (err) {
          console.warn('[SmartCal] Probe failed:', err);
          pushStep({ kind: 'probe', label: `Probe failed (iteration ${i + 1})`, detail: (err as Error).message, quality: 'bad' });
          stopReason = 'failed';
          break;
        }

        /* ── Analyse ── */
        const currentMap = usePrinterStore.getState().heightMap;
        if (!currentMap) {
          console.warn('[SmartCal] No height map data after probe.');
          pushStep({ kind: 'probe', label: 'No probe data returned', quality: 'bad' });
          stopReason = 'failed';
          break;
        }
        const s = computeStats(currentMap);
        finalStats = s;
        const meanBad = Math.abs(s.mean) >= opts.targetMean;
        const devBad  = s.rms             >= opts.targetDeviation;

        console.log(
          `[SmartCal] Iteration ${i + 1} results — RMS: ${s.rms.toFixed(4)} mm (target <${opts.targetDeviation}),` +
          ` mean: ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)} mm (target <±${opts.targetMean})` +
          ` | meanBad=${meanBad}, devBad=${devBad}`,
        );

        pushStep({
          kind:    'probe',
          label:   `Probed (iteration ${i + 1}${opts.probePasses > 1 ? `, ${opts.probePasses} passes` : ''}) — RMS ${s.rms.toFixed(4)} mm · mean ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)} mm`,
          quality: (!meanBad && !devBad) ? 'good' : 'warn',
        });

        if (!meanBad && !devBad) {
          console.log('[SmartCal] Converged — all targets met.');
          pushStep({ kind: 'done', label: 'Bed calibrated — within all targets ✓', quality: 'good' });
          stopReason = 'converged';
          break;
        }

        /* ── Z datum recalibration ── */
        if (meanBad) {
          console.log(`[SmartCal] Mean offset ${s.mean.toFixed(3)} mm exceeds ±${opts.targetMean} mm — recalibrating Z datum…`);
          if (mountedRef.current) setSmartCalPhase('datum');
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
            console.log(`[SmartCal] Z datum recalibrated at centre (${cx}, ${cy}).`);
            pushStep({
              kind:   'datum',
              label:  `Z datum recalibrated at centre (${cx}, ${cy})`,
              detail: `Mean was ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)} mm — target ±${opts.targetMean.toFixed(2)} mm`,
              quality: 'info',
            });
          } catch (err) {
            console.warn('[SmartCal] Z datum calibration failed:', err);
            pushStep({ kind: 'datum', label: 'Z datum calibration failed', detail: (err as Error).message, quality: 'bad' });
          }
        }

        /* ── Re-level decision ── */
        if (devBad) {
          if (levelPassCount < opts.maxLevelPasses) {
            console.log(`[SmartCal] RMS ${s.rms.toFixed(4)} mm exceeds target ${opts.targetDeviation.toFixed(2)} mm — scheduling re-level.`);
            pushStep({
              kind:   'decision',
              label:  `RMS ${s.rms.toFixed(4)} mm exceeds target ${opts.targetDeviation.toFixed(2)} mm — will re-level`,
              quality: 'warn',
            });
            shouldLevel = true;
          } else {
            console.log(`[SmartCal] RMS still high but max level passes (${opts.maxLevelPasses}) reached — continuing without re-level.`);
            pushStep({
              kind:    'decision',
              label:   `RMS ${s.rms.toFixed(4)} mm exceeds target — leveling budget exhausted (${opts.maxLevelPasses} ${opts.maxLevelPasses === 1 ? 'pass' : 'passes'} used)`,
              quality: 'warn',
            });
          }
        } else {
          // RMS is within target — no re-level needed this iteration.
          // Only log when there are more iterations to run (converged case
          // already broke out of the loop with its own "all targets met" step).
          if (i < opts.maxIterations - 1) {
            console.log(`[SmartCal] RMS ${s.rms.toFixed(4)} mm within target — no re-level needed.`);
            pushStep({
              kind:    'decision',
              label:   `RMS ${s.rms.toFixed(4)} mm within target — skipping re-level`,
              quality: 'good',
            });
          }
        }
      }
    } catch (err) {
      console.error('[SmartCal] Unhandled error:', err);
      pushStep({ kind: 'done', label: `Smart Cal error: ${(err as Error).message}`, quality: 'bad' });
      stopReason = 'failed';
    } finally {
      console.log(`[SmartCal] Done — stopReason: ${stopReason}, levelPasses: ${levelPassCount}, steps: ${steps.length}`);

      setSuppressPrinterAlerts(false);

      // Restore M558 even when the closed loop bailed mid-iteration.
      if (m558Modified) {
        try { await sendGCode(`M558 A${prevProbeA} S${prevProbeS}`); } catch { /* best-effort cleanup */ }
      }
      // Result setters live INSIDE finally — they need to run on the error
      // path too, and they need to be guarded by mountedRef so a navigate-
      // away mid-iteration doesn't write into an unmounted component.
      if (mountedRef.current) {
        setSmartCalResult({ steps, finalStats, stopReason });
        setShowSmartCalResultModal(true);
        setSmartCalRunning(false);
        setSmartCalPhase(null);
      }
      smartCalInFlightRef.current = false;
    }
  }, [levelBed, m557Command, probeGrid, sendGCode, service, setSuppressPrinterAlerts]);

  const clearSmartCalResult = useCallback(() => {
    setSmartCalResult(null);
    setSmartCalLiveSteps([]);
  }, []);

  return {
    probing, probeProgress, probeResult,
    showProbeResultModal, setShowProbeResultModal,
    runProbe,
    leveling,
    runLevel,
    smartCalRunning, smartCalPhase, smartCalResult, smartCalLiveSteps,
    showSmartCalResultModal, setShowSmartCalResultModal,
    runSmartCal,
    clearSmartCalResult,
  };
}

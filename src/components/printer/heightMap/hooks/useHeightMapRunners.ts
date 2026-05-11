/**
 * useHeightMapRunners — owns the probe / level / smart-cal runner state and
 * the long-running async sequences that drive them.
 *
 * Splitting this out of DuetHeightMap keeps the component focused on layout
 * and prop wiring, and isolates the M558-snapshot/restore + probe-progress
 * tracking machinery in one place.
 */

import { useCallback, useState } from 'react';
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
  showSmartCalResultModal: boolean;
  setShowSmartCalResultModal: (b: boolean) => void;
  runSmartCal: (opts: SmartCalOpts) => Promise<void>;
}

export function useHeightMapRunners(deps: HeightMapRunnersDeps): HeightMapRunnersApi {
  const {
    service, sendGCode, probeGrid, levelBed,
    m557Command, probeXMin, probeXMax, probeYMin, probeYMax,
    boardType, setLoadError,
  } = deps;

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
  const [showSmartCalResultModal, setShowSmartCalResultModal] = useState(false);

  const runProbe = useCallback(async (opts: ProbeOpts) => {
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

      if (shouldRestoreProbeSamples) await sendGCode(`M558 A${opts.probesPerPoint} S${opts.probeTolerance}`);

      let prevMap: HeightMapData | null = null;
      const maxIter = opts.mode === 'fixed' ? opts.passes : opts.maxPasses;

      // Live probe progress: watch move.probing transitions in the cached
      // model so we don't add extra HTTP traffic during the sequence.
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

      // Always open the results modal — pass null stats if the map isn't
      // available so the user sees the "no data" fallback rather than just
      // stale gcode-command toasts.
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
  }, [boardType, m557Command, probeGrid, probeXMin, probeXMax, probeYMin, probeYMax, sendGCode, service, setLoadError]);

  const runLevel = useCallback(async (opts: LevelBedOpts) => {
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
    setSmartCalRunning(true);
    setSmartCalPhase(null);
    setSmartCalResult(null);

    const steps: SmartCalStep[] = [];
    let finalStats: HeightMapStats | null = null;
    let stopReason: SmartCalResult['stopReason'] = 'maxIterations';
    let shouldLevel = true;

    // Snapshot current M558 so we restore the user's baseline in `finally` —
    // survives any throw mid-sequence.
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

    setSmartCalResult({ steps, finalStats, stopReason });
    setShowSmartCalResultModal(true);
  }, [levelBed, m557Command, probeGrid, probeXMin, probeXMax, probeYMin, probeYMax, sendGCode, service]);

  return {
    probing, probeProgress, probeResult,
    showProbeResultModal, setShowProbeResultModal,
    runProbe,
    leveling,
    runLevel,
    smartCalRunning, smartCalPhase, smartCalResult,
    showSmartCalResultModal, setShowSmartCalResultModal,
    runSmartCal,
  };
}

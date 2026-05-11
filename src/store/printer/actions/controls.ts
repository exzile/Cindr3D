import type { PrinterStore, LevelRunResult, LevelBedOpts, LevelBedSummary, LevelBedStopReason } from '../../printerStore';
import type { PrinterStoreApi } from '../storeApi';
import type { DuetService } from '../../../services/DuetService';
import { parseEventLog } from '../persistence';

/** Poll state.status until the machine returns to idle after an async G-code.
 *
 * Uses the SERVICE'S CACHED MODEL (updated by its background polling loop)
 * rather than making independent rr_model HTTP requests.  Making our own
 * rr_model calls in diff-mode (d99fn) would corrupt the polling loop's
 * server-side diff pointer, causing it to miss updates and accumulate errors
 * that can stop the loop entirely — which in turn kills firmwareMessage
 * emission and leaves levelBed with no reply data.
 *
 * @param initialDelayMs  Wait this long before the first check.
 * @param requireBusy     When true, don't exit on consecutive-idle alone;
 *   wait until the machine has been seen as non-idle at least once first.
 *   Falls through after NEVER_BUSY_TIMEOUT_MS if the machine never goes busy.
 */
function waitUntilIdle(
  service: DuetService,
  initialDelayMs = 1_000,
  requireBusy    = false,
): Promise<void> {
  const CHECK_INTERVAL        = 500;
  const TIMEOUT_MS            = 15 * 60 * 1_000;
  const MAX_IDLE_STREAK       = 6;       // 6 × 500 ms = 3 s of consecutive idle → done
  const NEVER_BUSY_TIMEOUT_MS = 12_000;  // if machine never goes busy, fall through after 12 s

  return new Promise<void>((resolve) => {
    let seenBusy   = false;
    let idleStreak = 0;
    const deadline     = Date.now() + TIMEOUT_MS;
    const busyDeadline = Date.now() + NEVER_BUSY_TIMEOUT_MS;

    const start = (): void => {
      const tick = setInterval(() => {
        // Read from the already-cached model — zero extra HTTP calls.
        const cached = service.getModel();
        const status = (cached.state as { status?: string } | undefined)?.status ?? 'idle';

        if (status !== 'idle') {
          seenBusy   = true;
          idleStreak = 0;
        } else {
          idleStreak++;
          const canExitOnStreak = !requireBusy || Date.now() > busyDeadline;
          if ((seenBusy || canExitOnStreak) && idleStreak >= MAX_IDLE_STREAK) {
            clearInterval(tick);
            resolve();
            return;
          }
        }

        if (Date.now() > deadline) {
          clearInterval(tick);
          resolve();
        }
      }, CHECK_INTERVAL);
    };

    if (initialDelayMs <= 0) {
      start();
    } else {
      setTimeout(start, initialDelayMs);
    }
  });
}

export function createControlActions(
  { get, set }: PrinterStoreApi,
): Pick<
  PrinterStore,
  | 'setToolTemp'
  | 'setBedTemp'
  | 'setChamberTemp'
  | 'homeAxes'
  | 'moveAxis'
  | 'extrude'
  | 'setBabyStep'
  | 'setSpeedFactor'
  | 'setExtrusionFactor'
  | 'setGlobalFlowFactor'
  | 'setFanSpeed'
  | 'startPrint'
  | 'pausePrint'
  | 'resumePrint'
  | 'cancelPrint'
  | 'cancelObject'
  | 'emergencyStop'
  | 'refreshFilaments'
  | 'loadFilament'
  | 'unloadFilament'
  | 'changeFilament'
  | 'uploadFirmware'
  | 'installFirmware'
  | 'refreshPrintHistory'
  | 'loadHeightMap'
  | 'probeGrid'
  | 'levelBed'
> {
  return {
    setToolTemp: async (tool, _heater, temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`G10 P${tool} S${temp}`); }
      catch (err) { set({ error: `Failed to set tool temp: ${(err as Error).message}` }); }
    },
    setBedTemp: async (temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M140 S${temp}`); }
      catch (err) { set({ error: `Failed to set bed temp: ${(err as Error).message}` }); }
    },
    setChamberTemp: async (temp) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M141 S${temp}`); }
      catch (err) { set({ error: `Failed to set chamber temp: ${(err as Error).message}` }); }
    },
    homeAxes: async (axes) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(!axes || axes.length === 0 ? 'G28' : `G28 ${axes.join(' ')}`); }
      catch (err) { set({ error: `Failed to home axes: ${(err as Error).message}` }); }
    },
    moveAxis: async (axis, distance) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('G91');
        await service.sendGCode(`G1 ${axis.toUpperCase()}${distance} F6000`);
        await service.sendGCode('G90');
      } catch (err) { set({ error: `Failed to move axis: ${(err as Error).message}` }); }
    },
    extrude: async (amount, feedrate) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('M83');
        await service.sendGCode(`G1 E${amount} F${feedrate}`);
      } catch (err) { set({ error: `Failed to extrude: ${(err as Error).message}` }); }
    },
    setBabyStep: async (offset) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M290 S${offset}`); }
      catch (err) { set({ error: `Failed to set baby step: ${(err as Error).message}` }); }
    },
    setSpeedFactor: async (percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M220 S${percent}`); }
      catch (err) { set({ error: `Failed to set speed factor: ${(err as Error).message}` }); }
    },
    setExtrusionFactor: async (extruder, percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M221 D${extruder} S${percent}`); }
      catch (err) { set({ error: `Failed to set extrusion factor: ${(err as Error).message}` }); }
    },
    setGlobalFlowFactor: async (percent) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M221 D-1 S${percent}`); }
      catch (err) { set({ error: `Failed to set global flow factor: ${(err as Error).message}` }); }
    },
    setFanSpeed: async (fan, speed) => {
      const { service } = get(); if (!service) return;
      try {
        const duetSpeed = speed > 1 ? speed / 100 : speed;
        await service.sendGCode(`M106 P${fan} S${duetSpeed}`);
      } catch (err) { set({ error: `Failed to set fan speed: ${(err as Error).message}` }); }
    },
    startPrint: async (filename) => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode(`M32 "${filename}"`); }
      catch (err) { set({ error: `Failed to start print: ${(err as Error).message}` }); }
    },
    pausePrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M25'); }
      catch (err) { set({ error: `Failed to pause print: ${(err as Error).message}` }); }
    },
    resumePrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M24'); }
      catch (err) { set({ error: `Failed to resume print: ${(err as Error).message}` }); }
    },
    cancelPrint: async () => {
      const { service } = get(); if (!service) return;
      try { await service.sendGCode('M0'); }
      catch (err) { set({ error: `Failed to cancel print: ${(err as Error).message}` }); }
    },
    cancelObject: async (index) => {
      const { service } = get(); if (!service) return;
      try { await service.cancelObject(index); }
      catch (err) { set({ error: `Failed to cancel object: ${(err as Error).message}` }); }
    },
    emergencyStop: async () => {
      const { service } = get(); if (!service) return;
      try { await service.emergencyStop(); }
      catch (err) { set({ error: `Emergency stop failed: ${(err as Error).message}` }); }
    },
    refreshFilaments: async () => {
      const { service } = get(); if (!service) return;
      try {
        const entries = await service.listFiles('0:/filaments');
        set({ filaments: entries.filter((entry: { type: string }) => entry.type === 'd').map((entry: { name: string }) => entry.name).sort() });
      } catch (err) { set({ error: `Failed to list filaments: ${(err as Error).message}` }); }
    },
    loadFilament: async (toolNumber, name) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode(`M701 S"${name}"`);
      } catch (err) { set({ error: `Failed to load filament: ${(err as Error).message}` }); }
    },
    unloadFilament: async (toolNumber) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode('M702');
      } catch (err) { set({ error: `Failed to unload filament: ${(err as Error).message}` }); }
    },
    changeFilament: async (toolNumber, name) => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode(`T${toolNumber}`);
        await service.sendGCode('M702');
        await service.sendGCode(`M701 S"${name}"`);
      } catch (err) { set({ error: `Failed to change filament: ${(err as Error).message}` }); }
    },
    uploadFirmware: async (file) => {
      const { service } = get(); if (!service) return;
      set({ uploading: true, uploadProgress: 0, error: null });
      try {
        await service.uploadFile(`0:/firmware/${file.name}`, file, (progress: number) => set({ uploadProgress: progress }));
        set({ uploading: false, uploadProgress: 100 });
      } catch (err) {
        set({ uploading: false, uploadProgress: 0, error: `Firmware upload failed: ${(err as Error).message}` });
        throw err;
      }
    },
    installFirmware: async () => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('M997');
        set({ firmwareUpdatePending: true });
      } catch (err) { set({ error: `Failed to trigger firmware install: ${(err as Error).message}` }); }
    },
    refreshPrintHistory: async () => {
      const { service } = get(); if (!service) return;
      set({ printHistoryLoading: true });
      try {
        const blob = await service.downloadFile('0:/sys/eventlog.txt');
        const text = await blob.text();
        set({ printHistory: parseEventLog(text), printHistoryLoading: false });
      } catch (err) {
        set({ printHistory: [], printHistoryLoading: false, error: `Failed to load print history: ${(err as Error).message}` });
      }
    },
    loadHeightMap: async (path) => {
      const { service } = get(); if (!service) return;
      try { set({ heightMap: await service.getHeightMap(path) }); }
      catch (err) { set({ error: `Failed to load height map: ${(err as Error).message}` }); }
    },
    probeGrid: async () => {
      const { service } = get(); if (!service) return;
      try {
        await service.sendGCode('G29');
        await waitUntilIdle(service);
        set({ heightMap: await service.getHeightMap() });
      } catch (err) { set({ error: `Failed to probe grid: ${(err as Error).message}` }); }
    },
    levelBed: async (opts: LevelBedOpts = {}): Promise<LevelBedSummary> => {
      const {
        homeFirst       = false,
        repeat          = 1,
        autoConverge    = false,
        maxPasses       = 5,
        targetDeviation = 0.05,
        probesPerPoint  = 1,
        probeTolerance  = 0.05,
      } = opts;
      const { service, config } = get();
      const emptySummary = (reason: LevelBedStopReason): LevelBedSummary => ({
        results: [], autoConverge, stopReason: reason, targetDeviation,
      });
      if (!service) return emptySummary('fixed');

      const results: LevelRunResult[] = [];
      // SBC: sendGCode blocks until the macro finishes and returns its full output.
      // Standalone HTTP: fire-and-forget — output arrives via firmwareMessage polling.
      // Serial/USB: same as SBC (sendGCode returns output synchronously).
      const isSbc = config.mode === 'sbc';

      // Auto mode runs up to maxPasses (minimum 2 — pass 1 corrects, pass 2 verifies).
      // Fixed mode runs exactly repeat passes.
      const maxRuns = autoConverge ? Math.max(2, maxPasses) : Math.max(1, repeat);
      // Probe total per run: learned from the first completed run and reused for subsequent ones.
      let probesPerRunLearned: number | null = null;
      // Stop when relative improvement < 15% OR absolute improvement < 3 µm.
      // The absolute floor prevents spurious "25% improvement!" when both values
      // are already within the noise floor (e.g. 0.008 → 0.006 mm = 2 µm).
      const CONVERGENCE_THRESHOLD   = 0.15;   // 15% relative
      const MIN_ABS_IMPROVEMENT_MM  = 0.003;  // 3 µm absolute
      let stopReason: LevelBedStopReason = autoConverge ? 'maxPasses' : 'fixed';

      try {
        if (homeFirst) await service.sendGCode('G28');
        if (probesPerPoint > 1) await service.sendGCode(`M558 A${probesPerPoint} S${probeTolerance}`);

        for (let i = 0; i < maxRuns; i++) {
          // ── Live run/probe progress ───────────────────────────────────────
          let probesDone = 0;
          let wasProbing = false;
          set({
            levelBedProgress: {
              currentRun: i + 1,
              totalRuns: maxRuns,
              probesDone: 0,
              probesTotal: probesPerRunLearned,
            },
          });

          // Count probe completions by watching move.probing transitions in the
          // already-cached service model — no extra HTTP calls.
          const probeTracker = setInterval(() => {
            const m = service.getModel() as Record<string, unknown>;
            const mv = m.move as Record<string, unknown> | undefined;
            const isProbing = (mv?.probing as boolean | undefined) ?? false;
            if (wasProbing && !isProbing) {
              probesDone++;
              set({
                levelBedProgress: {
                  currentRun: i + 1,
                  totalRuns: maxRuns,
                  probesDone,
                  probesTotal: probesPerRunLearned,
                },
              });
            }
            wasProbing = isProbing;
          }, 200);

          const replyChunks: string[] = [];

          if (!isSbc) {
            // Standalone HTTP: take exclusive ownership of rr_reply so the
            // background poll loop can't drain it while the macro is running.
            // This guarantees we read the complete accumulated output in one shot
            // after the machine goes idle, instead of racing 250 ms poll cycles.
            service.suppressReplyPolling(true);
          }

          // firmwareMessage listener: catches output on SBC/serial (where
          // sendGCode is synchronous and may emit replies via the event bus),
          // and acts as a safety net for the standalone HTTP path.
          const unsub = service.on('firmwareMessage', (msg) => {
            const m = String(msg).trim();
            if (m) replyChunks.push(m);
          });

          try {
            // Run tilt-correction only (bed_tilt.g = bed.g without G29/M374).
            const directReply = await service.sendGCode('M98 P"0:/sys/bed_tilt.g"');
            if (directReply?.trim()) replyChunks.push(directReply.trim());

            if (!isSbc) {
              // Drain rr_reply every second while the macro runs.
              // A single read at the end risks missing output: RRF emits messages
              // incrementally (G28 homing lines, each G30 probe result, then the
              // M671 "Leadscrew adjustments made" line).  If the buffer fills up or
              // the machine is slow, the final message can be displaced.  Polling
              // continuously — exactly as DWC does — prevents both overflow and
              // the window where the idle detector fires just before the last
              // message is written.
              let drainInterval: ReturnType<typeof setInterval> | null = setInterval(async () => {
                const chunk = await service.pollReply();
                if (chunk?.trim()) replyChunks.push(chunk.trim());
              }, 800);

              try {
                // Wait until the machine finishes (watches the cached model —
                // no extra rr_model HTTP calls that would corrupt the diff state).
                await waitUntilIdle(service, 2_000, /* requireBusy */ false);
                // Give the firmware a moment to flush any final output.
                await new Promise<void>((r) => setTimeout(r, 500));
              } finally {
                if (drainInterval !== null) { clearInterval(drainInterval); drainInterval = null; }
              }

              // One last drain after the interval is stopped.
              const drain = await service.pollReply();
              if (drain?.trim()) replyChunks.push(drain.trim());
            }
          } finally {
            clearInterval(probeTracker);
            // Learn probe count from first run so subsequent runs show X/total
            if (probesPerRunLearned === null && probesDone > 0) {
              probesPerRunLearned = probesDone;
            }
            unsub();
            if (!isSbc) service.suppressReplyPolling(false);
          }

          const fullReply = replyChunks.join('\n');

          // ── Parse tilt-correction values from RRF output ──────────────────
          // RRF3 formats seen in the wild (all case-insensitive):
          //
          // Modern RRF3 (confirmed):
          //   "Leadscrew adjustments made: -0.117 -0.118 -0.115, points used 3,
          //    (mean, deviation) before (-0.117, 0.001) after (-0.000, 0.000)"
          //
          // Older / alternative RRF3 builds:
          //   "Leadscrew adjustments made: +0.10/-0.08/+0.03, mean …,
          //    deviation before 0.34 after 0.05"
          //   "Leadscrew adjustments made: A=+0.10, B=-0.08, C=+0.03, mean …,
          //    deviation before 0.34 after 0.05"

          // deviation before — two formats:
          //   modern: "before (mean, DEVIATION)"  → second number inside parens
          //   legacy: "deviation before NUMBER"
          const beforeParenMatch  = fullReply.match(/\bbefore\s*\(\s*[-\d.]+\s*,\s*([\d.]+)\s*\)/i);
          const beforePlainMatch  = fullReply.match(/deviation\s+before\s+([\d.]+)/i);
          const beforeMatch       = beforeParenMatch ?? beforePlainMatch;

          // deviation after — same two formats:
          //   modern: "after (mean, DEVIATION)"
          //   legacy: "after NUMBER"  (but only if it follows a deviation context)
          const afterParenMatch   = fullReply.match(/\bafter\s*\(\s*[-\d.]+\s*,\s*([\d.]+)\s*\)/i);
          const afterPlainMatch   = fullReply.match(/\bafter\s+([\d.]+)/i);
          const afterMatch        = afterParenMatch ?? afterPlainMatch;

          // adjustment values — strip named labels ("A=", "B="), split on
          // spaces, slashes, or commas, then parse as floats
          const adjMatch    = fullReply.match(/adjustments?\s+made:\s*([-\d.\s/,A-Za-z=+]+?)(?:,\s*points|\s*,\s*mean|\n|$)/i);
          const adjRaw      = adjMatch ? adjMatch[1].replace(/[A-Za-z]=?/g, ' ') : '';
          const adjValues   = adjRaw
            .split(/[\s,/]+/)
            .map((s) => parseFloat(s))
            .filter((n) => !isNaN(n));

          const runResult: LevelRunResult = {
            run:             i + 1,
            reply:           fullReply,
            deviationBefore: beforeMatch ? parseFloat(beforeMatch[1]) : null,
            deviationAfter:  afterMatch  ? parseFloat(afterMatch[1])  : null,
            adjustments:     adjValues,
          };
          results.push(runResult);

          // ── Auto-converge: decide whether to continue ─────────────────────
          // The firmware's deviationAfter is a theoretical projection, not a
          // re-measurement.  The *actual* post-correction deviation only shows
          // up as the next pass's deviationBefore.  We therefore never exit
          // early on the first pass — always run at least 2 so we have one
          // real verification probe before declaring the bed level.
          if (autoConverge && runResult.deviationAfter != null && i > 0) {
            // Condition 1 — verified deviation is below target
            if (runResult.deviationAfter <= targetDeviation) {
              stopReason = 'target';
              break;
            }
            // Condition 2 — diminishing returns.
            // Compare real measurements: (prev pass's before) → (this pass's before).
            // deviationBefore is an actual probe reading; deviationAfter is a firmware
            // projection and should not be used for convergence decisions.
            const prev = results[results.length - 2];
            if (prev.deviationBefore != null && prev.deviationBefore > 0 && runResult.deviationBefore != null) {
              const absImprovement = prev.deviationBefore - runResult.deviationBefore;
              const relImprovement = absImprovement / prev.deviationBefore;
              if (relImprovement < CONVERGENCE_THRESHOLD || absImprovement < MIN_ABS_IMPROVEMENT_MM) {
                stopReason = 'plateaued';
                break;
              }
            }
            // Otherwise keep going (stopReason remains 'maxPasses' until loop ends)
          }
        }

        if (probesPerPoint > 1) await service.sendGCode('M558 A1 S0.01');
      } catch (err) { set({ error: `Failed to level bed: ${(err as Error).message}` }); }

      // Clear live progress — the results modal takes over from here.
      set({ levelBedProgress: null });

      const summary: import('../../printerStore').LevelBedSummary = { results, autoConverge, stopReason, targetDeviation };
      set({ levelBedPendingResult: summary, lastLevelBedOpts: opts });
      return summary;
    },
  };
}

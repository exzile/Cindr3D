/**
 * useAutoSnapshots — print-status driven auto-capture triggers:
 *
 *   • First-layer snapshot when a print starts
 *   • Per-layer snapshot when the live `currentLayer` advances (de-duped via
 *     `seenPrintLayersRef`)
 *   • Print-finish snapshot + AR comparison freeze when the print returns
 *     to idle
 *   • Print-error snapshot on halt / pause / cancel transitions
 *
 * The host owns the `previousPrintStatusRef` and `seenPrintLayersRef` so a
 * print that survives a panel re-mount keeps its state.
 */
import { useEffect, type MutableRefObject } from 'react';

export interface UseAutoSnapshotsDeps {
  hasCamera: boolean;
  isPrintActive: boolean;
  printStatus: string | undefined;
  currentLayer: number | undefined;
  autoSnapshotFirstLayer: boolean;
  autoSnapshotLayer: boolean;
  autoSnapshotFinish: boolean;
  autoSnapshotError: boolean;
  previousPrintStatusRef: MutableRefObject<string | undefined>;
  seenPrintLayersRef: MutableRefObject<Set<number>>;
  captureSnapshot: (label?: string) => Promise<void>;
  captureFinalComparisonFrame: () => Promise<void>;
}

export function useAutoSnapshots(deps: UseAutoSnapshotsDeps) {
  const {
    hasCamera, isPrintActive, printStatus, currentLayer,
    autoSnapshotFirstLayer, autoSnapshotLayer, autoSnapshotFinish, autoSnapshotError,
    previousPrintStatusRef, seenPrintLayersRef,
    captureSnapshot, captureFinalComparisonFrame,
  } = deps;

  // Print-status transitions: first-layer, finish, AR comparison freeze, error.
  useEffect(() => {
    const previous = previousPrintStatusRef.current;
    previousPrintStatusRef.current = printStatus;

    if (!hasCamera) return;
    const becameActive = !previous || (previous !== 'processing' && previous !== 'simulating');
    if (isPrintActive && becameActive) {
      seenPrintLayersRef.current = new Set();
      if (autoSnapshotFirstLayer) {
        void captureSnapshot('First layer snapshot');
      }
      return;
    }

    if (previous && previous !== printStatus && !isPrintActive) {
      if (autoSnapshotFinish && printStatus === 'idle') {
        void captureSnapshot('Print finish snapshot');
      }
      if (printStatus === 'idle') {
        void captureFinalComparisonFrame();
      }
      if (autoSnapshotError && (printStatus === 'halted' || printStatus === 'pausing' || printStatus === 'cancelling')) {
        void captureSnapshot('Print issue snapshot');
      }
    }
  }, [
    autoSnapshotError, autoSnapshotFinish, autoSnapshotFirstLayer,
    captureFinalComparisonFrame, captureSnapshot, hasCamera, isPrintActive, printStatus,
    previousPrintStatusRef, seenPrintLayersRef,
  ]);

  // Per-layer snapshot — fires once per layer index seen during the active print.
  useEffect(() => {
    if (!hasCamera || !autoSnapshotLayer || !isPrintActive || currentLayer === undefined) return;
    if (seenPrintLayersRef.current.has(currentLayer)) return;
    seenPrintLayersRef.current.add(currentLayer);
    void captureSnapshot(`Layer ${currentLayer} snapshot`);
  }, [autoSnapshotLayer, captureSnapshot, currentLayer, hasCamera, isPrintActive, seenPrintLayersRef]);
}

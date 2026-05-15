import { useMemo } from 'react';
import { useSlicerStore } from '../../../../store/slicerStore';
import {
  tuningKindForTest,
  isPressureAdvanceTest,
  isFirstLayerTest,
  isTemperatureTowerTest,
  isRetractionTest,
  isMaxVolSpeedTest,
} from './inspectHelpers';
import { derivePressureAdvanceContext } from './paContext';
import { deriveFirstLayerContext } from './firstLayerContext';
import { deriveTemperatureContext } from './temperatureContext';
import { deriveRetractionContext } from './retractionContext';
import { deriveMaxVolSpeedContext } from './maxVolSpeedContext';
import type { InspectTestContext } from './types';

/**
 * Look up the per-test context (numeric tower parameters, pad layout, etc.) the
 * AI analysis needs. Reads the active printer/print/material profiles from the
 * slicer store and dispatches to the right derivation helper for the testType.
 *
 * Pure data — no side effects. Safe to call on every render; the underlying
 * derivations are memoised on profile identity.
 */
export function useTestContext(testType: string): InspectTestContext {
  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());
  const printProfile = useSlicerStore((s) => s.getActivePrintProfile());
  const materialProfile = useSlicerStore((s) => s.getActiveMaterialProfile());

  return useMemo(() => {
    const kind = tuningKindForTest(testType);
    const ctx: InspectTestContext = { testType, kind };

    if (isPressureAdvanceTest(testType)) {
      const pa = derivePressureAdvanceContext(printProfile);
      if (pa) ctx.pressureAdvance = pa;
    } else if (isFirstLayerTest(testType)) {
      const fl = deriveFirstLayerContext(printerProfile, printProfile, materialProfile);
      if (fl) ctx.firstLayer = fl;
    } else if (isTemperatureTowerTest(testType)) {
      const t = deriveTemperatureContext(printProfile);
      if (t) ctx.temperature = t;
    } else if (isRetractionTest(testType)) {
      const r = deriveRetractionContext(printProfile);
      if (r) ctx.retraction = r;
    } else if (isMaxVolSpeedTest(testType)) {
      const m = deriveMaxVolSpeedContext(printProfile);
      if (m) ctx.maxVolSpeed = m;
    }

    return ctx;
  }, [testType, printerProfile, printProfile, materialProfile]);
}

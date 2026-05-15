import type { PrintProfile } from '../../../../types/slicer';
import type { PressureAdvanceContext } from './types';

/**
 * Read the active print profile's pressure-advance tuning-tower processor and
 * derive the start/end/step parameters the AI needs to map a visible band on
 * the printed tower back to a numeric PA value.
 *
 * Returns null when the active profile has no PA tuning processor (the test
 * was run with a custom G-code or the user altered the preset).
 */
export function derivePressureAdvanceContext(
  printProfile: PrintProfile | undefined,
): PressureAdvanceContext | null {
  const proc = printProfile?.layerProcessors?.find(
    (p) => p.kind === 'tuning-tower' && p.tuningParameter === 'pressure-advance',
  );
  if (!proc) return null;

  const startZ     = proc.tuningStartZ     ?? 0;
  const endZ       = proc.tuningEndZ       ?? 50;
  const startValue = proc.tuningStartValue ?? 0;
  const endValue   = proc.tuningEndValue   ?? 0.1;
  const stepSize   = proc.tuningStepSize   ?? 5;
  const span = Math.max(0.001, endZ - startZ);
  const stepPerMm = (endValue - startValue) / span;
  const bandCount = stepSize > 0
    ? Math.max(1, Math.round(span / stepSize) + 1)
    : Math.round(span);

  return { startValue, endValue, startZ, endZ, stepPerMm, stepSize, bandCount };
}

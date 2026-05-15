import type { PrintProfile } from '../../../../types/slicer';
import { deriveTowerContext } from './towerContextHelpers';
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
  return deriveTowerContext(printProfile, 'pressure-advance', {
    startZ:     0,
    endZ:       50,
    startValue: 0,
    endValue:   0.1,
    stepSize:   5,
  });
}

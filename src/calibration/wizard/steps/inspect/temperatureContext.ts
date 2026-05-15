import type { PrintProfile } from '../../../../types/slicer';
import { deriveTowerContext } from './towerContextHelpers';
import type { TowerContext } from './types';

/**
 * Read the active print profile's temperature tuning-tower processor (kind
 * `tuning-tower`, `tuningParameter === 'temperature'`) and derive the
 * start/end/step parameters the AI needs to map a visible band on the printed
 * tower back to a nozzle temperature in °C.
 *
 * Returns null when the active profile has no temperature tuning processor
 * (the test was run with a custom G-code or the user altered the preset).
 */
export function deriveTemperatureContext(
  printProfile: PrintProfile | undefined,
): TowerContext | null {
  return deriveTowerContext(printProfile, 'temperature', {
    startZ:     0,
    endZ:       32,
    startValue: 220,
    endValue:   180,
    stepSize:   8,
  });
}

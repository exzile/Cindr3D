import type { PrintProfile } from '../../../../types/slicer';
import { deriveTowerContext } from './towerContextHelpers';
import type { TowerContext } from './types';

/**
 * Read the active print profile's max-volumetric-speed tuning-tower processor
 * (kind `tuning-tower`, `tuningParameter === 'speed'`) and derive the
 * start/end/step parameters the AI needs to map a visible band on the printed
 * vase-mode tube back to a feed-rate percent.
 *
 * The preset ramps M220 from 50%% to 300%% of the base print speed; converting
 * feed-rate percent into mm^3/s requires the base print speed + line width,
 * which the caller passes in as operatorNotes.
 *
 * Returns null when the active profile has no speed tuning processor.
 */
export function deriveMaxVolSpeedContext(
  printProfile: PrintProfile | undefined,
): TowerContext | null {
  return deriveTowerContext(printProfile, 'speed', {
    startZ:     1,
    endZ:       80,
    startValue: 50,
    endValue:   300,
    stepSize:   0,
  });
}

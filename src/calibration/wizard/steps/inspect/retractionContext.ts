import type { PrintProfile } from '../../../../types/slicer';
import { deriveTowerContext } from './towerContextHelpers';
import type { TowerContext } from './types';

/**
 * Retraction-distance bands burned into the retraction G-code generator
 * (`engine/calibration/retractionTower.ts`).  The retraction preset does NOT
 * use a `tuning-tower` layer processor — the bands are baked into the G-code
 * generator at fixed Z heights derived from `layersPerBand = round(8mm /
 * layerHeight)`.
 *
 * These values stay in sync with `retractionTower.ts`'s `retractBands` array.
 */
const RETRACTION_BANDS = [0.2, 0.4, 0.8, 1.2, 1.6, 2.0] as const;
const BAND_HEIGHT_MM = 8; // matches retractionTower.ts (`Math.round(8 / layerHeight)` layers)

/**
 * Derive the band layout for the retraction tower.  We first check for a
 * `tuning-tower` processor with `tuningParameter === 'speed'` (some custom
 * setups remap retraction distance through a speed-ramp processor); if none
 * exists, fall back to the fixed band layout the generator uses.
 *
 * `startValue`/`endValue`/`stepSize` are in millimetres of retraction
 * distance.  `stepPerMm` is derived so the same AI prompt that maps a band
 * height to a value works without special-casing retraction.
 */
export function deriveRetractionContext(
  printProfile: PrintProfile | undefined,
): TowerContext | null {
  // Some users add a tuning-tower processor manually — honour it if present.
  const fromProcessor = deriveTowerContext(printProfile, 'speed', null);
  if (fromProcessor) return fromProcessor;

  // Otherwise reconstruct the band layout from the fixed generator constants.
  const layerHeight = printProfile?.layerHeight ?? 0.2;
  const firstLayerHeight = printProfile?.firstLayerHeight ?? layerHeight;
  const startZ = firstLayerHeight;
  const endZ = firstLayerHeight + RETRACTION_BANDS.length * BAND_HEIGHT_MM;
  const startValue = RETRACTION_BANDS[0];
  const endValue = RETRACTION_BANDS[RETRACTION_BANDS.length - 1];
  const span = Math.max(0.001, endZ - startZ);
  const stepPerMm = (endValue - startValue) / span;

  return {
    startValue,
    endValue,
    startZ,
    endZ,
    stepPerMm,
    stepSize: BAND_HEIGHT_MM,
    bandCount: RETRACTION_BANDS.length,
  };
}

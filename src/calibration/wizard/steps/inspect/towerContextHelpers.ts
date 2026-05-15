import type { PrintProfile } from '../../../../types/slicer';
import type { LayerProcessor } from '../../../../types/slicer/profiles/print';
import type { TowerContext } from './types';

type TuningParameter = NonNullable<LayerProcessor['tuningParameter']>;

/**
 * Defaults used when a `tuning-tower` processor is present but missing some
 * tuning fields. Each tower-based test supplies its own fallback values that
 * match the corresponding preset in `calibrationSlicePresets.ts`.
 */
export interface TowerDefaults {
  startZ:     number;
  endZ:       number;
  startValue: number;
  endValue:   number;
  stepSize:   number;
}

/**
 * Find the first `tuning-tower` layer processor whose `tuningParameter`
 * matches and derive a `TowerContext`. Returns null when no matching processor
 * is present and `defaults === null`. Pass concrete defaults to coerce a
 * partially-configured processor to a full `TowerContext`.
 */
export function deriveTowerContext(
  printProfile: PrintProfile | undefined,
  tuningParameter: TuningParameter,
  defaults: TowerDefaults | null,
): TowerContext | null {
  const proc = printProfile?.layerProcessors?.find(
    (p) => p.kind === 'tuning-tower' && p.tuningParameter === tuningParameter,
  );
  if (!proc) return null;

  const startZ     = proc.tuningStartZ     ?? defaults?.startZ     ?? 0;
  const endZ       = proc.tuningEndZ       ?? defaults?.endZ       ?? 50;
  const startValue = proc.tuningStartValue ?? defaults?.startValue ?? 0;
  const endValue   = proc.tuningEndValue   ?? defaults?.endValue   ?? 0;
  const stepSize   = proc.tuningStepSize   ?? defaults?.stepSize   ?? 0;
  const span = Math.max(0.001, endZ - startZ);
  const stepPerMm = (endValue - startValue) / span;
  // stepSize === 0 means "every layer" — fall back to a 1-mm coarse band count
  // so the AI gets a reasonable number to talk about (one band per mm of ramp).
  const bandCount = stepSize > 0
    ? Math.max(1, Math.round(span / stepSize) + 1)
    : Math.max(1, Math.round(span));

  return { startValue, endValue, startZ, endZ, stepPerMm, stepSize, bandCount };
}

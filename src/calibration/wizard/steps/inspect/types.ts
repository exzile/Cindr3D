import type { TuningWizardKind } from '../../../../services/vision/tuningWizards';

/**
 * Generic band-style tower parameters needed to map a band height to a numeric
 * value. Used by every "ramp a parameter over Z" calibration (PA, temperature,
 * retraction, max-volumetric-speed) so the AI can correlate a visible band on
 * the printed tower with the parameter value at that Z.
 *
 * Units are test-specific:
 *   - pressure-advance: dimensionless PA factor
 *   - temperature:      degrees Celsius
 *   - retraction:       millimeters of retraction distance
 *   - max-vol-speed:    feed-rate percent (M220) — operatorNotes carry the
 *                       base mm/s + line width needed to convert to mm³/s
 */
export interface TowerContext {
  startValue: number;
  endValue: number;
  startZ: number;
  endZ: number;
  stepPerMm: number;
  stepSize: number;
  bandCount: number;
}

/** Back-compat alias — pressure advance was the first tower context shape. */
export type PressureAdvanceContext = TowerContext;

/** First-layer test pad layout + expected line geometry. */
export interface FirstLayerContext {
  pads: ReadonlyArray<{ label: string; x: number; y: number }>;
  firstLayerHeightMm: number;
  lineWidthMm: number;
  bedTempC: number;
  nozzleTempC: number;
  materialName: string;
}

/** All per-test context the AI can consume. Each is optional — present only when the test is active. */
export interface InspectTestContext {
  testType: string;
  kind: TuningWizardKind | null;
  pressureAdvance?: TowerContext;
  firstLayer?: FirstLayerContext;
  temperature?: TowerContext;
  retraction?: TowerContext;
  maxVolSpeed?: TowerContext;
}

import type { TuningWizardKind } from '../../../../services/vision/tuningWizards';

/** Pressure-advance tower parameters needed to map a band height to a PA value. */
export interface PressureAdvanceContext {
  startValue: number;
  endValue: number;
  startZ: number;
  endZ: number;
  stepPerMm: number;
  stepSize: number;
  bandCount: number;
}

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
  pressureAdvance?: PressureAdvanceContext;
  firstLayer?: FirstLayerContext;
}

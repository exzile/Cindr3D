import type { TuningWizardKind } from '../../../../services/vision/tuningWizards';

/** Maps a calibration card's testType to the AI vision wizard kind, or null for manual-only tests. */
export function tuningKindForTest(testType: string): TuningWizardKind | null {
  switch (testType) {
    case 'pressure-advance':       return 'pressure-advance';
    case 'first-layer':            return 'first-layer-squish';
    case 'temperature-tower':      return 'temperature';
    case 'retraction':             return 'retraction';
    case 'max-volumetric-speed':   return 'max-volumetric-speed';
    case 'input-shaper':           return 'input-shaper';
    default:                       return null;
  }
}

export function isFirmwareHealthTest(testType: string): boolean {
  return testType === 'firmware-health';
}

export function isPressureAdvanceTest(testType: string): boolean {
  return testType === 'pressure-advance';
}

export function isFirstLayerTest(testType: string): boolean {
  return testType === 'first-layer';
}

export function isTemperatureTowerTest(testType: string): boolean {
  return testType === 'temperature-tower';
}

export function isRetractionTest(testType: string): boolean {
  return testType === 'retraction';
}

export function isMaxVolSpeedTest(testType: string): boolean {
  return testType === 'max-volumetric-speed';
}

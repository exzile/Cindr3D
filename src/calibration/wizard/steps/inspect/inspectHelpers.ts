import type { TuningWizardKind } from '../../../../services/vision/tuningWizards';

/** Maps a calibration card's testType to the AI vision wizard kind, or null for manual-only tests. */
export function tuningKindForTest(testType: string): TuningWizardKind | null {
  switch (testType) {
    case 'pressure-advance':   return 'pressure-advance';
    case 'first-layer':        return 'first-layer-squish';
    case 'temperature-tower':  return 'temperature';
    case 'retraction':         return 'retraction';
    case 'input-shaper':       return 'input-shaper';
    default:                   return null;
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

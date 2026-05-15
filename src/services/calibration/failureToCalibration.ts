import type { VisionFailureCategory } from '../vision/failureDetector';

export interface CalibrationSuggestion {
  testType: string;
  label: string;
}

/**
 * Data-driven mapping from a vision failure category to the calibration
 * test that most directly addresses the likely root cause.
 *
 * Each entry pairs a category with the `testType` ID used by
 * `PrinterCalibrationPanel.startCalibrationTest(testType)` and the
 * `calibrationContent.ts` `CALIBRATION_CARDS` entries.
 *
 * Kept exported so it stays testable and so future categories can be
 * appended without touching the lookup helper.
 */
export const FAILURE_TO_CALIBRATION: ReadonlyArray<readonly [VisionFailureCategory, CalibrationSuggestion]> = [
  // Spaghetti is most often a first-layer adhesion failure that cascades.
  ['spaghetti', { testType: 'first-layer', label: 'First layer calibration' }],
  ['first-layer-adhesion', { testType: 'first-layer', label: 'First layer calibration' }],
  ['knocked-loose-part', { testType: 'first-layer', label: 'First layer calibration' }],
  ['layer-shift', { testType: 'input-shaper', label: 'Input shaper / motion tuning' }],
  ['blob-of-doom', { testType: 'retraction', label: 'Retraction calibration' }],
] as const;

const FAILURE_TO_CALIBRATION_INDEX: ReadonlyMap<VisionFailureCategory, CalibrationSuggestion> = new Map(
  FAILURE_TO_CALIBRATION.map(([category, suggestion]) => [category, suggestion]),
);

/**
 * Returns the recommended calibration test for a given vision failure
 * category, or `null` when no calibration is a good match (e.g. `none`
 * or `unknown`).
 */
export function suggestedCalibrationForFailure(category: VisionFailureCategory): CalibrationSuggestion | null {
  return FAILURE_TO_CALIBRATION_INDEX.get(category) ?? null;
}

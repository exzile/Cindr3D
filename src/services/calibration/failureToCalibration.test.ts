import { describe, expect, it } from 'vitest';
import {
  FAILURE_TO_CALIBRATION,
  suggestedCalibrationForFailure,
} from './failureToCalibration';
import type { VisionFailureCategory } from '../vision/failureDetector';

describe('suggestedCalibrationForFailure', () => {
  it('maps first-layer-adhesion to the first-layer calibration', () => {
    expect(suggestedCalibrationForFailure('first-layer-adhesion')).toEqual({
      testType: 'first-layer',
      label: 'First layer calibration',
    });
  });

  it('maps spaghetti to the first-layer calibration (most common root cause)', () => {
    expect(suggestedCalibrationForFailure('spaghetti')).toEqual({
      testType: 'first-layer',
      label: 'First layer calibration',
    });
  });

  it('maps knocked-loose-part to the first-layer calibration', () => {
    expect(suggestedCalibrationForFailure('knocked-loose-part')).toEqual({
      testType: 'first-layer',
      label: 'First layer calibration',
    });
  });

  it('maps layer-shift to input-shaper / motion tuning', () => {
    expect(suggestedCalibrationForFailure('layer-shift')).toEqual({
      testType: 'input-shaper',
      label: 'Input shaper / motion tuning',
    });
  });

  it('maps blob-of-doom to retraction calibration', () => {
    expect(suggestedCalibrationForFailure('blob-of-doom')).toEqual({
      testType: 'retraction',
      label: 'Retraction calibration',
    });
  });

  it('returns null for the none category', () => {
    expect(suggestedCalibrationForFailure('none')).toBeNull();
  });

  it('returns null for the unknown category', () => {
    expect(suggestedCalibrationForFailure('unknown')).toBeNull();
  });

  it('exposes a data-driven pairs list covering every actionable category', () => {
    const categories = FAILURE_TO_CALIBRATION.map(([category]) => category);
    expect(new Set(categories)).toEqual(new Set<VisionFailureCategory>([
      'spaghetti',
      'first-layer-adhesion',
      'knocked-loose-part',
      'layer-shift',
      'blob-of-doom',
    ]));
  });

  it('uses test types that exist in the calibration content registry', () => {
    const allowedTestTypes = new Set(['first-layer', 'input-shaper', 'retraction']);
    for (const [, suggestion] of FAILURE_TO_CALIBRATION) {
      expect(allowedTestTypes.has(suggestion.testType)).toBe(true);
    }
  });
});

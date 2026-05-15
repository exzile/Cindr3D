import { describe, expect, it } from 'vitest';
import type { PrintDiagnosisResult } from '../vision/printDiagnostics';
import { bucketDiagnosis, type PrintQualityBucket } from './printQualityCapture';

function makeResult(overrides: Partial<PrintDiagnosisResult> = {}): PrintDiagnosisResult {
  return {
    summary: 'No issues detected',
    rankedCauses: [],
    immediateActions: [],
    needsHumanReview: false,
    ...overrides,
  };
}

describe('bucketDiagnosis', () => {
  it('returns "ok" for a clean result with no ranked causes', () => {
    const bucket: PrintQualityBucket = bucketDiagnosis(makeResult());
    expect(bucket).toBe('ok');
  });

  it('returns "warn" when needsHumanReview is true even with no causes', () => {
    expect(bucketDiagnosis(makeResult({ needsHumanReview: true }))).toBe('warn');
  });

  it('returns "warn" for a low-confidence cause', () => {
    expect(
      bucketDiagnosis(
        makeResult({
          needsHumanReview: false,
          rankedCauses: [{ title: 'Minor stringing', rationale: '', confidence: 0.4 }],
        }),
      ),
    ).toBe('warn');
  });

  it('returns "fail" for a high-confidence cause (>= 0.7)', () => {
    expect(
      bucketDiagnosis(
        makeResult({
          needsHumanReview: true,
          rankedCauses: [
            { title: 'Layer shift', rationale: '', confidence: 0.85 },
            { title: 'Spaghetti', rationale: '', confidence: 0.5 },
          ],
        }),
      ),
    ).toBe('fail');
  });

  it('picks the max confidence across all ranked causes', () => {
    // First cause low; third cause high → still "fail".
    expect(
      bucketDiagnosis(
        makeResult({
          needsHumanReview: false,
          rankedCauses: [
            { title: 'A', rationale: '', confidence: 0.1 },
            { title: 'B', rationale: '', confidence: 0.2 },
            { title: 'C', rationale: '', confidence: 0.9 },
          ],
        }),
      ),
    ).toBe('fail');
  });

  it('treats confidence exactly at 0.7 as "fail" (boundary)', () => {
    expect(
      bucketDiagnosis(
        makeResult({
          needsHumanReview: false,
          rankedCauses: [{ title: 'Boundary', rationale: '', confidence: 0.7 }],
        }),
      ),
    ).toBe('fail');
  });
});

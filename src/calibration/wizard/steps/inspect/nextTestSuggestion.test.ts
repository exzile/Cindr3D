import { describe, expect, it } from 'vitest';
import type { TuningTowerRecommendation } from '../../../../services/vision/tuningWizards';
import { suggestNextTest } from './nextTestSuggestion';

/**
 * Minimal recommendation factory — defaults to a "clean PA tower" recommendation
 * and lets each test override only the fields it cares about.
 */
function rec(overrides: Partial<TuningTowerRecommendation> = {}): TuningTowerRecommendation {
  return {
    kind: 'pressure-advance',
    bestValue: 0.045,
    confidence: 0.9,
    summary: 'Cleanest corners around band 6.',
    evidence: ['Sharp corners at band 6.'],
    suggestedActions: [],
    ...overrides,
  };
}

describe('suggestNextTest', () => {
  it('suggests first-layer when confidence is low and evidence mentions adhesion', () => {
    const result = suggestNextTest({
      recommendation: rec({
        confidence: 0.3,
        summary: 'Hard to read — the first layer looks off and the print is warping.',
        evidence: ['Bed adhesion is poor in the lower bands.'],
      }),
      currentTestType: 'pressure-advance',
    });
    expect(result).not.toBeNull();
    expect(result?.testType).toBe('first-layer');
    expect(result?.reason).toMatch(/first.layer|adhesion/i);
  });

  it('suggests retraction when stringing is mentioned on a PA test', () => {
    const result = suggestNextTest({
      recommendation: rec({
        evidence: ['Visible stringing between the bands.', 'Sharp corners on band 5.'],
      }),
      currentTestType: 'pressure-advance',
    });
    expect(result).not.toBeNull();
    expect(result?.testType).toBe('retraction');
    expect(result?.reason).toMatch(/retraction|stringing/i);
  });

  it('returns null on a high-confidence PA recommendation with no concerning evidence', () => {
    const result = suggestNextTest({
      recommendation: rec(),
      currentTestType: 'pressure-advance',
    });
    expect(result).toBeNull();
  });

  it('does not suggest the current test (e.g. retraction test mentioning oozing)', () => {
    const result = suggestNextTest({
      recommendation: rec({
        kind: 'pressure-advance',
        // Avoid "stringing" here — it contains "ringing" as a substring and
        // would match the input-shaper rule. "ooze" / "blob" only match the
        // retraction rule, so when we're already on retraction the helper has
        // nothing else to suggest and must return null.
        evidence: ['Some residual ooze on band 3.', 'Small blob near a corner.'],
      }),
      currentTestType: 'retraction',
    });
    expect(result).toBeNull();
  });

  it('suggests input-shaper when ringing or ghosting is reported', () => {
    const result = suggestNextTest({
      recommendation: rec({
        evidence: ['Ringing visible after sharp corners.'],
      }),
      currentTestType: 'pressure-advance',
    });
    expect(result?.testType).toBe('input-shaper');
  });

  it('suggests flow-rate when under-extrusion appears', () => {
    const result = suggestNextTest({
      recommendation: rec({
        summary: 'Possible under-extrusion across all bands.',
        evidence: ['Gaps between perimeters on every band.'],
      }),
      currentTestType: 'pressure-advance',
    });
    expect(result?.testType).toBe('flow-rate');
  });

  it('suggests temperature-tower when bridging or overhangs look bad', () => {
    const result = suggestNextTest({
      recommendation: rec({
        evidence: ['Bridge sagging on the upper band.'],
      }),
      currentTestType: 'pressure-advance',
    });
    expect(result?.testType).toBe('temperature-tower');
  });

  it('returns null when there is no summary or evidence', () => {
    const result = suggestNextTest({
      recommendation: rec({ summary: '', evidence: [] }),
      currentTestType: 'pressure-advance',
    });
    expect(result).toBeNull();
  });
});

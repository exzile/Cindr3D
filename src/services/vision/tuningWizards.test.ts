import { describe, expect, it } from 'vitest';
import { buildTuningPrompt, pressureAdvanceValueFromHeight } from './tuningWizards';

describe('tuningWizards helpers', () => {
  it('computes pressure advance from tower height', () => {
    expect(pressureAdvanceValueFromHeight(14, 0, 0.005)).toBe(0.07);
    expect(pressureAdvanceValueFromHeight(12.5, 0.02, 0.004)).toBe(0.07);
  });

  it('builds an analyzer prompt with wizard context', () => {
    const prompt = buildTuningPrompt({
      frames: [],
      provider: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
      context: {
        kind: 'pressure-advance',
        printer: { printerId: 'p1', printerName: 'Voron', status: 'processing' },
        startValue: 0,
        stepPerMm: 0.005,
      },
    });

    expect(prompt).toContain('calibration tower');
    expect(prompt).toContain('pressure-advance');
    expect(prompt).toContain('stepPerMm');
  });
});

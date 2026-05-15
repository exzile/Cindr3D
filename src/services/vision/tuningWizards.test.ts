import { describe, expect, it } from 'vitest';
import { buildTuningPrompt, buildTuningRecommendationReport, pressureAdvanceValueFromHeight } from './tuningWizards';

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
    expect(prompt).toContain('missingMeasurements');
    expect(prompt).toContain('Evidence must cite visible observations');
  });

  it('cross-frame instruction is added when multiple frames are provided', () => {
    const multiFramePrompt = buildTuningPrompt({
      frames: [
        {
          cameraId: 'cam-1',
          cameraLabel: 'Front',
          capturedAt: 1000,
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AA==',
          size: 1,
        },
        {
          cameraId: 'cam-2',
          cameraLabel: 'Side',
          capturedAt: 1001,
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,BB==',
          size: 1,
        },
      ],
      provider: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
      context: {
        kind: 'pressure-advance',
        printer: { printerId: 'p1', printerName: 'Voron', status: 'processing' },
      },
    });

    expect(multiFramePrompt).toContain('complementary views');
    expect(multiFramePrompt).toContain('AGREE across frames');

    const singleFramePrompt = buildTuningPrompt({
      frames: [
        {
          cameraId: 'cam-1',
          cameraLabel: 'Front',
          capturedAt: 1000,
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AA==',
          size: 1,
        },
      ],
      provider: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
      context: {
        kind: 'pressure-advance',
        printer: { printerId: 'p1', printerName: 'Voron', status: 'processing' },
      },
    });

    expect(singleFramePrompt).not.toContain('complementary views');
  });

  it('builds a deterministic recommendation report', () => {
    const report = buildTuningRecommendationReport({
      generatedAt: 1234,
      context: {
        kind: 'temperature',
        printer: { printerId: 'p1', printerName: 'Voron' },
      },
      measurements: { value: 215 },
      frames: [
        {
          cameraId: 'cam-1',
          cameraLabel: 'Front',
          capturedAt: 1000,
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,AA==',
          size: 1,
        },
      ],
      recommendation: {
        kind: 'temperature',
        bestValue: 215,
        confidence: 0.82,
        summary: 'Cleanest band is near 215 C.',
        evidence: ['Less stringing than hotter bands.'],
        missingMeasurements: ['Confirm bridge underside.'],
        suggestedActions: ['Save the temperature to the filament profile.'],
      },
    });

    expect(report.generatedAt).toBe(1234);
    expect(report.title).toBe('Temperature Tower Recommendation');
    expect(report.confidencePct).toBe(82);
    expect(report.markdown).toContain('Recommended value: 215');
    expect(report.markdown).toContain('Confirm bridge underside.');
  });
});

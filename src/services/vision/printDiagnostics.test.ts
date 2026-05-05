import { describe, expect, it } from 'vitest';
import { buildDiagnosticsPrompt } from './printDiagnostics';

describe('printDiagnostics helpers', () => {
  it('builds a structured diagnostics prompt with telemetry', () => {
    const prompt = buildDiagnosticsPrompt({
      frames: [],
      provider: { provider: 'openai', model: 'gpt-4o', apiKey: 'test' },
      telemetry: {
        printer: {
          printerId: 'p1',
          printerName: 'Voron',
          status: 'processing',
          currentLayer: 4,
          totalLayers: 100,
        },
        filamentSensorState: ['monitor 0: ok'],
        expectedLayerTimeSec: 32,
        actualLayerTimeSec: 45,
      },
    });

    expect(prompt).toContain('rankedCauses');
    expect(prompt).toContain('Voron');
    expect(prompt).toContain('expectedLayerTimeSec');
  });
});

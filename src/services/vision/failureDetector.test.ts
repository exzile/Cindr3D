import { describe, expect, it } from 'vitest';
import type { DuetObjectModel } from '../../types/duet';
import { shouldSampleVisionFrame, summarizePrinterModel, VisionFrameSampler } from './failureDetector';

describe('failureDetector helpers', () => {
  it('samples immediately, then waits for the configured interval', () => {
    expect(shouldSampleVisionFrame(null, 10_000, 60)).toBe(true);
    expect(shouldSampleVisionFrame(1_000, 30_000, 60)).toBe(false);
    expect(shouldSampleVisionFrame(1_000, 61_000, 60)).toBe(true);
  });

  it('summarizes printer telemetry for vision prompts', () => {
    const model = {
      state: { status: 'processing' },
      job: {
        layer: 12,
        layerTime: 38,
        file: { fileName: 'cube.gcode', numLayers: 100 },
      },
      heat: {
        heaters: [
          { current: 209, active: 210, state: 'active' },
          { current: 59, active: 60, state: 'active' },
        ],
      },
      sensors: {
        filamentMonitors: [{ status: 'ok' }],
      },
    } as unknown as Partial<DuetObjectModel>;
    const snapshot = summarizePrinterModel('p1', 'Voron', model);

    expect(snapshot).toMatchObject({
      printerId: 'p1',
      printerName: 'Voron',
      status: 'processing',
      fileName: 'cube.gcode',
      currentLayer: 12,
      totalLayers: 100,
      layerTimeSec: 38,
      filamentMonitorStatus: ['monitor 0: ok'],
    });
    expect(snapshot.heaters?.[0]).toMatchObject({ index: 0, current: 209, active: 210 });
  });

  it('runs a guarded one-shot sample', async () => {
    const seen: string[] = [];
    const sampler = new VisionFrameSampler({
      intervalSec: 60,
      now: () => 1_000,
      capture: async () => ({
        cameraId: 'top',
        cameraLabel: 'Top',
        capturedAt: 1_000,
        mimeType: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,abc',
        size: 3,
      }),
      onFrame: (frame) => {
        seen.push(frame.cameraId);
      },
    });

    await expect(sampler.sampleNow()).resolves.toMatchObject({ cameraId: 'top' });
    await expect(sampler.sampleNow()).resolves.toBeNull();
    expect(seen).toEqual(['top']);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  shouldSampleLayer,
  isActivePrintStatus,
  useLayerFailureSampler,
} from './useLayerFailureSampler';
import { usePrinterStore } from '../store/printerStore';
import { useAiAssistantStore } from '../store/aiAssistantStore';
import { useVisionStore } from '../store/visionStore';

// Mock the vision service: replace the network-bound capture + classify so the
// hook can drive its loop without touching real cameras or APIs.
vi.mock('../services/vision/failureDetector', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/vision/failureDetector')>();
  return {
    ...original,
    captureVisionFrame: vi.fn(async () => ({
      cameraId: 'cam-1',
      cameraLabel: 'Cam 1',
      capturedAt: Date.now(),
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,abc',
      size: 100,
    })),
    classifyPrintFrame: vi.fn(async () => ({
      category: 'none' as const,
      confidence: 0.1,
      severity: 'none' as const,
      summary: 'looks fine',
      evidence: [],
      suggestedActions: [],
      shouldPause: false,
      requiresConfirmation: false,
    })),
  };
});

vi.mock('../utils/duetPrefs', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/duetPrefs')>();
  return {
    ...original,
    getDuetPrefs: vi.fn(() => ({} as unknown as ReturnType<typeof original.getDuetPrefs>)),
  };
});

import { captureVisionFrame, classifyPrintFrame } from '../services/vision/failureDetector';

const captureMock = captureVisionFrame as unknown as ReturnType<typeof vi.fn>;
const classifyMock = classifyPrintFrame as unknown as ReturnType<typeof vi.fn>;

describe('shouldSampleLayer', () => {
  it('accepts the very first sample once a layer is reported', () => {
    expect(shouldSampleLayer(1, null, 5)).toBe(true);
    expect(shouldSampleLayer(8, null, 5)).toBe(true);
  });

  it('rejects samples within step of the last sampled layer', () => {
    expect(shouldSampleLayer(3, 1, 5)).toBe(false);
    expect(shouldSampleLayer(5, 1, 5)).toBe(false);
  });

  it('accepts samples once we cross the step threshold', () => {
    expect(shouldSampleLayer(6, 1, 5)).toBe(true);
    expect(shouldSampleLayer(11, 6, 5)).toBe(true);
  });

  it('resets when the layer goes backwards (new job / manual restart)', () => {
    expect(shouldSampleLayer(1, 100, 5)).toBe(true);
  });

  it('rejects when no layer is reported yet', () => {
    expect(shouldSampleLayer(undefined, null, 5)).toBe(false);
    expect(shouldSampleLayer(0, null, 5)).toBe(false);
  });

  it('clamps step to a minimum of 1', () => {
    expect(shouldSampleLayer(2, 1, 0)).toBe(true);
    expect(shouldSampleLayer(2, 1, -10)).toBe(true);
  });
});

describe('isActivePrintStatus', () => {
  it('treats processing/simulating/resuming as active', () => {
    expect(isActivePrintStatus('processing')).toBe(true);
    expect(isActivePrintStatus('simulating')).toBe(true);
    expect(isActivePrintStatus('resuming')).toBe(true);
  });

  it('treats idle/paused/disconnected as inactive', () => {
    expect(isActivePrintStatus('idle')).toBe(false);
    expect(isActivePrintStatus('paused')).toBe(false);
    expect(isActivePrintStatus('disconnected')).toBe(false);
    expect(isActivePrintStatus(undefined)).toBe(false);
  });
});

function seedStores({
  apiKey,
  status,
  layer,
}: { apiKey: string; status?: string; layer?: number }): void {
  useAiAssistantStore.setState({
    apiKey,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  } as Partial<ReturnType<typeof useAiAssistantStore.getState>>);

  const model: Record<string, unknown> = {};
  if (status !== undefined) model.state = { status };
  if (layer !== undefined) model.job = { layer, file: { fileName: 'job.gcode', numLayers: 100 } };

  usePrinterStore.setState({
    printers: [{ id: 'p1', name: 'Voron', config: {} as never, prefs: {} as never }],
    activePrinterId: 'p1',
    connected: true,
    model: model as unknown as ReturnType<typeof usePrinterStore.getState>['model'],
  } as Partial<ReturnType<typeof usePrinterStore.getState>>);

  useVisionStore.setState({
    recentChecks: [],
    recentFrames: [],
    recentDiagnoses: [],
  } as Partial<ReturnType<typeof useVisionStore.getState>>);
}

describe('useLayerFailureSampler', () => {
  beforeEach(() => {
    captureMock.mockClear();
    classifyMock.mockClear();
  });

  it('is a no-op when no API key is configured', async () => {
    seedStores({ apiKey: '', status: 'processing', layer: 10 });
    const { result } = renderHook(() => useLayerFailureSampler({ layerStep: 5 }));
    await waitFor(() => {
      expect(result.current.state).toBe('disabled-no-key');
    });
    expect(captureMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it('reports idle when the printer is not actively printing', async () => {
    seedStores({ apiKey: 'sk-x', status: 'idle', layer: undefined });
    const { result } = renderHook(() => useLayerFailureSampler({ layerStep: 5 }));
    await waitFor(() => {
      expect(result.current.state).toBe('idle');
    });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('runs exactly one check per layer step', async () => {
    seedStores({ apiKey: 'sk-x', status: 'processing', layer: 1 });
    const { result } = renderHook(() => useLayerFailureSampler({ layerStep: 5 }));

    // First layer (1, lastSampled === null) → should sample once.
    await waitFor(() => {
      expect(classifyMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.lastCheck?.layer).toBe(1);
    });

    // Bump to layer 3 — still within step, should NOT re-sample.
    act(() => {
      usePrinterStore.setState({
        model: {
          state: { status: 'processing' },
          job: { layer: 3, file: { fileName: 'job.gcode', numLayers: 100 } },
        } as unknown as ReturnType<typeof usePrinterStore.getState>['model'],
      });
    });
    // Settle a tick — count should still be 1.
    await new Promise((r) => setTimeout(r, 10));
    expect(classifyMock).toHaveBeenCalledTimes(1);

    // Bump to layer 6 (step = 5 past last sampled 1) — should sample once more.
    act(() => {
      usePrinterStore.setState({
        model: {
          state: { status: 'processing' },
          job: { layer: 6, file: { fileName: 'job.gcode', numLayers: 100 } },
        } as unknown as ReturnType<typeof usePrinterStore.getState>['model'],
      });
    });
    await waitFor(() => {
      expect(classifyMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.lastCheck?.layer).toBe(6);
    });
  });
});

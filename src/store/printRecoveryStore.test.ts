import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrintRecoveryStore } from './printRecoveryStore';

describe('print recovery store', () => {
  beforeEach(() => {
    usePrintRecoveryStore.setState({ snapshots: {}, dismissed: {} });
  });

  it('returns recent idle snapshots as recoverable', () => {
    usePrintRecoveryStore.getState().saveSnapshot({
      printerId: 'p1',
      printerName: 'Voron',
      fileName: 'part.gcode',
      filePosition: 12345,
      z: 12.4,
      layer: 62,
      bedTemp: 80,
      toolTemp: 240,
      status: 'processing',
      updatedAt: Date.now(),
    });

    expect(usePrintRecoveryStore.getState().getRecoverableSnapshot('p1', 'idle')?.fileName).toBe('part.gcode');
  });

  it('does not show recovery prompts for routine paused jobs', () => {
    usePrintRecoveryStore.getState().saveSnapshot({
      printerId: 'p1',
      printerName: 'Voron',
      fileName: 'part.gcode',
      filePosition: 12345,
      z: 12.4,
      layer: 62,
      bedTemp: 80,
      toolTemp: 240,
      status: 'processing',
      updatedAt: Date.now(),
    });

    expect(usePrintRecoveryStore.getState().getRecoverableSnapshot('p1', 'paused')).toBeNull();
  });

  it('hides dismissed and expired snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    usePrintRecoveryStore.getState().saveSnapshot({
      printerId: 'p1',
      printerName: 'Voron',
      fileName: 'old.gcode',
      filePosition: 20,
      z: null,
      layer: null,
      bedTemp: null,
      toolTemp: null,
      status: 'processing',
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    });

    expect(usePrintRecoveryStore.getState().getRecoverableSnapshot('p1', 'idle')).toBeNull();
    vi.useRealTimers();
  });
});

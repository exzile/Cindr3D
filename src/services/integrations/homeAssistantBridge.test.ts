import { describe, expect, it } from 'vitest';
import { buildHomeAssistantSnapshot } from './homeAssistantBridge';

describe('home assistant bridge helpers', () => {
  it('adds an update timestamp to printer snapshots', () => {
    const snapshot = buildHomeAssistantSnapshot({
      printerId: 'p1',
      printerName: 'Voron',
      status: 'processing',
      progress: 42,
      temperatures: { heater0: 205 },
      position: { X: 10, Y: 12, Z: 0.4 },
    });

    expect(snapshot.printerId).toBe('p1');
    expect(snapshot.progress).toBe(42);
    expect(Date.parse(snapshot.updatedAt)).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';

import { nextConsecutiveBridgeLayers } from './finalizeLayer';

/**
 * `nextConsecutiveBridgeLayers` is the contract between the three
 * slicer steps that interact with the bridge fan cascade:
 *   - `prepareLayerGeometryState` defensively resets `layerHadBridge=false`
 *   - `emitContourInfill` sets `layerHadBridge=true` per bridge move
 *   - `finalizeLayer` calls this helper to advance the counter
 *
 * These tests pin the state machine so future refactors can't accidentally
 * break the bridge-fan-speed cascade (`bridgeFanSpeed → 2 → 3`).
 */

function runSequence(sequence: boolean[]): number[] {
  let counter = 0;
  const out: number[] = [];
  for (const layerHadBridge of sequence) {
    counter = nextConsecutiveBridgeLayers(counter, layerHadBridge);
    out.push(counter);
  }
  return out;
}

describe('nextConsecutiveBridgeLayers', () => {
  it('starts at 0 and stays at 0 when no layer has a bridge', () => {
    expect(runSequence([false, false, false])).toEqual([0, 0, 0]);
  });

  it('counts up monotonically for a continuous bridge streak', () => {
    expect(runSequence([true, true, true, true])).toEqual([1, 2, 3, 4]);
  });

  it('resets to 0 the first non-bridge layer, then resumes counting on the next bridge', () => {
    expect(runSequence([true, true, false, true])).toEqual([1, 2, 0, 1]);
  });

  it('handles isolated single bridge layers correctly', () => {
    expect(runSequence([false, true, false, true, false])).toEqual([0, 1, 0, 1, 0]);
  });

  it('survives multiple alternating streaks', () => {
    expect(runSequence([true, true, false, false, true, true, true])).toEqual(
      [1, 2, 0, 0, 1, 2, 3],
    );
  });

  it('treats undefined/null priors as 0 (defensive against fresh run state)', () => {
    expect(nextConsecutiveBridgeLayers(undefined as unknown as number, true)).toBe(1);
    expect(nextConsecutiveBridgeLayers(null as unknown as number, true)).toBe(1);
    expect(nextConsecutiveBridgeLayers(undefined as unknown as number, false)).toBe(0);
  });
});

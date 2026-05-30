import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBRepBody } from '../engine/occ/brepBody';
import { globalBRepBodyRegistry } from '../engine/occ/globalRegistry';
import { captureOccSnapshot, restoreOccSnapshot } from '../engine/occ/occSnapshot';
import { OccHandle } from '../engine/occ/occHandle';

describe('OCC STEP snapshots', () => {
  beforeEach(() => {
    globalBRepBodyRegistry.clear();
  });

  afterEach(() => {
    globalBRepBodyRegistry.clear();
  });

  it('captures an empty snapshot when OCC is not loaded', () => {
    expect(captureOccSnapshot()).toEqual([]);
  });

  it('does not clear existing bodies when restore is requested before OCC is loaded', async () => {
    const body = createBRepBody({
      id: 'body-a',
      shape: new OccHandle(1, 'shape', () => {}),
      sourceFeatureId: 'feature-a',
    });
    globalBRepBodyRegistry.add(body);

    await restoreOccSnapshot([
      {
        bodyId: 'body-b',
        featureId: 'feature-b',
        stepString: 'ISO-10303-21;',
      },
    ]);

    expect(globalBRepBodyRegistry.get('body-a')).toBe(body);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { createBRepBody, type BRepBody } from '../engine/occ/brepBody';
import {
  clearFeatureEvaluationCache,
  evaluateFeature,
  invalidateFeature,
  registerFeatureEvaluator,
} from '../engine/occ/featureEvaluator';
import { globalBRepBodyRegistry } from '../engine/occ/globalRegistry';
import { OccHandle } from '../engine/occ/occHandle';

let handlePtr = 1;

function fakeBody(id: string, revision = 1): BRepBody {
  return createBRepBody({
    id,
    revision,
    shape: new OccHandle(handlePtr++, 'shape', () => {}),
  });
}

describe('OCC feature evaluator cache', () => {
  beforeEach(() => {
    clearFeatureEvaluationCache();
    globalBRepBodyRegistry.clear();
  });

  it('returns the cached body when params and upstream revisions are unchanged', () => {
    let calls = 0;
    registerFeatureEvaluator('cache-test', () => {
      calls += 1;
      return fakeBody(`body-${calls}`);
    });

    const first = evaluateFeature({}, 'cache-test', 'feature-a', { width: 10 });
    const second = evaluateFeature({}, 'cache-test', 'feature-a', { width: 10 });

    expect(first?.id).toBe('body-1');
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(globalBRepBodyRegistry.getByFeature('feature-a')).toHaveLength(1);
  });

  it('re-evaluates when upstream body revisions change', () => {
    let calls = 0;
    registerFeatureEvaluator('upstream-test', () => {
      calls += 1;
      return fakeBody(`upstream-result-${calls}`);
    });

    evaluateFeature({}, 'upstream-test', 'feature-b', {}, [fakeBody('source', 1)]);
    const updated = evaluateFeature({}, 'upstream-test', 'feature-b', {}, [fakeBody('source', 2)]);

    expect(updated?.id).toBe('upstream-result-2');
    expect(calls).toBe(2);
    expect(globalBRepBodyRegistry.get('upstream-result-1')).toBeUndefined();
    expect(globalBRepBodyRegistry.getByFeature('feature-b')).toHaveLength(1);
  });

  it('rebuilds a cache hit when the registry no longer has the body', () => {
    let calls = 0;
    registerFeatureEvaluator('registry-miss-test', () => {
      calls += 1;
      return fakeBody(`registry-result-${calls}`);
    });

    const first = evaluateFeature({}, 'registry-miss-test', 'feature-c', {});
    expect(first?.id).toBe('registry-result-1');

    globalBRepBodyRegistry.clear();
    const second = evaluateFeature({}, 'registry-miss-test', 'feature-c', {});

    expect(second?.id).toBe('registry-result-2');
    expect(calls).toBe(2);
  });

  it('invalidates a feature body and listed dependents', () => {
    registerFeatureEvaluator('invalidate-test', (_oc, featureId) => fakeBody(`body-${featureId}`));

    evaluateFeature({}, 'invalidate-test', 'parent', {});
    evaluateFeature({}, 'invalidate-test', 'child', {});

    invalidateFeature('parent', ['child']);

    expect(globalBRepBodyRegistry.getByFeature('parent')).toEqual([]);
    expect(globalBRepBodyRegistry.getByFeature('child')).toEqual([]);
  });

  it('clears cached bodies from the registry when the cache is reset', () => {
    registerFeatureEvaluator('clear-test', (_oc, featureId) => fakeBody(`body-${featureId}`));

    evaluateFeature({}, 'clear-test', 'clear-a', {});
    evaluateFeature({}, 'clear-test', 'clear-b', {});

    clearFeatureEvaluationCache();

    expect(globalBRepBodyRegistry.getByFeature('clear-a')).toEqual([]);
    expect(globalBRepBodyRegistry.getByFeature('clear-b')).toEqual([]);
  });
});

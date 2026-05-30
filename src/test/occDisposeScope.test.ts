import { describe, expect, it } from 'vitest';
import { OccDisposeScope, withOccDisposeScope } from '../engine/occ/disposeScope';
import { occErr, occMessage, occOk } from '../engine/occ/result';

function disposable(log: string[], name: string) {
  return {
    name,
    dispose() {
      log.push(name);
    },
  };
}

describe('OCC dispose scope utilities', () => {
  it('disposes tracked resources in reverse order', () => {
    const log: string[] = [];
    const scope = new OccDisposeScope();

    scope.track(disposable(log, 'a'));
    scope.track(disposable(log, 'b'));
    scope.dispose();
    scope.dispose();

    expect(log).toEqual(['b', 'a']);
  });

  it('releases ownership for resources handed to a caller', () => {
    const log: string[] = [];
    const scope = new OccDisposeScope();
    scope.track(disposable(log, 'owned'));
    const released = scope.track(disposable(log, 'released'));

    expect(scope.release(released)).toBe(released);
    scope.dispose();
    released.dispose();

    expect(log).toEqual(['owned', 'released']);
  });

  it('cleans up after async operations', async () => {
    const log: string[] = [];

    await withOccDisposeScope(async (scope) => {
      scope.track(disposable(log, 'temp'));
      await Promise.resolve();
      return 'done';
    });

    expect(log).toEqual(['temp']);
  });

  it('creates consistent operation result envelopes', () => {
    const warning = occMessage('warning', 'OCC_TEST', 'testing');
    const success = occOk(42, [warning]);
    const failure = occErr(occMessage('error', 'OCC_FAIL', 'failed'));

    expect(success).toEqual({ ok: true, value: 42, messages: [warning] });
    expect(failure.ok).toBe(false);
    expect(failure.messages[0].code).toBe('OCC_FAIL');
  });
});

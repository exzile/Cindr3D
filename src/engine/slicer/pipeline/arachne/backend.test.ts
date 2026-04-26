import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  arachneWasmBackend,
  getArachneBackend,
  registerArachneBackend,
  resolveArachneBackend,
} from './backend';
import type { ArachneBackend } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('arachne backend registry', () => {
  it('returns the WASM backend by default', () => {
    expect(resolveArachneBackend()).toBe(arachneWasmBackend);
    expect(resolveArachneBackend('wasm')).toBe(arachneWasmBackend);
  });

  it('coerces a legacy "js" profile value to the WASM backend with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveArachneBackend('js')).toBe(arachneWasmBackend);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/arachneBackend "js" is not registered/);
  });

  it('does NOT warn when an explicit wasm name resolves to the registered backend', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveArachneBackend('wasm')).toBe(arachneWasmBackend);
    expect(warn).not.toHaveBeenCalled();
  });

  it('getArachneBackend returns null for an unregistered backend', () => {
    // 'js' is no longer registered after 9.3D
    expect(getArachneBackend('js')).toBeNull();
    expect(getArachneBackend('wasm')).toBe(arachneWasmBackend);
  });

  it('registerArachneBackend lets callers replace the wasm slot', () => {
    const fake: ArachneBackend = {
      name: 'wasm',
      generatePaths: () => [],
    };
    registerArachneBackend(fake);
    expect(resolveArachneBackend('wasm')).toBe(fake);
    // Restore so other tests in the suite see the real backend.
    registerArachneBackend(arachneWasmBackend);
    expect(resolveArachneBackend('wasm')).toBe(arachneWasmBackend);
  });
});

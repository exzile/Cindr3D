import '@testing-library/jest-dom';
import { beforeAll } from 'vitest';

import { loadClipper2Module } from '../engine/slicer/geometry/clipper2Wasm';

if (typeof window !== 'undefined' && window.location.origin === 'null') {
  window.history.replaceState(null, '', 'http://localhost/');
}

try {
  window.localStorage.getItem('__vitest_probe__');
} catch {
  const values = new Map<string, string>();
  const localStorageShim = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageShim });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageShim });
}

// ARACHNE-9.4A.4: tests synchronously call `computeAtomicRegions` and
// other Clipper2-backed sync helpers (perimeters, infill, etc.). After
// dropping the polygon-clipping fallback, those helpers throw if the
// module isn't loaded. Awaiting once at suite setup guarantees the
// sync path resolves for every test in the file.
beforeAll(async () => {
  await loadClipper2Module();
}, 30_000);

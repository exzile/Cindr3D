import '@testing-library/jest-dom';
import { beforeAll } from 'vitest';

import { loadClipper2Module } from '../engine/slicer/geometry/clipper2Wasm';

// ARACHNE-9.4A.4: tests synchronously call `computeAtomicRegions` and
// other Clipper2-backed sync helpers (perimeters, infill, etc.). After
// dropping the polygon-clipping fallback, those helpers throw if the
// module isn't loaded. Awaiting once at suite setup guarantees the
// sync path resolves for every test in the file.
beforeAll(async () => {
  await loadClipper2Module();
}, 30_000);

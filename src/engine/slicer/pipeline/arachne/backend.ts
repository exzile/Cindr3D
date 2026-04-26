import { distributeBeads } from './beadStrategy';
import { extractBeadPaths } from './pathExtraction';
import { buildSkeletalTrapezoidation } from './trapezoidation';
import type { ArachneBackend, ArachneBackendName } from './types';
import { buildEdgeVoronoi } from './voronoi';
import { arachneWasmBackend } from './arachneWasm';

export const arachneJsBackend: ArachneBackend = {
  name: 'js',
  buildVoronoi: buildEdgeVoronoi,
  buildTrapezoidation: buildSkeletalTrapezoidation,
  distributeBeads,
  extractPaths: extractBeadPaths,
};

const registeredBackends = new Map<ArachneBackendName, ArachneBackend>([
  [arachneJsBackend.name, arachneJsBackend],
  [arachneWasmBackend.name, arachneWasmBackend],
]);

export function registerArachneBackend(backend: ArachneBackend): void {
  registeredBackends.set(backend.name, backend);
}

export function getArachneBackend(name: ArachneBackendName = 'js'): ArachneBackend | null {
  return registeredBackends.get(name) ?? null;
}

export function resolveArachneBackend(name: ArachneBackendName = 'js'): ArachneBackend {
  return getArachneBackend(name) ?? arachneJsBackend;
}

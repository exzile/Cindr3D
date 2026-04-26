import { arachneWasmBackend } from './arachneWasm';
import type { ArachneBackend, ArachneBackendName } from './types';

const registeredBackends = new Map<ArachneBackendName, ArachneBackend>([
  [arachneWasmBackend.name, arachneWasmBackend],
]);

export { arachneWasmBackend };

export function registerArachneBackend(backend: ArachneBackend): void {
  registeredBackends.set(backend.name, backend);
}

export function getArachneBackend(name: ArachneBackendName = 'wasm'): ArachneBackend | null {
  return registeredBackends.get(name) ?? null;
}

/** `'js'` legacy profiles transparently coerce to the WASM backend
 *  since 9.3D removed the staged-JS implementation. */
export function resolveArachneBackend(name: ArachneBackendName = 'wasm'): ArachneBackend {
  const found = getArachneBackend(name);
  if (found) return found;
  if (name !== 'wasm') {
    // eslint-disable-next-line no-console
    console.warn(`arachneBackend "${name}" is not registered; falling back to "wasm".`);
  }
  return arachneWasmBackend;
}

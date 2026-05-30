/**
 * Global singleton BRepBodyRegistry.
 * Session-only (not persisted). OCC operations register/update bodies here.
 * OCC-7.x will integrate this registry into the cadStore.
 */
import { BRepBodyRegistry } from './bodyRegistry';

export const globalBRepBodyRegistry = new BRepBodyRegistry();

// NOTE: Do NOT clear the registry on HMR dispose. OCC bodies are C++ heap objects
// whose handles remain valid across module hot-replacements. Clearing on dispose
// empties the registry but leaves the WASM heap intact, making fillet/chamfer/edge-op
// fail until the user triggers a full feature re-evaluation. The registry accumulates
// no meaningful additional memory on HMR because new bodies replace old ones via
// registry.add() → registry.delete(oldId) which calls body.dispose().
// Only clear if the OCC WASM module itself reloads (ABI break), which requires a hard refresh.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // Accept self-updates silently — keep the existing registry instance.
  });
}

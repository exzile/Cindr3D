/**
 * manifoldWasm.ts — singleton loader for manifold-3d.
 *
 * Follows the same lazy-singleton pattern as clipper2Wasm.ts.
 * Call `initManifold()` once at app startup; subsequent calls return the
 * cached promise. CSG ops read `getManifoldModule()` synchronously —
 * returns null if WASM hasn't loaded yet (startup race), which causes
 * csg.ts to fall back to three-bvh-csg for that call only.
 *
 * Also works in Web Workers: each worker calls `initManifold()` on its
 * first message and awaits it before computing. The singleton is per-realm,
 * so the worker gets its own Manifold instance (correct — no shared state).
 */
import type { ManifoldToplevel } from 'manifold-3d';

let _modulePromise: Promise<ManifoldToplevel> | null = null;
let _module: ManifoldToplevel | null = null;

export async function initManifold(): Promise<ManifoldToplevel> {
  if (_modulePromise) return _modulePromise;
  _modulePromise = (async () => {
    // Dynamic import so Vite can tree-shake and the WASM binary is
    // loaded on demand (not blocking app startup).
    const { default: Module } = await import('manifold-3d');
    const wasm = await Module();
    // setup() registers helper methods (toVec, fromVec, etc.) on the module.
    wasm.setup();
    _module = wasm;
    return wasm;
  })();
  return _modulePromise;
}

/** Synchronous accessor — returns null if WASM not yet initialised. */
export function getManifoldModule(): ManifoldToplevel | null {
  return _module;
}

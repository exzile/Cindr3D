/**
 * loader.ts — singleton loader for opencascade.js (BRep kernel).
 *
 * Avoids importing from opencascade.js index.js (which re-exports .wasm files
 * that rolldown/esbuild can't statically analyse). Instead we import the
 * Emscripten factory and each WASM module as `?url` assets — Vite copies them
 * to dist/assets/wasm/ and gives us URL strings. The factory is loaded at
 * runtime via a dynamic import so rolldown never sees its internals.
 *
 * Modules loaded: the minimum set for OCC-1 through OCC-5
 * (primitives, booleans, fillet/chamfer, tessellation, STEP I/O).
 */
import type { OcctInstance } from './types';

// ── Asset URLs (Vite resolves + copies to dist, returns URL strings) ──────────
// The main Emscripten JS factory — imported as a URL so rolldown doesn't bundle it
import occFactoryUrl from 'opencascade.js/dist/opencascade.js?url';
// The core WASM binary
import occWasmUrl from 'opencascade.js/dist/opencascade.wasm?url';

// Modular WASM libraries (each is a separate OCCT toolkit)
import urlTKBRep from 'opencascade.js/dist/module.TKBRep.wasm?url';
import urlTKGeomBase from 'opencascade.js/dist/module.TKGeomBase.wasm?url';
import urlTKGeomAlgo from 'opencascade.js/dist/module.TKGeomAlgo.wasm?url';
import urlTKTopAlgo from 'opencascade.js/dist/module.TKTopAlgo.wasm?url';
import urlTKShHealing from 'opencascade.js/dist/module.TKShHealing.wasm?url';
import urlTKPrim from 'opencascade.js/dist/module.TKPrim.wasm?url';
import urlTKMesh from 'opencascade.js/dist/module.TKMesh.wasm?url';
import urlTKBO from 'opencascade.js/dist/module.TKBO.wasm?url';
import urlTKBool from 'opencascade.js/dist/module.TKBool.wasm?url';
import urlTKFillet from 'opencascade.js/dist/module.TKFillet.wasm?url';
import urlTKOffset from 'opencascade.js/dist/module.TKOffset.wasm?url';
import urlTKG2d from 'opencascade.js/dist/module.TKG2d.wasm?url';
import urlTKG3d from 'opencascade.js/dist/module.TKG3d.wasm?url';
import urlTKMath from 'opencascade.js/dist/module.TKMath.wasm?url';
import urlTKService from 'opencascade.js/dist/module.TKService.wasm?url';
// STEP I/O
import urlTKCDF from 'opencascade.js/dist/module.TKCDF.wasm?url';
import urlTKLCAF from 'opencascade.js/dist/module.TKLCAF.wasm?url';
// TKXSBase (Transfer Framework) must precede TKSTEPBase — it defines the
// interface/transfer infra that TKSTEPBase's RTTI depends on.
import urlTKXSBase from 'opencascade.js/dist/module.TKXSBase.wasm?url';
import urlTKSTEPBase from 'opencascade.js/dist/module.TKSTEPBase.wasm?url';
import urlTKSTEPAttr from 'opencascade.js/dist/module.TKSTEPAttr.wasm?url';
import urlTKSTEP209 from 'opencascade.js/dist/module.TKSTEP209.wasm?url';
import urlTKSTEP from 'opencascade.js/dist/module.TKSTEP.wasm?url';

// Ordered load list — base dependencies before dependents
const LIB_URLS = [
  urlTKMath, urlTKService, urlTKG2d, urlTKG3d,
  urlTKGeomBase, urlTKBRep, urlTKGeomAlgo, urlTKTopAlgo,
  urlTKShHealing, urlTKPrim, urlTKMesh,
  urlTKBO, urlTKBool, urlTKFillet, urlTKOffset,
  urlTKCDF, urlTKLCAF, urlTKXSBase, urlTKSTEPBase, urlTKSTEPAttr, urlTKSTEP209, urlTKSTEP,
];

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instancePromise: Promise<OcctInstance> | null = null;
let _instance: OcctInstance | null = null;

export async function getOcc(): Promise<OcctInstance> {
  if (_instancePromise) return _instancePromise;
  _instancePromise = _init();
  return _instancePromise;
}

/** Synchronous accessor — null if not yet loaded. */
export function getOccSync(): OcctInstance | null {
  return _instance;
}

async function _init(): Promise<OcctInstance> {
  // Dynamic import of the factory JS — bypasses rolldown bundling.
  // The `?url` import above gives us the asset URL; at runtime the browser
  // fetches and executes it as an ES module.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factoryMod = await import(/* @vite-ignore */ occFactoryUrl) as any;
  const occFactory = factoryMod.default ?? factoryMod;

  const oc = await occFactory({
    locateFile() {
      // All .wasm extensions map to our asset-resolved URL
      return occWasmUrl;
    },
  });

  // Load modular WASM libraries sequentially (order matters for dependencies)
  for (const url of LIB_URLS) {
    await oc.loadDynamicLibrary(url, {
      loadAsync: true,
      global: true,
      nodelete: true,
      allowUndefined: true,
    });
  }

  // Warm-up: prime the C++ heap so the first real op doesn't pay cold-start cost
  try {
    const p = new oc.gp_Pnt_1();
    p.delete();
  } catch {
    // best-effort — some OCC versions name it differently
  }

  const inst: OcctInstance = {
    oc,
    get heap32() { return oc.HEAP32 as Int32Array; },
    get heapF64() { return oc.HEAPF64 as Float64Array; },
    malloc: (bytes: number) => oc._malloc(bytes) as number,
    free: (ptr: number) => oc._free(ptr),
    finalize: async () => {
      _instancePromise = null;
      _instance = null;
    },
  };
  _instance = inst;
  return inst;
}

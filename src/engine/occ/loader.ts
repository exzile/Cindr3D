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
// TKFeat — BRepFeat_SplitShape / BRepFeat_MakePrism (Split Face + silhouette
// imprint). Deps (TKBRep/TKTopAlgo/TKBO/TKBool/TKShHealing) are all listed above.
import urlTKFeat from 'opencascade.js/dist/module.TKFeat.wasm?url';
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

// Ordered load list — base dependencies before dependents.
// Each entry is [assetUrl, displayName] so the loading modal can show exactly
// which module is in-flight.
const LIBS: [url: string, name: string][] = [
  [urlTKMath,     'TKMath'],
  [urlTKService,  'TKService'],
  [urlTKG2d,      'TKG2d'],
  [urlTKG3d,      'TKG3d'],
  [urlTKGeomBase, 'TKGeomBase'],
  [urlTKBRep,     'TKBRep'],
  [urlTKGeomAlgo, 'TKGeomAlgo'],
  [urlTKTopAlgo,  'TKTopAlgo'],
  [urlTKShHealing,'TKShHealing'],
  [urlTKPrim,     'TKPrim'],
  [urlTKMesh,     'TKMesh'],
  [urlTKBO,       'TKBO'],
  [urlTKBool,     'TKBool'],
  [urlTKFillet,   'TKFillet'],
  [urlTKOffset,   'TKOffset'],
  [urlTKFeat,     'TKFeat'],
  [urlTKCDF,      'TKCDF'],
  [urlTKLCAF,     'TKLCAF'],
  [urlTKXSBase,   'TKXSBase'],
  [urlTKSTEPBase, 'TKSTEPBase'],
  [urlTKSTEPAttr, 'TKSTEPAttr'],
  [urlTKSTEP209,  'TKSTEP209'],
  [urlTKSTEP,     'TKSTEP'],
];

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instancePromise: Promise<OcctInstance> | null = null;
let _instance: OcctInstance | null = null;

// ── Load-progress tracking ────────────────────────────────────────────────────
// progress is 0..1; 1 means fully loaded.  Subscribers receive each update.
let _loadProgress = 0;
let _loadLabel = '';
/** progress: 0–1; label: human-readable description of the current step */
type ProgressCallback = (progress: number, label: string) => void;
const _progressCallbacks = new Set<ProgressCallback>();

function _emitProgress(p: number, label: string) {
  _loadProgress = p;
  _loadLabel = label;
  for (const cb of _progressCallbacks) cb(p, label);
}

/** Subscribe to OCC load progress (0 → 1) and step label. Returns an unsubscribe function. */
export function subscribeOccLoadProgress(cb: ProgressCallback): () => void {
  _progressCallbacks.add(cb);
  return () => _progressCallbacks.delete(cb);
}

/** Current load progress (0 = not started, 1 = fully loaded).
 *  Uses _loadProgress directly — _instance is set before post-load tasks run
 *  so we cannot use it as a 1.0 shortcut; only the final tick makes progress = 1. */
export function getOccLoadProgress(): number {
  return _loadProgress;
}

/** Human-readable label for the step currently in flight (empty once fully loaded). */
export function getOccLoadLabel(): string {
  return _instance ? '' : _loadLabel;
}

// ── Post-load tasks ───────────────────────────────────────────────────────────
// Tasks registered here run as part of _init() and are counted as progress
// steps, so the loading modal stays visible until they complete.
// Must be registered before getOcc() is called — tasks pushed after _init()
// has started are run immediately (OCC already loaded by then).
type PostLoadTask = { fn: () => Promise<void>; label: string };
const _postLoadTasks: PostLoadTask[] = [];

/**
 * Register a task to run at the end of the OCC load sequence.
 * The task counts as a progress step, keeping the loading modal alive until it
 * finishes.  `label` is shown in the modal while the task is running.
 * Call this **before** getOcc() — if OCC is already loaded the task runs
 * immediately (fire-and-forget).
 */
export function registerOccPostLoadTask(fn: () => Promise<void>, label: string): void {
  if (_instance) {
    void fn();
    return;
  }
  _postLoadTasks.push({ fn, label });
}

export async function getOcc(): Promise<OcctInstance> {
  // Check _instance first: post-load tasks that call getOcc() from inside _init()
  // would deadlock on _instancePromise (circular await). Returning the already-
  // constructed instance breaks the cycle.
  if (_instance) return _instance;
  if (_instancePromise) return _instancePromise;
  _instancePromise = _init();
  return _instancePromise;
}

/** Synchronous accessor — null if not yet loaded. */
export function getOccSync(): OcctInstance | null {
  return _instance;
}

/** Returns true once getOcc() has been called (loading in-flight or complete). */
export function isOccStarted(): boolean {
  return _instancePromise !== null;
}

async function _init(): Promise<OcctInstance> {
  // Total steps: factory init + N libs + 1 warm-up ping + any registered post-load tasks.
  // Post-load tasks must be registered before getOcc() is called to be counted here.
  const totalSteps = LIBS.length + 2 + _postLoadTasks.length;
  let step = 0;
  // announce: update label at current progress (shows what's about to run)
  const announce = (label: string) => _emitProgress(step / totalSteps, label);
  // tick: advance progress, keep current label
  const tick = () => _emitProgress(++step / totalSteps, _loadLabel);

  // Dynamic import of the factory JS — bypasses rolldown bundling.
  // The `?url` import above gives us the asset URL; at runtime the browser
  // fetches and executes it as an ES module.
  announce('Loading engine core');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factoryMod = await import(/* @vite-ignore */ occFactoryUrl) as any;
  const occFactory = factoryMod.default ?? factoryMod;

  const oc = await occFactory({
    locateFile() {
      // All .wasm extensions map to our asset-resolved URL
      return occWasmUrl;
    },
  });
  tick(); // factory + core WASM loaded

  // Load modular WASM libraries sequentially (order matters for dependencies)
  for (const [url, name] of LIBS) {
    announce(`Loading ${name}`);
    await oc.loadDynamicLibrary(url, {
      loadAsync: true,
      global: true,
      nodelete: true,
      allowUndefined: true,
    });
    tick();
  }

  // Warm-up: prime the C++ heap so the first real op doesn't pay cold-start cost
  announce('Warming up');
  try {
    const p = new oc.gp_Pnt_1();
    p.delete();
  } catch {
    // best-effort — some OCC versions name it differently
  }
  tick(); // warm-up done

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
  // Set _instance BEFORE running post-load tasks so that any task which calls
  // getOcc() internally (e.g. ensureOccBodyForFeature) gets the ready instance
  // immediately instead of awaiting _instancePromise and deadlocking.
  // _loadProgress is still < 1 here, so the modal stays visible.
  _instance = inst;

  // Run post-load tasks (e.g. BRep body restoration) while the modal is still visible.
  // Each task counts as one step — progress reaches 1.0 only after all tasks finish.
  for (const task of _postLoadTasks) {
    announce(task.label);
    try { await task.fn(); } catch { /* best-effort — don't block the loader */ }
    tick();
  }

  return inst;
}

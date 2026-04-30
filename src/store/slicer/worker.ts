import { freshWorkerUrl } from '../../workers/freshWorkerUrl';

let slicerWorker: Worker | null = null;
let slicerWorkerUrl: string | null = null;
let activeSliceRequestId = 0;
let workerBusy = false;

/** Debug toggle. `VITE_SLICER_DISABLE_CACHE=1` forces a fresh worker
 *  spawn on every `getSlicerWorker` call so iterating on slicer code
 *  can never silently hit a long-lived worker still running the
 *  previous bundle. Off by default (worker reuse is faster). */
const ALWAYS_FRESH_WORKER = (() => {
  const env = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, unknown> }).env) || {};
  const raw = env.VITE_SLICER_DISABLE_CACHE;
  return raw === '1' || raw === 'true' || raw === true;
})();

export function getSlicerWorker(onMessage: (e: MessageEvent) => void): Worker {
  // The URL is cache-busted with a per-page-load nonce so a fresh
  // page load always fetches a fresh worker bundle instead of
  // re-using the browser-cached one. See `freshWorkerUrl` for how
  // and why the nonce works.
  const currentUrl = freshWorkerUrl(new URL('../../workers/SlicerWorker.ts', import.meta.url));
  if (slicerWorker && (ALWAYS_FRESH_WORKER || slicerWorkerUrl !== currentUrl)) {
    slicerWorker.terminate();
    slicerWorker = null;
    slicerWorkerUrl = null;
    workerBusy = false;
  }
  if (!slicerWorker) {
    slicerWorker = new Worker(currentUrl, { type: 'module' });
    slicerWorkerUrl = currentUrl;
  }
  slicerWorker.onmessage = onMessage;
  return slicerWorker;
}

export function getCurrentSlicerWorker(): Worker | null {
  return slicerWorker;
}

export function isWorkerBusy(): boolean {
  return workerBusy;
}

export function setWorkerBusy(busy: boolean): void {
  workerBusy = busy;
}

export function nextSliceRequestId(): number {
  activeSliceRequestId += 1;
  return activeSliceRequestId;
}

export function getActiveSliceRequestId(): number {
  return activeSliceRequestId;
}

/**
 * Force-terminate and reset the slicer worker. The next call to
 * `getSlicerWorker` will spawn a fresh one with the latest code.
 *
 * Wired to Vite HMR in dev and a user-facing reload action, so stale
 * workers can be removed without hard-reloading the whole app.
 */
export function resetSlicerWorker(): void {
  if (slicerWorker) {
    slicerWorker.terminate();
    slicerWorker = null;
    slicerWorkerUrl = null;
  }
  workerBusy = false;
}

// Vite HMR hooks: workers are long-lived and do not automatically reload
// when their transitive imports change. Terminate the slicer worker for any
// dev-server update so the next Slice uses the latest wall/infill logic.
// Production builds strip `import.meta.hot` entirely.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', resetSlicerWorker);
  import.meta.hot.on('vite:beforeFullReload', resetSlicerWorker);
  import.meta.hot.dispose(resetSlicerWorker);
}

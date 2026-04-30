let slicerWorker: Worker | null = null;
let slicerWorkerUrl: string | null = null;
let activeSliceRequestId = 0;
let workerBusy = false;

export function getSlicerWorker(onMessage: (e: MessageEvent) => void): Worker {
  // In production builds this URL is content-hashed. In Vite dev it remains
  // the source URL, so transitive worker edits are handled by the HMR reset
  // hooks below instead of relying on a URL mismatch.
  const currentUrl = new URL('../../workers/SlicerWorker.ts', import.meta.url).href;
  if (slicerWorker && slicerWorkerUrl !== currentUrl) {
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

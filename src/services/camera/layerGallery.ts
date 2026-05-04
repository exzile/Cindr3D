import { strToU8, zipSync } from 'fflate';
import type { CameraStreamConfig, DuetPrefs } from '../../types/duet-prefs.types';
import { cameraDisplayUrl, enabledCamerasFromPrefs, prefsWithCamera, previewCameraStreamUrl } from '../../utils/cameraStreamUrl';

const DB_NAME = 'cindr3d-layer-gallery';
const DB_VERSION = 1;
const STORE_NAME = 'frames';

export interface LayerGalleryFrame {
  id: string;
  printerId: string;
  printerName: string;
  jobName: string;
  layer: number;
  cameraId: string;
  cameraLabel: string;
  createdAt: number;
  mimeType: string;
  size: number;
  blob: Blob;
}

export interface CaptureLayerGalleryInput {
  printerId: string;
  printerName: string;
  jobName: string;
  layer: number;
  prefs: DuetPrefs;
  fallbackUrl: string;
  retentionCap: number;
}

export function layerGalleryFrameId(printerId: string, jobName: string, layer: number, cameraId: string): string {
  return `${printerId}|${jobName}|${layer}|${cameraId}`.replace(/\s+/g, '_');
}

export function shouldCaptureLayer(previousLayer: number | undefined, nextLayer: number | undefined, status: string | undefined): boolean {
  if (nextLayer === undefined || nextLayer < 0) return false;
  if (status !== 'processing' && status !== 'simulating') return false;
  return previousLayer !== nextLayer;
}

export function safeLayerGalleryZipSegment(value: string, fallback = 'untitled'): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+$/, '')
    .replace(/^[._]+|[._]+$/g, '');
  return sanitized || fallback;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('printerJob', ['printerId', 'jobName'], { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open layer gallery database.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Layer gallery transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Layer gallery transaction aborted.'));
  });
}

async function saveFrame(frame: LayerGalleryFrame): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(frame);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function listLayerGalleryFrames(printerId?: string, jobName?: string): Promise<LayerGalleryFrame[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const frames = (request.result as LayerGalleryFrame[])
          .filter((frame) => (!printerId || frame.printerId === printerId) && (!jobName || frame.jobName === jobName))
          .sort((a, b) => a.layer - b.layer || a.cameraLabel.localeCompare(b.cameraLabel));
        resolve(frames);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to load layer gallery frames.'));
    });
  } finally {
    db.close();
  }
}

export async function clearLayerGalleryFrames(printerId?: string, jobName?: string): Promise<void> {
  const frames = await listLayerGalleryFrames(printerId, jobName);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const frame of frames) store.delete(frame.id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function enforceRetention(printerId: string, jobName: string, retentionCap: number): Promise<void> {
  if (retentionCap <= 0) return;
  const frames = await listLayerGalleryFrames(printerId, jobName);
  if (frames.length <= retentionCap) return;
  const overflow = [...frames].sort((a, b) => a.createdAt - b.createdAt).slice(0, frames.length - retentionCap);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const frame of overflow) store.delete(frame.id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function captureCameraSnapshot(
  input: Omit<CaptureLayerGalleryInput, 'prefs'> & { prefs: DuetPrefs; camera: CameraStreamConfig },
): Promise<LayerGalleryFrame | null> {
  if (input.camera.sourceType === 'browser-usb') return null;
  const cameraPrefs = prefsWithCamera(input.prefs, input.camera.id);
  const streamUrl = previewCameraStreamUrl(cameraPrefs, input.fallbackUrl);
  if (!streamUrl) return null;
  const displayUrl = cameraDisplayUrl(streamUrl, cameraPrefs.webcamUsername, cameraPrefs.webcamPassword);
  const response = await fetch(displayUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Camera ${input.camera.label} returned HTTP ${response.status}.`);
  const blob = await response.blob();
  const frame: LayerGalleryFrame = {
    id: layerGalleryFrameId(input.printerId, input.jobName, input.layer, input.camera.id),
    printerId: input.printerId,
    printerName: input.printerName,
    jobName: input.jobName,
    layer: input.layer,
    cameraId: input.camera.id,
    cameraLabel: input.camera.label,
    createdAt: Date.now(),
    mimeType: blob.type || 'image/jpeg',
    size: blob.size,
    blob,
  };
  await saveFrame(frame);
  return frame;
}

export async function captureLayerSnapshots(input: CaptureLayerGalleryInput): Promise<LayerGalleryFrame[]> {
  const cameras = enabledCamerasFromPrefs(input.prefs);
  const frames: LayerGalleryFrame[] = [];
  for (const camera of cameras) {
    try {
      const frame = await captureCameraSnapshot({ ...input, camera });
      if (frame) frames.push(frame);
    } catch {
      // One camera failing should not block the remaining layer captures.
    }
  }
  await enforceRetention(input.printerId, input.jobName, input.retentionCap);
  return frames;
}

export async function exportLayerGalleryZip(frames: LayerGalleryFrame[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const manifest = frames.map((frame) => ({
    printerId: frame.printerId,
    printerName: frame.printerName,
    jobName: frame.jobName,
    layer: frame.layer,
    cameraId: frame.cameraId,
    cameraLabel: frame.cameraLabel,
    createdAt: frame.createdAt,
    mimeType: frame.mimeType,
    size: frame.size,
  }));

  for (const frame of frames) {
    const ext = frame.mimeType.includes('png') ? 'png' : 'jpg';
    const jobName = safeLayerGalleryZipSegment(frame.jobName, 'job');
    const cameraLabel = safeLayerGalleryZipSegment(frame.cameraLabel, 'camera');
    const path = `${jobName}/layer-${String(frame.layer).padStart(5, '0')}/${cameraLabel}.${ext}`;
    files[path] = new Uint8Array(await frame.blob.arrayBuffer());
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files);
  const bytes = new Uint8Array(zipped.byteLength);
  bytes.set(zipped);
  return new Blob([bytes], { type: 'application/zip' });
}

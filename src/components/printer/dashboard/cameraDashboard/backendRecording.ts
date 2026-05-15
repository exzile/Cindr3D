/**
 * backendRecording — pure async helpers for the server-side RTSP capture
 * path that useCameraRecording can hand to. No React, no state — just
 * fetch + sessionStorage I/O.
 *
 * Server contract (cindr3d-proxy / browser-host):
 *   • POST /camera-rtsp-record?action=start  → { id, createdAt? }
 *   • POST /camera-rtsp-record?action=stop&id=… → blob + headers
 *   • GET  /camera-rtsp-record?action=status → { recordings: [{ id }] }
 *
 * The session blob persists across page refreshes via sessionStorage
 * so a running recording doesn't get stranded.
 *
 * Also includes `persistRecordedClip` — the post-stop helper that both
 * the backend and MediaRecorder paths use to write the final blob into
 * the clip store. Kept here so the messaging + size guard live in one
 * place instead of two slightly-different inline copies.
 */
import { backendRecordingStorageKey } from './prefsStorage';
import {
  saveClip, savedRecordingMessage,
  type BackendRecordingSession, type CameraClipKind, type CameraMarker,
} from './clipStore';

const ENDPOINT = '/camera-rtsp-record';

export interface StartBackendRecordingOptions {
  kind: Exclude<CameraClipKind, 'snapshot'>;
  quality: string;
  isServerUsbCamera: boolean;
  backendRecordingUrl: string;
}

export async function startBackendRecording(opts: StartBackendRecordingOptions): Promise<{ id: string; createdAt: number }> {
  const params = new URLSearchParams({
    action: 'start',
    kind: opts.kind,
    quality: opts.quality,
  });
  if (opts.isServerUsbCamera) {
    params.set('source', 'usb');
    params.set('device', opts.backendRecordingUrl);
  } else {
    params.set('url', opts.backendRecordingUrl);
  }
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await response.text() || 'Unable to start backend camera recording.');
  }
  const result = await response.json() as { id: string; createdAt?: number };
  return { id: result.id, createdAt: result.createdAt ?? Date.now() };
}

export async function stopBackendRecording(sessionId: string): Promise<{ blob: Blob; durationHeader: number | null }> {
  const response = await fetch(`${ENDPOINT}?action=stop&id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await response.text() || 'Unable to stop backend camera recording.');
  }
  const blob = await response.blob();
  const durationHeader = Number(response.headers.get('x-recording-duration-ms')) || null;
  return { blob, durationHeader };
}

export async function fetchBackendRecordingStatus(): Promise<{ recordings: Array<{ id: string }> }> {
  const response = await fetch(`${ENDPOINT}?action=status`, { cache: 'no-store' });
  if (!response.ok) return { recordings: [] };
  return response.json() as Promise<{ recordings: Array<{ id: string }> }>;
}

export function loadStoredBackendSession(printerId: string): BackendRecordingSession | null {
  const raw = window.sessionStorage.getItem(backendRecordingStorageKey(printerId));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as BackendRecordingSession;
    return { ...stored, markers: stored.markers ?? [] };
  } catch {
    window.sessionStorage.removeItem(backendRecordingStorageKey(printerId));
    return null;
  }
}

export function persistBackendSession(
  printerId: string,
  session: Pick<BackendRecordingSession, 'id' | 'kind' | 'jobName' | 'markers' | 'startedAt'>,
): void {
  window.sessionStorage.setItem(backendRecordingStorageKey(printerId), JSON.stringify(session));
}

export function clearBackendSession(printerId: string): void {
  window.sessionStorage.removeItem(backendRecordingStorageKey(printerId));
}

export interface PersistRecordedClipOptions {
  blob: Blob;
  durationMs: number;
  kind: CameraClipKind;
  jobName: string | undefined;
  markers: CameraMarker[];
  thumbnailBlob: Blob | undefined;
  mimeTypeFallback: string;
  printerId: string;
  printerName: string;
  saveErrorMessage: string;
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;
}

export async function persistRecordedClip(opts: PersistRecordedClipOptions): Promise<void> {
  if (opts.blob.size <= 0) {
    opts.setMessage('No video frames were captured.');
    return;
  }
  opts.setBusy(true);
  try {
    await saveClip({
      id: `${opts.printerId}-${Date.now()}`,
      printerId: opts.printerId,
      printerName: opts.printerName,
      kind: opts.kind,
      jobName: opts.jobName,
      markers: opts.markers,
      thumbnailBlob: opts.thumbnailBlob,
      createdAt: Date.now(),
      durationMs: opts.durationMs,
      mimeType: opts.blob.type || opts.mimeTypeFallback,
      size: opts.blob.size,
      blob: opts.blob,
    });
    opts.setMessage(savedRecordingMessage(opts.kind, opts.durationMs));
    await opts.refreshClips();
  } catch (error) {
    opts.setMessage(error instanceof Error ? error.message : opts.saveErrorMessage);
  } finally {
    opts.setBusy(false);
  }
}

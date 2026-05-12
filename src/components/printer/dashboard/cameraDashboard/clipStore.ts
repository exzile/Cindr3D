/**
 * IndexedDB-backed clip storage for the CameraDashboardPanel, plus the pure
 * clip-format / label helpers that previously lived inline in the panel.
 *
 * All exports here are React-free: the host component just imports them.
 */

export const CLIP_DB_NAME = 'cindr3d-camera-clips';
export const CLIP_DB_VERSION = 1;
export const CLIP_STORE = 'clips';

export const ISSUE_TAGS = ['Warping', 'Stringing', 'Layer shift', 'Blob', 'Adhesion', 'Under extrusion'] as const;
export const CLIP_RATINGS = ['Unrated', 'Good', 'Needs review', 'Failure evidence'] as const;
export const INSPECTION_ITEMS = ['First layer', 'Adhesion', 'Corners', 'Nozzle', 'Surface', 'Artifacts'] as const;

export type CameraClipKind = 'clip' | 'timelapse' | 'snapshot' | 'auto';
export type ClipFilter = 'all' | CameraClipKind | 'job' | 'favorite' | 'album' | 'issue';
export type ClipSort = 'newest' | 'oldest' | 'largest';
export type IssueTag = typeof ISSUE_TAGS[number];
export type ClipRating = typeof CLIP_RATINGS[number];

export interface SnapshotCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraMarker {
  id: string;
  atMs: number;
  label: string;
}

export interface CameraClip {
  id: string;
  printerId: string;
  printerName: string;
  name?: string;
  notes?: string;
  tags?: string[];
  favorite?: boolean;
  album?: string;
  kind?: CameraClipKind;
  jobName?: string;
  markers?: CameraMarker[];
  trimStartMs?: number;
  trimEndMs?: number;
  snapshotAdjustments?: {
    brightness: number;
    contrast: number;
    sharpen: number;
    crop: SnapshotCrop;
    annotation: string;
  };
  editedAt?: number;
  rating?: ClipRating;
  checklist?: string[];
  thumbnailBlob?: Blob;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  size: number;
  blob: Blob;
}

export interface BackendRecordingSession {
  id: string;
  kind: Exclude<CameraClipKind, 'snapshot'>;
  jobName?: string;
  markers: CameraMarker[];
  startedAt: number;
  thumbnailBlob?: Blob;
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

export function openClipDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIP_DB_NAME, CLIP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE)) {
        const store = db.createObjectStore(CLIP_STORE, { keyPath: 'id' });
        store.createIndex('printerId', 'printerId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open clip database.'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Clip database transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Clip database transaction aborted.'));
  });
}

export async function saveClip(clip: CameraClip): Promise<void> {
  const db = await openClipDb();
  try {
    const transaction = db.transaction(CLIP_STORE, 'readwrite');
    transaction.objectStore(CLIP_STORE).put(clip);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function deleteClip(id: string): Promise<void> {
  const db = await openClipDb();
  try {
    const transaction = db.transaction(CLIP_STORE, 'readwrite');
    transaction.objectStore(CLIP_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function loadClips(printerId: string): Promise<CameraClip[]> {
  const db = await openClipDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(CLIP_STORE, 'readonly').objectStore(CLIP_STORE).getAll();
      request.onsuccess = () => {
        const clips = (request.result as CameraClip[])
          .filter((clip) => clip.printerId === printerId)
          .sort((a, b) => b.createdAt - a.createdAt);
        resolve(clips);
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to load camera clips.'));
    });
  } finally {
    db.close();
  }
}

// ── Clip helpers ──────────────────────────────────────────────────────────────

export function formatClipDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function clipDurationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function parseClipDuration(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 1) return Math.round(parts[0] * 1000);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
}

export function clipKind(clip: CameraClip): CameraClipKind {
  return clip.kind ?? 'clip';
}

export function clipLabel(clip: CameraClip): string {
  if (clip.name?.trim()) return clip.name.trim();
  const kind = clipKind(clip);
  if (kind === 'snapshot') return 'Snapshot';
  if (kind === 'timelapse') return `${formatClipDuration(clip.durationMs)} timelapse`;
  if (kind === 'auto') return `${formatClipDuration(clip.durationMs)} auto recording`;
  return `${formatClipDuration(clip.durationMs)} camera clip`;
}

export function savedRecordingMessage(kind: CameraClipKind, durationMs: number): string {
  if (kind === 'timelapse') return `Saved ${formatClipDuration(durationMs)} timelapse.`;
  if (kind === 'auto') return `Saved ${formatClipDuration(durationMs)} auto recording.`;
  return `Saved ${formatClipDuration(durationMs)} clip.`;
}

export function clipFileExtension(clip: CameraClip): string {
  if (clipKind(clip) === 'snapshot') return 'png';
  if (clip.mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

export function isIssueTag(value: string): value is IssueTag {
  return (ISSUE_TAGS as readonly string[]).includes(value);
}

export function clipIssueTags(clip: CameraClip): IssueTag[] {
  return (clip.tags ?? [])
    .map((tag) => tag.startsWith('issue:') ? tag.slice(6) : '')
    .filter(isIssueTag);
}

export function clipExportName(clip: CameraClip, index: number): string {
  const label = clipLabel(clip).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || `camera-${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}-${label}.${clipFileExtension(clip)}`;
}

export function clipManifest(clip: CameraClip) {
  return {
    id: clip.id,
    name: clipLabel(clip),
    kind: clipKind(clip),
    favorite: Boolean(clip.favorite),
    album: clip.album,
    printerName: clip.printerName,
    jobName: clip.jobName,
    notes: clip.notes,
    tags: clip.tags,
    markers: clip.markers,
    rating: clip.rating,
    checklist: clip.checklist,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    snapshotAdjustments: clip.snapshotAdjustments,
    createdAt: new Date(clip.createdAt).toISOString(),
    editedAt: clip.editedAt ? new Date(clip.editedAt).toISOString() : undefined,
    durationMs: clip.durationMs,
    mimeType: clip.mimeType,
    size: clip.size,
  };
}

export function pickRecordingMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

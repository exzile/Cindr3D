/**
 * IndexedDB-backed photo store for calibration results.
 *
 * Photos are stored as Blobs keyed by a stable ID so they survive page reloads
 * without bloating localStorage (where the calibration result records live).
 * `CalibrationResult.photoIds` holds the IDs; this service maps each ID back
 * to its image data when the history view needs to render thumbnails.
 */

const DB_NAME = 'cindr3d-calibration-photos';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

export interface CalibrationPhotoRecord {
  id: string;
  printerId: string;
  itemId: string;        // CalibrationItemId from calibrationStore
  resultId: string;      // CalibrationResult.id this photo belongs to
  capturedAt: number;
  mimeType: string;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('resultId', 'resultId', { unique: false });
        store.createIndex('printerItem', ['printerId', 'itemId'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open calibration photo database.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Calibration photo transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Calibration photo transaction aborted.'));
  });
}

/** Convert a data URL ("data:image/jpeg;base64,...") into a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL.');
  const [, mimeType, payload] = match;
  const isBase64 = /;base64,/i.test(dataUrl);
  const raw = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Persist a single photo. Idempotent on `id` — replaces an existing record. */
export async function saveCalibrationPhoto(record: CalibrationPhotoRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/** Persist many photos in one transaction. */
export async function saveCalibrationPhotos(records: CalibrationPhotoRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function getCalibrationPhoto(id: string): Promise<CalibrationPhotoRecord | null> {
  const db = await openDb();
  try {
    return await new Promise<CalibrationPhotoRecord | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as CalibrationPhotoRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Calibration photo read failed.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteCalibrationPhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/** Returns an object URL for the photo blob. Caller must `URL.revokeObjectURL` when done. */
export async function getCalibrationPhotoObjectUrl(id: string): Promise<string | null> {
  const record = await getCalibrationPhoto(id);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

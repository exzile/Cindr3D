import * as THREE from 'three';
import type { SerializedGeom } from '../../types/slicer-persistence.types';

export type { SerializedGeom } from '../../types/slicer-persistence.types';

const MAX_PERSIST_VERTS = 500_000;
const geomSerializeCache = new WeakMap<THREE.BufferGeometry, SerializedGeom | null>();

export function serializeGeom(geometry: THREE.BufferGeometry | null | undefined): SerializedGeom | null {
  if (!geometry?.attributes?.position) return null;
  if (geomSerializeCache.has(geometry)) return geomSerializeCache.get(geometry)!;

  const positions = geometry.attributes.position.array as Float32Array;
  if (positions.length / 3 > MAX_PERSIST_VERTS) {
    geomSerializeCache.set(geometry, null);
    return null;
  }

  try {
    const serialized: SerializedGeom = { position: Array.from(positions) };
    if (geometry.index) {
      serialized.index = Array.from(geometry.index.array as Uint16Array | Uint32Array);
    }
    geomSerializeCache.set(geometry, serialized);
    return serialized;
  } catch {
    geomSerializeCache.set(geometry, null);
    return null;
  }
}

export function isBufferGeometry(geometry: unknown): geometry is THREE.BufferGeometry {
  if (geometry instanceof THREE.BufferGeometry) return true;
  return !!geometry &&
    typeof geometry === 'object' &&
    (geometry as { isBufferGeometry?: boolean }).isBufferGeometry === true;
}

export function deserializeGeom(data: SerializedGeom): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  if (data.index) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function openSlicerDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cindr3d-slicer', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await openSlicerDB();
      return new Promise((resolve) => {
        const tx = db.transaction('kv', 'readonly');
        const request = tx.objectStore('kv').get(name);
        request.onsuccess = () => {
          db.close();
          resolve(request.result ?? null);
        };
        request.onerror = () => {
          db.close();
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await openSlicerDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, name);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch {
      // Ignore storage errors in degraded browser environments.
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await openSlicerDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(name);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch {
      // Ignore storage errors in degraded browser environments.
    }
  },
};

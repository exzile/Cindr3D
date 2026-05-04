import * as THREE from 'three';

import type { Feature, Sketch } from '../../types/cad';

function openCadDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cindr3d-cad', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await openCadDB();
      return new Promise((resolve) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(name);
        req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
        req.onerror = () => { db.close(); resolve(null); };
      });
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await openCadDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } catch {
      // Storage unavailable; skip persist.
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await openCadDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(name);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } catch {
      // Ignore storage failures during cleanup.
    }
  },
};

const toVector3 = (value: unknown, fallback: [number, number, number]): THREE.Vector3 => {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  if (value && typeof value === 'object') {
    const vector = value as { x?: number; y?: number; z?: number };
    return new THREE.Vector3(Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
};

export const deserializeSketch = (sketch: Sketch): Sketch => ({
  ...sketch,
  planeNormal: toVector3((sketch as unknown as { planeNormal: unknown }).planeNormal, [0, 1, 0]),
  planeOrigin: toVector3((sketch as unknown as { planeOrigin: unknown }).planeOrigin, [0, 0, 0]),
});

const MESH_ONLY_TYPES = new Set([
  'fastener', 'derive', 'mesh-import', 'tessellate',
  'mesh-combine', 'mesh-smooth', 'mesh-separate', 'import', 'primitive',
]);

interface SerializedFeature extends Omit<Feature, 'mesh'> {
  _meshData?: {
    position: number[] | null;
    index: number[] | null;
    normal: number[] | null;
  };
}

type SerializedMeshData = {
  position: number[] | null;
  index: number[] | null;
  normal: number[] | null;
};

const serializedMeshDataCache = new WeakMap<THREE.BufferGeometry, SerializedMeshData>();
const serializedFeatureCache = new WeakMap<Feature, SerializedFeature>();

export const serializeFeature = (feature: Feature): SerializedFeature => {
  const topCached = serializedFeatureCache.get(feature);
  if (topCached) return topCached;
  const { mesh, ...rest } = feature;
  const serialized: SerializedFeature = { ...rest };
  if (MESH_ONLY_TYPES.has(feature.type) && mesh) {
    const geometry = (mesh as THREE.Mesh).geometry;
    if (geometry) {
      const cached = serializedMeshDataCache.get(geometry);
      if (cached) {
        serialized._meshData = cached;
      } else {
        const position = geometry.attributes.position?.array;
        const index = geometry.index?.array;
        const normal = geometry.attributes.normal?.array;
        const data: SerializedMeshData = {
          position: position ? Array.from(position) : null,
          index: index ? Array.from(index) : null,
          normal: normal ? Array.from(normal) : null,
        };
        serializedMeshDataCache.set(geometry, data);
        serialized._meshData = data;
      }
    }
  }
  serializedFeatureCache.set(feature, serialized);
  return serialized;
};

const REHYDRATED_FEATURE_MATERIAL: THREE.MeshPhysicalMaterial = (() => {
  const material = new THREE.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.2 });
  material.userData.shared = true;
  return material;
})();

export const deserializeFeature = (feature: Feature): Feature => {
  const serializedFeature = feature as unknown as SerializedFeature;
  if (MESH_ONLY_TYPES.has(feature.type) && serializedFeature._meshData) {
    const { position, index, normal } = serializedFeature._meshData;
    const geometry = new THREE.BufferGeometry();
    if (position) geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal), 3));
    else if (position) geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, REHYDRATED_FEATURE_MATERIAL);
    const { _meshData: _ignored, ...rest } = serializedFeature;
    void _ignored;
    return { ...(rest as unknown as Feature), mesh };
  }
  return { ...feature, mesh: undefined };
};

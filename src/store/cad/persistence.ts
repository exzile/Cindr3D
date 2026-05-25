import * as THREE from 'three';

import type { Feature, Sketch } from '../../types/cad';
import type { BodyTopology, ModelEdge } from '../../engine/geometryEngine/core/solid/edgeTypes';

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

type SerializedMeshData = {
  position: number[] | null;
  index: number[] | null;
  normal: number[] | null;
  edgeMeta?: SerializedEdgeMeta;
};

interface SerializedFeature extends Omit<Feature, 'mesh'> {
  _meshData?: SerializedMeshData;
}

type SerializedEdge = {
  id?: string;
  kind?: ModelEdge['kind'];
  polyline: number[][];
};

type SerializedTopology = {
  edges: SerializedEdge[];
};

type SerializedEdgeMeta = {
  topoV?: number;
  topology?: SerializedTopology;
};

const serializedMeshDataCache = new WeakMap<THREE.BufferGeometry, SerializedMeshData>();
const serializedFeatureCache = new WeakMap<Feature, SerializedFeature>();

function serializeTopology(topology: unknown): SerializedTopology | undefined {
  const edges = (topology as BodyTopology | undefined)?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return undefined;
  const serializedEdges = edges
    .map((edge): SerializedEdge | null => {
      if (!Array.isArray(edge.polyline) || edge.polyline.length < 2) return null;
      return {
        id: typeof edge.id === 'string' ? edge.id : undefined,
        kind: edge.kind === 'boundary' ? 'boundary' : 'crease',
        polyline: edge.polyline.map((p) => [p.x, p.y, p.z]),
      };
    })
    .filter((edge): edge is SerializedEdge => edge !== null);
  return serializedEdges.length ? { edges: serializedEdges } : undefined;
}

function deserializeTopology(topology: SerializedTopology | undefined): BodyTopology | undefined {
  if (!Array.isArray(topology?.edges) || topology.edges.length === 0) return undefined;
  const edges = topology.edges
    .map((edge): ModelEdge | null => {
      if (!Array.isArray(edge.polyline) || edge.polyline.length < 2) return null;
      return {
        id: typeof edge.id === 'string' ? edge.id : '',
        kind: edge.kind === 'boundary' ? 'boundary' : 'crease',
        polyline: edge.polyline.map((p) => new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0)),
      };
    })
    .filter((edge): edge is ModelEdge => edge !== null);
  return edges.length ? { edges } : undefined;
}

function serializeEdgeMeta(geometry: THREE.BufferGeometry): SerializedEdgeMeta | undefined {
  const topology = serializeTopology(geometry.userData.topology);
  const topoV = typeof geometry.userData._topoV === 'number' ? geometry.userData._topoV : undefined;
  if (!topology && topoV === undefined) return undefined;
  return { topoV, topology };
}

function restoreEdgeMeta(geometry: THREE.BufferGeometry, edgeMeta: SerializedEdgeMeta | undefined): void {
  if (!edgeMeta) return;
  const topology = deserializeTopology(edgeMeta.topology);
  if (topology) geometry.userData.topology = topology;
  if (typeof edgeMeta.topoV === 'number') geometry.userData._topoV = edgeMeta.topoV;
}

function shouldRebuildExtrudeMeshFromParams(feature: Feature): boolean {
  if (feature.type !== 'extrude') return false;
  if (feature.bodyKind === 'surface') return false;
  const operation =
    (feature.params.operation as string | undefined) ??
    (feature.params.extrudeOperation as string | undefined) ??
    'new-body';
  if (operation !== 'new-body') return false;
  if (feature.params.thin === true) return false;
  return (
    typeof feature.params.profileIndex === 'number' ||
    Array.isArray(feature.params.profileIndices)
  );
}

export const serializeFeature = (feature: Feature): SerializedFeature => {
  const topCached = serializedFeatureCache.get(feature);
  if (topCached && !feature.mesh) return topCached;
  const { mesh, ...rest } = feature;
  const serialized: SerializedFeature = { ...rest };
  // Serialize mesh geometry for features that carry explicit display mesh data.
  if (mesh) {
    const geometry = (mesh as THREE.Mesh).geometry;
    if (geometry) {
      const cached = serializedMeshDataCache.get(geometry);
      const edgeMeta = serializeEdgeMeta(geometry);
      if (cached) {
        serialized._meshData = { ...cached, edgeMeta };
      } else {
        const position = geometry.attributes.position?.array;
        const index = geometry.index?.array;
        const normal = geometry.attributes.normal?.array;
        const data: SerializedMeshData = {
          position: position ? Array.from(position) : null,
          index: index ? Array.from(index) : null,
          normal: normal ? Array.from(normal) : null,
          edgeMeta,
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
  if (shouldRebuildExtrudeMeshFromParams(serializedFeature as unknown as Feature)) {
    const { _meshData: _ignored, ...rest } = serializedFeature;
    void _ignored;
    return { ...(rest as unknown as Feature), mesh: undefined };
  }
  if (serializedFeature._meshData) {
    const { position, index, normal } = serializedFeature._meshData;
    const geometry = new THREE.BufferGeometry();
    if (position) geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal), 3));
    else if (position) geometry.computeVertexNormals();
    restoreEdgeMeta(geometry, serializedFeature._meshData.edgeMeta);
    const mesh = new THREE.Mesh(geometry, REHYDRATED_FEATURE_MATERIAL);
    const { _meshData: _ignored, ...rest } = serializedFeature;
    void _ignored;
    return { ...(rest as unknown as Feature), mesh };
  }
  return { ...feature, mesh: undefined };
};

import * as THREE from 'three';

import type { Feature, Sketch } from '../../types/cad';
import type { BodyTopology, ModelEdge } from '../../engine/geometryEngine/core/solid/edgeTypes';
import { getOcc, getOccSync } from '../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../engine/occ/globalRegistry';
import { attachTessellationToMesh, BREP_BODY_ID_KEY } from '../../engine/occ/picking';
import { isBRepBodyAlive } from '../../engine/occ/brepBody';
import { shapeFromStep, shapeToStep } from '../../engine/occ/stepIO';
import { tessellateWithInstance } from '../../engine/occ/tessellate';

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

/**
 * True when the active sketch carries content worth persisting (so an empty
 * scratch sketch isn't written into the saved sketch list). Shared by the .dznd
 * design-file writer and the IndexedDB autosave so both apply the same rule.
 */
export const shouldPersistActiveSketch = (activeSketch: Sketch | null): activeSketch is Sketch => (
  !!activeSketch && (
    activeSketch.entities.length > 0 ||
    activeSketch.constraints.length > 0 ||
    activeSketch.dimensions.length > 0
  )
);

/**
 * Merge the active sketch into the persisted sketches list: replace the existing
 * entry by id, or append it. Callers pre-filter with shouldPersistActiveSketch
 * (passing null when the active sketch is empty/transient).
 */
export const mergeActiveSketchForPersistence = (sketches: Sketch[], activeSketch: Sketch | null): Sketch[] => {
  if (!activeSketch) return sketches;
  const index = sketches.findIndex((sketch) => sketch.id === activeSketch.id);
  if (index < 0) return [...sketches, activeSketch];
  const next = [...sketches];
  next[index] = activeSketch;
  return next;
};

type SerializedMeshData = {
  position: number[] | null;
  index: number[] | null;
  normal: number[] | null;
  edgeMeta?: SerializedEdgeMeta;
};

type SerializedMaterialData = {
  color?: number;
  opacity?: number;
  transparent?: boolean;
};

type SerializedObjectData = {
  kind: 'group' | 'mesh' | 'line' | 'lineSegments';
  name?: string;
  visible?: boolean;
  matrix?: number[];
  geometry?: SerializedMeshData;
  material?: SerializedMaterialData;
  children?: SerializedObjectData[];
};

type SerializedOccBodyData = {
  bodyId: string;
  sourceFeatureId?: string;
  revision: number;
  stepString: string;
};

interface SerializedFeature extends Omit<Feature, 'mesh'> {
  _meshData?: SerializedMeshData;
  _objectData?: SerializedObjectData;
  _occStepData?: SerializedOccBodyData;
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
const serializedOccBodyCache = new WeakMap<object, SerializedOccBodyData>();

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

function serializeGeometryData(geometry: THREE.BufferGeometry): SerializedMeshData {
  const cached = serializedMeshDataCache.get(geometry);
  const edgeMeta = serializeEdgeMeta(geometry);
  if (cached) return { ...cached, edgeMeta };

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
  return data;
}

function deserializeGeometryData(data: SerializedMeshData): THREE.BufferGeometry {
  const { position, index, normal } = data;
  const geometry = new THREE.BufferGeometry();
  if (position) geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
  if (index) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  if (normal) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal), 3));
  else if (position) geometry.computeVertexNormals();
  restoreEdgeMeta(geometry, data.edgeMeta);
  return geometry;
}

function serializeMaterialData(material: THREE.Material | THREE.Material[] | null | undefined): SerializedMaterialData | undefined {
  const mat = Array.isArray(material) ? material[0] : material;
  if (!mat) return undefined;
  const maybeColor = mat as THREE.Material & { color?: THREE.Color };
  return {
    color: maybeColor.color instanceof THREE.Color ? maybeColor.color.getHex() : undefined,
    opacity: Number.isFinite(mat.opacity) ? mat.opacity : undefined,
    transparent: mat.transparent || undefined,
  };
}

function createRehydratedMeshMaterial(data: SerializedMaterialData | undefined): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: data?.color ?? 0x888888,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
    opacity: data?.opacity ?? 1,
    transparent: data?.transparent ?? false,
  });
  material.userData.shared = true;
  return material;
}

function createRehydratedLineMaterial(data: SerializedMaterialData | undefined): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({
    color: data?.color ?? 0x888888,
    opacity: data?.opacity ?? 1,
    transparent: data?.transparent ?? false,
  });
  material.userData.shared = true;
  return material;
}

function applySerializedTransform(object: THREE.Object3D, data: SerializedObjectData): void {
  if (!Array.isArray(data.matrix) || data.matrix.length !== 16) return;
  const matrix = new THREE.Matrix4().fromArray(data.matrix.map((entry) => Number(entry) || 0));
  matrix.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrix();
}

function serializeObject3D(object: THREE.Object3D): SerializedObjectData | undefined {
  object.updateMatrix();
  const base = {
    name: object.name || undefined,
    visible: object.visible === false ? false : undefined,
    matrix: object.matrix.toArray(),
  };

  if (object instanceof THREE.Group) {
    return {
      kind: 'group',
      ...base,
      children: object.children
        .map((child) => serializeObject3D(child))
        .filter((child): child is SerializedObjectData => !!child),
    };
  }
  if (object instanceof THREE.Mesh) {
    return {
      kind: 'mesh',
      ...base,
      geometry: serializeGeometryData(object.geometry),
      material: serializeMaterialData(object.material),
    };
  }
  if (object instanceof THREE.LineSegments) {
    return {
      kind: 'lineSegments',
      ...base,
      geometry: serializeGeometryData(object.geometry),
      material: serializeMaterialData(object.material),
    };
  }
  if (object instanceof THREE.Line) {
    return {
      kind: 'line',
      ...base,
      geometry: serializeGeometryData(object.geometry),
      material: serializeMaterialData(object.material),
    };
  }
  return undefined;
}

function deserializeObject3D(data: SerializedObjectData): THREE.Object3D | undefined {
  let object: THREE.Object3D;
  if (data.kind === 'group') {
    const group = new THREE.Group();
    for (const childData of data.children ?? []) {
      const child = deserializeObject3D(childData);
      if (child) group.add(child);
    }
    object = group;
  } else {
    if (!data.geometry) return undefined;
    const geometry = deserializeGeometryData(data.geometry);
    if (data.kind === 'mesh') {
      const mesh = new THREE.Mesh(geometry, createRehydratedMeshMaterial(data.material));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      object = mesh;
    } else if (data.kind === 'lineSegments') {
      object = new THREE.LineSegments(geometry, createRehydratedLineMaterial(data.material));
    } else {
      object = new THREE.Line(geometry, createRehydratedLineMaterial(data.material));
    }
  }

  if (data.name) object.name = data.name;
  if (data.visible === false) object.visible = false;
  applySerializedTransform(object, data);
  return object;
}

function restoreEdgeMeta(geometry: THREE.BufferGeometry, edgeMeta: SerializedEdgeMeta | undefined): void {
  if (!edgeMeta) return;
  const topology = deserializeTopology(edgeMeta.topology);
  if (topology) geometry.userData.topology = topology;
  if (typeof edgeMeta.topoV === 'number') geometry.userData._topoV = edgeMeta.topoV;
}

function serializeOccBodyData(feature: Feature, mesh: THREE.Mesh): SerializedOccBodyData | undefined {
  const bodyId = mesh.userData[BREP_BODY_ID_KEY] as string | undefined;
  if (!bodyId) return undefined;
  const body = globalBRepBodyRegistry.get(bodyId);
  const occ = getOccSync();
  if (!body || !occ) return (feature as unknown as SerializedFeature)._occStepData;

  const cached = serializedOccBodyCache.get(body as unknown as object);
  if (cached && cached.revision === body.revision) return cached;

  let result: ReturnType<typeof shapeToStep>;
  try {
    result = shapeToStep(occ.oc, body);
  } catch (err) {
    // Body shape may be an invalidated WASM reference (e.g. after HMR or
    // builder cleanup).  Fall back to previously cached STEP data.
    console.warn(`[persistence] shapeToStep threw for feature ${feature.id} (${feature.type}):`, err);
    return (feature as unknown as SerializedFeature)._occStepData;
  }
  if (!result.ok) {
    console.warn(
      `[persistence] shapeToStep failed for feature ${feature.id} (${feature.type}): ` +
      `${result.messages?.[0]?.message ?? 'unknown error'}`,
    );
    return (feature as unknown as SerializedFeature)._occStepData;
  }

  const data: SerializedOccBodyData = {
    bodyId,
    sourceFeatureId: body.sourceFeatureId ?? feature.id,
    revision: body.revision,
    stepString: result.value,
  };
  serializedOccBodyCache.set(body as unknown as object, data);
  return data;
}

export const serializeFeature = (feature: Feature): SerializedFeature => {
  const topCached = serializedFeatureCache.get(feature);
  if (topCached && !feature.mesh) return topCached;
  const { mesh, ...rest } = feature;
  const serialized: SerializedFeature = { ...rest };
  // Serialize mesh geometry for features that carry explicit display mesh data.
  if (mesh) {
    if (mesh instanceof THREE.Mesh) {
      serialized._meshData = serializeGeometryData(mesh.geometry);
      const occStepData = serializeOccBodyData(feature, mesh);
      if (occStepData) serialized._occStepData = occStepData;
    } else {
      const objectData = serializeObject3D(mesh);
      if (objectData) serialized._objectData = objectData;
    }
  }
  serializedFeatureCache.set(feature, serialized);
  return serialized;
};

const REHYDRATED_FEATURE_MATERIAL: THREE.MeshPhysicalMaterial = (() => {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x888888,
    roughness: 0.4,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  material.userData.shared = true;
  return material;
})();

export const deserializeFeature = (feature: Feature): Feature => {
  const serializedFeature = feature as unknown as SerializedFeature;
  // NOTE: shouldRebuildExtrudeMeshFromParams previously stripped mesh data here so
  // that ExtrudedBodies could rebuild OCC extrudes via migrateLegacyExtrudeFeatures.
  // That rebuild path was removed (legacyMigration.ts deleted) — ExtrudedBodies now
  // renders stored meshes directly. Stripping without rebuilding leaves features
  // invisible after reload, so we skip the check and fall through to restore the
  // serialized _meshData normally.
  if (serializedFeature._meshData) {
    const geometry = deserializeGeometryData(serializedFeature._meshData);
    const mesh = new THREE.Mesh(geometry, REHYDRATED_FEATURE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Restore brepBodyId so the fillet/chamfer path can find the body's STEP data.
    if (serializedFeature._occStepData?.bodyId) {
      mesh.userData[BREP_BODY_ID_KEY] = serializedFeature._occStepData.bodyId;
    }
    const { _meshData: _ignored, ...rest } = serializedFeature;
    void _ignored;
    return { ...(rest as unknown as Feature), mesh };
  }
  if (serializedFeature._objectData) {
    const mesh = deserializeObject3D(serializedFeature._objectData);
    const { _objectData: _ignored, ...rest } = serializedFeature;
    void _ignored;
    return { ...(rest as unknown as Feature), mesh };
  }
  return { ...feature, mesh: undefined };
};

export async function ensureFeatureOccBody(feature: Feature): Promise<boolean> {
  const serializedFeature = feature as unknown as SerializedFeature;
  const mesh = feature.mesh;
  if (!(mesh instanceof THREE.Mesh)) return false;

  const liveBodyId = mesh.userData[BREP_BODY_ID_KEY] as string | undefined;
  if (liveBodyId) {
    const liveBody = globalBRepBodyRegistry.get(liveBodyId);
    if (liveBody && isBRepBodyAlive(liveBody)) {
      return true;
    }
    // Body exists but shape is stale — evict so we fall through to STEP restore.
    if (liveBody) globalBRepBodyRegistry.delete(liveBodyId);
  }

  const occStepData = serializedFeature._occStepData;
  if (!occStepData?.stepString || !occStepData.bodyId) return false;

  const existing = globalBRepBodyRegistry.get(occStepData.bodyId);
  if (existing && isBRepBodyAlive(existing)) {
    const { oc } = await getOcc();
    const tessellation = tessellateWithInstance(oc, existing);
    attachTessellationToMesh(mesh, tessellation, existing.id);
    return true;
  }
  // Evict stale body if present.
  if (existing) globalBRepBodyRegistry.delete(occStepData.bodyId);

  const { oc } = await getOcc();
  const result = shapeFromStep(oc, occStepData.stepString);
  if (!result.ok) {
    console.warn(`[persistence] Failed to restore OCC body for ${feature.id}: ${result.messages[0]?.message ?? 'unknown error'}`);
    return false;
  }

  const body = result.value;
  body.id = occStepData.bodyId;
  body.sourceFeatureId = occStepData.sourceFeatureId ?? feature.id;
  globalBRepBodyRegistry.add(body);

  const tessellation = tessellateWithInstance(oc, body);
  attachTessellationToMesh(mesh, tessellation, body.id);
  return true;
}

/**
 * Synchronous variant of ensureFeatureOccBody for use in sync call paths
 * (e.g. fillet/chamfer which use getOccSync). Returns the refreshed BRepBody
 * if the body was stale and successfully restored from STEP, or the existing
 * live body. Returns undefined if OCC isn't loaded yet or STEP data is missing.
 */
export function refreshStaleBodySync(feature: Feature, bodyId: string): boolean {
  const serializedFeature = feature as unknown as SerializedFeature;
  const occStepData = serializedFeature._occStepData;
  if (!occStepData?.stepString) return false;

  const occ = getOccSync();
  if (!occ) return false;

  // Evict the stale body.
  globalBRepBodyRegistry.delete(bodyId);

  const result = shapeFromStep(occ.oc, occStepData.stepString);
  if (!result.ok) {
    console.warn(`[persistence] Sync STEP restore failed for ${feature.id}: ${result.messages[0]?.message ?? 'unknown error'}`);
    return false;
  }

  const body = result.value;
  body.id = occStepData.bodyId ?? bodyId;
  body.sourceFeatureId = occStepData.sourceFeatureId ?? feature.id;
  globalBRepBodyRegistry.add(body);

  // Re-tessellate and attach to mesh if present.
  const mesh = feature.mesh;
  if (mesh instanceof THREE.Mesh) {
    const tessellation = tessellateWithInstance(occ.oc, body);
    attachTessellationToMesh(mesh, tessellation, body.id);
  }
  return true;
}

/**
 * Live body-mesh registry.
 *
 * BodyMesh (ExtrudedBodies) registers its THREE.Mesh here by the mesh's own
 * THREE.js UUID on mount and unregisters on unmount.  commitFillet (and future
 * store actions) read from here to obtain the rendered geometry for extrude
 * features, which never store their mesh in feature.mesh — they are computed
 * on-the-fly in ExtrudedBodies.useMemo and passed as a geometry prop to
 * BodyMesh.
 *
 * Key: mesh.uuid (stable for the lifetime of the THREE.Mesh object).
 * Intentionally lives outside Zustand so it is never serialised or persisted.
 *
 * Implementation note — globalThis singletons:
 *   Vite's HMR can re-evaluate this module when its importers change, producing
 *   a second Map instance.  BodyMesh (ExtrudedBodies) writes to the first
 *   instance while EdgeOpPreview reads from the second, causing a permanent
 *   MISS even though the mesh is registered.  Storing the Maps on globalThis
 *   means every re-evaluation picks up the existing instance instead of
 *   creating a new empty one, so HMR never splits the registries.
 */
import type * as THREE from 'three';

const _g = globalThis as Record<string, unknown>;

// ── Live body-mesh registry ──────────────────────────────────────────────────
/** mesh.uuid → live rendered THREE.Mesh (identity matrixWorld, geometry in world-space) */
_g.__cindr3d_liveBodyMeshes__ ??= new Map<string, THREE.Mesh>();
export const liveBodyMeshes = _g.__cindr3d_liveBodyMeshes__ as Map<string, THREE.Mesh>;

// ── Persistent geometry caches ───────────────────────────────────────────────
/**
 * Persistent geometry cache that survives viewport unmounts (e.g. navigating
 * to the slicer).  ExtrudedBodies writes a cloned BufferGeometry here keyed
 * by featureId whenever its CSG pipeline recomputes.  The slicer's
 * "Add from CAD" reads from here so it receives real geometry even when the
 * design viewport is not mounted.
 *
 * Key: feature.id  Value: cloned THREE.BufferGeometry (owned by the cache)
 */
_g.__cindr3d_bodyGeometryCache__ ??= new Map<string, THREE.BufferGeometry>();
export const bodyGeometryCache = _g.__cindr3d_bodyGeometryCache__ as Map<string, THREE.BufferGeometry>;

/**
 * Same as bodyGeometryCache but keyed by bodyId (from componentStore).
 * Multiple disconnected pieces sharing a bodyId are merged into one geometry.
 * Used by the slicer "Add from CAD" which lists Bodies, not raw features.
 *
 * Key: body.id  Value: cloned THREE.BufferGeometry (owned by the cache)
 */
_g.__cindr3d_bodyIdGeometryCache__ ??= new Map<string, THREE.BufferGeometry>();
export const bodyIdGeometryCache = _g.__cindr3d_bodyIdGeometryCache__ as Map<string, THREE.BufferGeometry>;

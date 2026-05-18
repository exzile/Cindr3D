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
 */
import type * as THREE from 'three';

/** mesh.uuid → live rendered THREE.Mesh (identity matrixWorld, geometry in world-space) */
export const liveBodyMeshes = new Map<string, THREE.Mesh>();

/**
 * Persistent geometry cache that survives viewport unmounts (e.g. navigating
 * to the slicer).  ExtrudedBodies writes a cloned BufferGeometry here keyed
 * by featureId whenever its CSG pipeline recomputes.  The slicer's
 * "Add from CAD" reads from here so it receives real geometry even when the
 * design viewport is not mounted.
 *
 * Key: feature.id  Value: cloned THREE.BufferGeometry (owned by the cache)
 */
export const bodyGeometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * Same as bodyGeometryCache but keyed by bodyId (from componentStore).
 * Multiple disconnected pieces sharing a bodyId are merged into one geometry.
 * Used by the slicer "Add from CAD" which lists Bodies, not raw features.
 *
 * Key: body.id  Value: cloned THREE.BufferGeometry (owned by the cache)
 */
export const bodyIdGeometryCache = new Map<string, THREE.BufferGeometry>();

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

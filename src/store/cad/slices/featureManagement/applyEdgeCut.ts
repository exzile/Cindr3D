/**
 * applyEdgeCut — shared commit flow for edge-modification tools.
 *
 * commitFillet and commitChamfer are identical apart from which edge-ID list
 * they read, the parse fn, the geometry fn, and the status wording. This
 * captures the common pipeline once:
 *   validate → parse → find source feature → resolveBodySource → compute new
 *   geometry → pushUndo → swap mesh in (mesh-backed propagates boolean
 *   dependents; primitive/extrude stores the mesh so the CSG/primitive
 *   render path skips it).
 */
import * as THREE from 'three';
import type { ParsedEdges } from '../../../../utils/geometry/edgeCutCore';
import type { CADSliceContext } from '../../sliceContext';
import { recomputeBooleanDependents } from './featureBooleanUtils';
import { resolveBodySource } from './resolveBodySource';

export interface EdgeCutSpec {
  /** 'Fillet' | 'Chamfer' — used in status messages. */
  tool: string;
  /** The picked edge IDs (filletEdgeIds / chamferEdgeIds). */
  edgeIds: string[];
  /** True when the primary size parameter is > 0. */
  sizeValid: boolean;
  /** Shared edge-ID parser (parseFilletEdgeIds / parseChamferEdgeIds). */
  parse: (ids: string[]) => ParsedEdges | null;
  /** Build the cut geometry from a non-indexed world-space source. */
  compute: (srcGeo: THREE.BufferGeometry, edges: ParsedEdges['edges']) => THREE.BufferGeometry | null;
  /** Verb for the success message, e.g. `Filleted` / `Chamfered`. */
  pastVerb: string;
  /** Size suffix for the success message, e.g. `r=2` / `d=1.5`. */
  sizeLabel: string;
}

export function applyEdgeCut(store: CADSliceContext, spec: EdgeCutSpec): void {
  const { get, set } = store;
  const { tool, edgeIds, sizeValid, parse, compute, pastVerb, sizeLabel } = spec;

  if (!sizeValid || edgeIds.length === 0) {
    get().setStatusMessage(`${tool}: pick edges and set a size > 0`);
    return;
  }
  const parsed = parse(edgeIds);
  if (!parsed) { get().setStatusMessage(`${tool}: no valid edges parsed`); return; }
  const { featureId: targetFid, meshUuid: targetMeshUuid, edges } = parsed;

  const features = get().features;
  const feature = targetFid
    ? features.find((f) => f.id === targetFid)
    : features.find((f) => f.mesh instanceof THREE.Mesh && (f.mesh as THREE.Object3D).uuid === targetMeshUuid);
  if (!feature) {
    get().setStatusMessage(`${tool}: selected edges are not on a solid/surface body`);
    return;
  }

  const src = resolveBodySource(feature, targetMeshUuid);
  if ('error' in src) { get().setStatusMessage(`${tool}: ${src.error}`); return; }
  const { srcGeo, srcMaterial, hasMesh, oldGeomToDispose } = src;

  const newGeo = compute(srcGeo, edges);
  srcGeo.dispose();
  if (!newGeo) {
    get().setStatusMessage(`${tool}: no eligible edges (need an edge shared by two faces)`);
    return;
  }

  get().pushUndo();
  const newMesh = new THREE.Mesh(newGeo, srcMaterial);
  newMesh.userData = hasMesh
    ? { ...(feature.mesh as THREE.Mesh).userData }
    : { pickable: true, featureId: feature.id };
  newMesh.castShadow = true;
  newMesh.receiveShadow = true;

  const statusMessage = `${pastVerb} ${edges.length} edge(s) at ${sizeLabel}`;
  if (hasMesh) {
    // Mesh-backed feature: replace mesh and propagate boolean dependents.
    set((state) => ({
      features: recomputeBooleanDependents(
        state.features.map((f) => (f.id === feature.id ? { ...f, mesh: newMesh } : f)),
        [feature.id],
      ),
      statusMessage,
    }));
    if (oldGeomToDispose) setTimeout(() => oldGeomToDispose.dispose(), 0);
  } else {
    // Primitive OR extrude (from registry): store the cut mesh so
    // PrimitiveBodies skips it (skip-if-mesh guard) and ExtrudedBodies
    // renders it via the stored-mesh path (the CSG pipeline also skips it
    // because of the `!f.mesh` filter in its feature list).
    set((state) => ({
      features: state.features.map((f) => (f.id === feature.id ? { ...f, mesh: newMesh } : f)),
      statusMessage,
    }));
  }
}

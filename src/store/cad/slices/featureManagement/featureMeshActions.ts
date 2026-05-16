import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { recomputeBooleanDependents, runBoolean } from './featureBooleanUtils';
import { errorMessage } from '../../../../utils/errorHandling';
import { liveBodyMeshes } from '../../../../store/meshRegistry';
import { parseFilletEdgeIds, computeFilletGeometry } from '../../../../utils/geometry/filletGeometry';

function getBooleanParentIds(feature: Feature): string[] {
  const fromArray = feature.params.booleanParentIds;
  if (Array.isArray(fromArray)) return fromArray.filter((id): id is string => typeof id === 'string');
  return [feature.params.targetId, feature.params.toolId].filter((id): id is string => typeof id === 'string');
}

function keepsParentsHidden(feature: Feature): boolean {
  return feature.type === 'combine' && feature.params.keepTools === false;
}

function parentIsHiddenByAnotherCombine(features: Feature[], parentId: string, excludeCombineId: string): boolean {
  return features.some((feature) =>
    feature.id !== excludeCombineId &&
    keepsParentsHidden(feature) &&
    getBooleanParentIds(feature).includes(parentId),
  );
}

function syncActiveConfigurationSuppression(
  state: CADState,
  entries: Record<string, boolean>,
): CADState['designConfigurations'] {
  const updatedAt = Date.now();
  return state.designConfigurations.map((configuration) =>
    configuration.id === state.activeDesignConfigurationId
      ? {
          ...configuration,
          featureSuppression: {
            ...configuration.featureSuppression,
            ...entries,
          },
          updatedAt,
        }
      : configuration,
  );
}

export function createFeatureMeshActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // D119 Tessellate
  tessellateFeature: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const geom = GeometryEngine.extractMeshGeometry(feature.mesh as THREE.Mesh | THREE.Group);
    if (!geom) {
      get().setStatusMessage('No mesh found on selected feature');
      return;
    }
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    const newMesh = new THREE.Mesh(geom, mat);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const n = features.filter((f) => f.params.kind === 'tessellate').length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Tessellate ${n}`,
      type: 'primitive',
      params: { kind: 'tessellate' },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: newMesh,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Feature tessellated as mesh body',
    }));
  },
  // D125 Mesh Reduce
  reduceMesh: (featureId, reductionPercent) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Reduce: selected feature has no mesh');
      return;
    }
    // Build a new simplified mesh rather than mutating the existing one in-place.
    // Mutating geometry on a Zustand-owned object bypasses set() and leaves
    // React unaware of the change. Instead we clone, simplify, then replace
    // the feature in state via set().
    const applyToMesh = async (m: THREE.Mesh): Promise<THREE.Mesh> => {
      const newGeom = await GeometryEngine.simplifyGeometry(m.geometry, reductionPercent);
      const clone = new THREE.Mesh(newGeom, m.material);
      clone.castShadow = m.castShadow;
      clone.receiveShadow = m.receiveShadow;
      Object.assign(clone.userData, m.userData);
      return clone;
    };
    const featureMesh = feature.mesh as THREE.Object3D;
    // Re-validate the feature/mesh AFTER the await Ã¢â‚¬â€ by the time the simplify
    // promise resolves, the user could have deleted the feature, replaced its
    // mesh, or kicked off another reduce. Without this guard the post-await
    // set() would write the new mesh into whatever feature row currently has
    // the matching id, and dispose a mesh that's already been replaced.
    const stillValid = (currentMesh: THREE.Object3D | null | undefined): boolean => {
      const live = get().features.find((f) => f.id === featureId);
      return !!live && live.mesh === currentMesh;
    };
    const onErr = (err: unknown) => {
      get().setStatusMessage(`Mesh Reduce failed: ${errorMessage(err, 'unknown error')}`);
    };
    if (featureMesh instanceof THREE.Mesh) {
      applyToMesh(featureMesh).then((newMesh) => {
        if (!stillValid(featureMesh)) {
          // Stale Ã¢â‚¬â€ drop the freshly built mesh so we don't leak it
          newMesh.geometry.dispose();
          return;
        }
        const oldMesh = feature.mesh;
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newMesh } : f,
          ),
        }));
        // Dispose old geometry AFTER removing from state
        if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else if (featureMesh instanceof THREE.Group) {
      const meshes: THREE.Mesh[] = [];
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      Promise.all(meshes.map(applyToMesh)).then((newMeshes) => {
        if (!stillValid(featureMesh)) {
          // Stale Ã¢â‚¬â€ drop all freshly built meshes' geometries
          for (const m of newMeshes) m.geometry.dispose();
          return;
        }
        const oldGroup = feature.mesh;
        const newGroup = new THREE.Group();
        newMeshes.forEach((m) => newGroup.add(m));
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId ? { ...f, mesh: newGroup as unknown as THREE.Mesh } : f,
          ),
        }));
        // Dispose old geometries AFTER removal
        if (oldGroup instanceof THREE.Group) {
          oldGroup.traverse((child) => {
            if (child instanceof THREE.Mesh) child.geometry.dispose();
          });
        }
        get().setStatusMessage(`Mesh reduced by ${reductionPercent}%`);
      }).catch(onErr);
    } else {
      get().setStatusMessage('Mesh Reduce: feature is not simplifiable');
    }
  },
  // D115 Reverse Normals
  reverseNormals: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: selected feature has no mesh');
      return;
    }
    const featureMesh = feature.mesh as THREE.Object3D;
    if (featureMesh instanceof THREE.Mesh) {
      GeometryEngine.reverseNormals(featureMesh.geometry);
    } else if (featureMesh instanceof THREE.Group) {
      featureMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) GeometryEngine.reverseNormals(child.geometry);
      });
    }
    // Mutating mesh.geometry in place doesn't notify Zustand subscribers Ã¢â‚¬â€ replace
    // the features array reference so the timeline / re-renderers see the change.
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f } : f),
    }));
    get().setStatusMessage('Normals reversed');
  },
  // UTL1 Ã¢â‚¬â€ Show All / Hide
  showAllFeatures: () => set((state) => ({
    features: state.features.map((f) => ({ ...f, visible: true })),
    statusMessage: 'All features shown',
  })),
  hideFeature: (id) => set((state) => ({
    features: state.features.map((f) => f.id === id ? { ...f, visible: false } : f),
    statusMessage: 'Feature hidden',
  })),

  // MSH8 Ã¢â‚¬â€ commitReverseNormal: clone geometry with flipped normals
  commitReverseNormal: (featureId) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Reverse Normal: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Reverse Normal: feature is not a mesh');
      return;
    }
    const newMesh = GeometryEngine.reverseMeshNormals(srcMesh);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    // Dispose the previous geometry Ã¢â‚¬â€ reverseMeshNormals returns a fresh
    // mesh with cloned geometry, so the source's BufferGeometry is now orphan.
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh normals reversed',
    }));
    if (oldMesh instanceof THREE.Mesh) oldMesh.geometry.dispose();
  },

  // MSH7 Ã¢â‚¬â€ commitMeshCombine: merge all listed feature meshes into one
  commitMeshCombine: (featureIds) => {
    const { features } = get();
    const meshes: THREE.Mesh[] = [];
    for (const fid of featureIds) {
      const f = features.find((x) => x.id === fid);
      if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
    }
    if (meshes.length < 2) {
      get().setStatusMessage('Mesh Combine: need at least 2 mesh features');
      return;
    }
    const combined = GeometryEngine.combineMeshes(meshes);
    combined.castShadow = true;
    combined.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mesh Combine')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mesh Combine ${n}`,
      type: 'import',
      params: { featureKind: 'mesh-combine', sourceIds: featureIds.join(',') },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: combined,
      bodyKind: 'mesh',
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: 'Meshes combined',
    }));
  },

  // MSH11 Ã¢â‚¬â€ commitMeshTransform: apply translate/rotate/scale to a mesh
  commitMeshTransform: (featureId, params) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mesh Transform: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mesh Transform: feature is not a mesh');
      return;
    }
    // Validate inputs before mutating Ã¢â‚¬â€ scale=0 collapses the mesh permanently
    // and there's no rollback path. NaN/Infinity rotations propagate into
    // the geometry and corrupt every downstream raycast.
    const finite = (v: number) => Number.isFinite(v);
    if (!finite(params.tx) || !finite(params.ty) || !finite(params.tz) ||
        !finite(params.rx) || !finite(params.ry) || !finite(params.rz) ||
        !finite(params.scale) || params.scale === 0) {
      get().setStatusMessage('Mesh Transform: invalid params (translate/rotate must be finite, scale != 0)');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.transformMesh(srcMesh, params);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldMesh = feature.mesh;
    set((state) => ({
      features: state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f),
      statusMessage: 'Mesh transformed',
    }));
    // Defer disposal so undo can still reference the old geometry.
    // setTimeout(0) ensures the set() completes and state is stable first.
    if (oldMesh instanceof THREE.Mesh) {
      const geo = oldMesh.geometry;
      setTimeout(() => geo.dispose(), 0);
    }
  },

  // SLD13 Ã¢â‚¬â€ commitScale: scale a feature mesh by sx/sy/sz
  commitScale: (featureId, sx, sy, sz) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Scale: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Scale: feature is not a mesh');
      return;
    }
    // Validate before mutating Ã¢â‚¬â€ any zero axis flattens the mesh permanently.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz) ||
        sx === 0 || sy === 0 || sz === 0) {
      get().setStatusMessage('Scale: factors must be finite and non-zero');
      return;
    }
    get().pushUndo();
    const newMesh = GeometryEngine.scaleMesh(srcMesh, sx, sy, sz);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldGeom = srcMesh.geometry;
    set((state) => {
      const features = state.features.map((f) => f.id === featureId ? { ...f, mesh: newMesh } : f);
      return {
        features: recomputeBooleanDependents(features, [featureId]),
        statusMessage: `Scaled ${sx}×${sy}×${sz}`,
      };
    });
    // Defer so the undo snapshot can still reference the old geometry if needed.
    setTimeout(() => oldGeom.dispose(), 0);
  },

  // Align tool — geometry-pair picking state
  alignPickStage: 'idle',
  alignPickKind: 'face',
  alignSource: null,
  alignTarget: null,
  setAlignPickStage: (stage) => set({ alignPickStage: stage }),
  setAlignPickKind: (kind) => set({ alignPickKind: kind }),
  setAlignSource: (pick) => set({ alignSource: pick }),
  setAlignTarget: (pick) => set({ alignTarget: pick }),
  resetAlign: () => set({ alignPickStage: 'idle', alignSource: null, alignTarget: null }),

  // Align tool — compute rigid transform from picked source→target geometry
  // and apply it to the source body (primitive via params, else bake mesh).
  commitAlign: (opts) => {
    const { alignSource, alignTarget, features } = get();
    if (!alignSource || !alignTarget) {
      get().setStatusMessage('Align: pick a source and a target geometry first');
      return;
    }
    if (!alignSource.featureId) {
      get().setStatusMessage('Align: source must be on a body');
      return;
    }
    const feature = features.find((f) => f.id === alignSource.featureId);
    if (!feature) {
      get().setStatusMessage('Align: source body not found');
      return;
    }

    const srcPt = new THREE.Vector3(...alignSource.point);
    const tgtPt = new THREE.Vector3(...alignTarget.point);

    const wantRotation =
      opts.moveType === 'rotate' || (opts.moveType === 'align' && opts.allowRotation);

    // Rotation aligning source direction → desired target direction.
    const rot = new THREE.Quaternion();
    if (wantRotation && alignSource.dir && alignTarget.dir) {
      const sDir = new THREE.Vector3(...alignSource.dir).normalize();
      let tDir = new THREE.Vector3(...alignTarget.dir).normalize();
      // Faces mate when normals oppose (flip = same dir). Edges align when
      // directions match (flip = reversed).
      const bothFaces = alignSource.kind === 'face' && alignTarget.kind === 'face';
      if (bothFaces ? !opts.flip : opts.flip) tDir = tDir.negate();
      if (sDir.lengthSq() > 1e-9 && tDir.lengthSq() > 1e-9) {
        rot.setFromUnitVectors(sDir, tDir);
      }
    }

    // World transform M applied to the source body:
    //  align     : T(tgt) · R · T(-src)   (rotate about src point, move to tgt)
    //  rotate    : T(src) · R · T(-src)   (rotate in place about src point)
    //  translate : T(tgt - src)           (pure translation, no rotation)
    const M = new THREE.Matrix4();
    if (opts.moveType === 'translate') {
      M.makeTranslation(tgtPt.x - srcPt.x, tgtPt.y - srcPt.y, tgtPt.z - srcPt.z);
    } else {
      const pivotBack = new THREE.Matrix4().makeTranslation(-srcPt.x, -srcPt.y, -srcPt.z);
      const Rm = new THREE.Matrix4().makeRotationFromQuaternion(rot);
      const dest = opts.moveType === 'rotate' ? srcPt : tgtPt;
      const post = new THREE.Matrix4().makeTranslation(dest.x, dest.y, dest.z);
      M.multiplyMatrices(post, Rm).multiply(pivotBack);
    }

    get().pushUndo();

    // Primitive bodies are regenerated from params each render — write the
    // transform back into x/y/z + rx/ry/rz instead of baking geometry.
    if (feature.type === 'primitive' && !(feature.mesh instanceof THREE.Mesh)) {
      const p = feature.params;
      const curPos = new THREE.Vector3(
        (p.x as number) || 0, (p.y as number) || 0, (p.z as number) || 0,
      );
      const curQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad((p.rx as number) || 0),
        THREE.MathUtils.degToRad((p.ry as number) || 0),
        THREE.MathUtils.degToRad((p.rz as number) || 0),
        'XYZ',
      ));
      const curMat = new THREE.Matrix4().compose(curPos, curQuat, new THREE.Vector3(1, 1, 1));
      const newMat = new THREE.Matrix4().multiplyMatrices(M, curMat);
      const outPos = new THREE.Vector3();
      const outQuat = new THREE.Quaternion();
      const outScale = new THREE.Vector3();
      newMat.decompose(outPos, outQuat, outScale);
      const e = new THREE.Euler().setFromQuaternion(outQuat, 'XYZ');
      get().updateFeatureParams(feature.id, {
        ...p,
        x: outPos.x, y: outPos.y, z: outPos.z,
        rx: THREE.MathUtils.radToDeg(e.x),
        ry: THREE.MathUtils.radToDeg(e.y),
        rz: THREE.MathUtils.radToDeg(e.z),
      });
      set({
        statusMessage: `Aligned ${feature.name}`,
        alignPickStage: 'idle',
        alignSource: null,
        alignTarget: null,
      });
      return;
    }

    // Mesh-backed bodies — bake the world matrix into a cloned geometry.
    if (feature.mesh instanceof THREE.Mesh) {
      const srcMesh = feature.mesh;
      const geom = srcMesh.geometry.clone();
      geom.applyMatrix4(M);
      geom.computeVertexNormals();
      const newMesh = new THREE.Mesh(geom, srcMesh.material);
      newMesh.userData = { ...srcMesh.userData };
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const oldGeom = srcMesh.geometry;
      set((state) => ({
        features: recomputeBooleanDependents(
          state.features.map((f) => (f.id === feature.id ? { ...f, mesh: newMesh } : f)),
          [feature.id],
        ),
        statusMessage: `Aligned ${feature.name}`,
        alignPickStage: 'idle',
        alignSource: null,
        alignTarget: null,
      }));
      setTimeout(() => oldGeom.dispose(), 0);
      return;
    }

    get().setStatusMessage('Align: unsupported body type (no mesh)');
  },

  // 3D edge fillet — rounds picked edges of a mesh-backed OR primitive body.
  // Edge IDs (from filletEdgeIds) use the new format:
  //   `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`
  // The featureId prefix (before the `|`) lets us find the source feature
  // directly without relying on feature.mesh.uuid — which is absent for
  // primitive features (box/cyl/sphere/torus) whose mesh is created by
  // PrimitiveBodies at render time and never stored in feature.mesh.
  // For primitives we rebuild the geometry from params and apply the world
  // transform so edge coords (world-space from the picker) match.
  // After filleting a primitive, feature.mesh is set, causing PrimitiveBodies
  // to skip it (skip-if-mesh guard) and ExtrudedBodies to pick it up via the
  // stored-mesh rendering path.
  // Approximate rolling-ball: each shared edge is set back along both adjacent
  // faces and a smooth arc band is stitched between the setback lines.
  commitFillet: (radius, segments) => {
    const { filletEdgeIds, features } = get();
    if (!(radius > 0) || filletEdgeIds.length === 0) {
      get().setStatusMessage('Fillet: pick edges and set a radius > 0');
      return;
    }
    // Parse edge IDs using the shared utility (same logic as FilletPreview).
    const parsed = parseFilletEdgeIds(filletEdgeIds);
    if (!parsed) { get().setStatusMessage('Fillet: no valid edges parsed'); return; }
    const { featureId: targetFid, meshUuid: targetMeshUuid, edges } = parsed;
    // Find the source feature.
    const feature = targetFid
      ? features.find((f) => f.id === targetFid)
      : features.find((f) => f.mesh instanceof THREE.Mesh && (f.mesh as THREE.Object3D).uuid === targetMeshUuid);
    if (!feature) {
      get().setStatusMessage('Fillet: selected edges are not on a solid/surface body');
      return;
    }
    console.log('[commitFillet] feature:', feature.id, 'type:', feature.type,
      'hasMesh:', feature.mesh instanceof THREE.Mesh,
      'edges:', edges.length, 'radius:', radius,
      'inRegistry:', liveBodyMeshes.has(targetMeshUuid));
    // Obtain source geometry.
    //  1. Mesh-backed features (sweep, thin extrude, etc.): use stored mesh.
    //  2. Primitive features (box/cyl/sphere/torus): rebuild geometry from params.
    //  3. Extrude features (CSG pipeline): look up the live rendered mesh from
    //     the BodyMesh registry (liveBodyMeshes, keyed by THREE.js mesh UUID).
    //     The UUID is embedded in the edge ID by FilletEdgeHighlight/edgeId().
    const hasMesh = feature.mesh instanceof THREE.Mesh;
    let srcGeo: THREE.BufferGeometry;
    let srcMaterial: THREE.Material | THREE.Material[];
    let oldGeomToDispose: THREE.BufferGeometry | null = null;
    if (hasMesh) {
      const srcMesh = feature.mesh as THREE.Mesh;
      srcGeo = srcMesh.geometry.clone().toNonIndexed();
      srcMaterial = srcMesh.material;
      oldGeomToDispose = srcMesh.geometry;
    } else if (feature.type === 'primitive') {
      const p = feature.params;
      const kind = p.kind as string;
      let baseGeo: THREE.BufferGeometry | null = null;
      if (kind === 'box') {
        baseGeo = new THREE.BoxGeometry(Number(p.width) || 20, Number(p.height) || 20, Number(p.depth) || 20);
      } else if (kind === 'cylinder') {
        baseGeo = new THREE.CylinderGeometry(
          Number(p.radius) || 10, Number(p.radiusTop ?? p.radius) || 10, Number(p.height) || 20, 48,
        );
      } else if (kind === 'sphere') {
        baseGeo = new THREE.SphereGeometry(Number(p.radius) || 10, 48, 32);
      } else if (kind === 'torus') {
        baseGeo = new THREE.TorusGeometry(Number(p.radius) || 15, Number(p.tubeRadius) || 3, 24, 48);
      }
      if (!baseGeo) { get().setStatusMessage('Fillet: unsupported primitive type'); return; }
      // Apply world transform so edge coords (world-space) match vertices.
      const pos = new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(Number(p.rx) || 0),
        THREE.MathUtils.degToRad(Number(p.ry) || 0),
        THREE.MathUtils.degToRad(Number(p.rz) || 0),
      ));
      baseGeo.applyMatrix4(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)));
      srcGeo = baseGeo.toNonIndexed();
      baseGeo.dispose();
      // Placeholder — ExtrudedBodies overrides on next render via its material useEffect.
      srcMaterial = new THREE.MeshStandardMaterial({ color: 0x5b9bd5, roughness: 0.4, metalness: 0.1 });
    } else {
      // Extrude (CSG-pipeline) feature: geometry lives only in the R3F scene.
      // BodyMesh registers its THREE.Mesh in liveBodyMeshes by UUID on mount so
      // we can reach it here without re-running the expensive CSG pipeline.
      const liveMesh = liveBodyMeshes.get(targetMeshUuid);
      if (!liveMesh) {
        get().setStatusMessage('Fillet: body not yet rendered — select the edge and try again');
        return;
      }
      srcGeo = liveMesh.geometry.clone().toNonIndexed();
      srcMaterial = liveMesh.material;
    }
    // ── Rolling-ball fillet — shared utility (same code as FilletPreview) ──
    const newGeo = computeFilletGeometry(srcGeo, edges, radius, segments);
    srcGeo.dispose();
    if (!newGeo) {
      get().setStatusMessage('Fillet: no eligible edges (need an edge shared by two faces)');
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(newGeo, srcMaterial);
    newMesh.userData = hasMesh
      ? { ...(feature.mesh as THREE.Mesh).userData }
      : { pickable: true, featureId: feature.id };
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    if (hasMesh) {
      // Mesh-backed feature: replace mesh and propagate boolean dependents.
      set((state) => ({
        features: recomputeBooleanDependents(
          state.features.map((f) => (f.id === feature.id ? { ...f, mesh: newMesh } : f)),
          [feature.id],
        ),
        statusMessage: `Filleted ${edges.length} edge(s) at r=${radius}`,
      }));
      if (oldGeomToDispose) setTimeout(() => oldGeomToDispose!.dispose(), 0);
    } else {
      // Primitive OR extrude (from registry): store the filleted mesh so
      // PrimitiveBodies skips it (skip-if-mesh guard) and ExtrudedBodies
      // renders it via the stored-mesh path (the CSG pipeline also skips it
      // because of the `!f.mesh` filter in its feature list).
      set((state) => ({
        features: state.features.map((f) => (f.id === feature.id ? { ...f, mesh: newMesh } : f)),
        statusMessage: `Filleted ${edges.length} edge(s) at r=${radius}`,
      }));
    }
  },

  // SLD12 Ã¢â‚¬â€ commitCombine: boolean op on two feature meshes
  commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool) => {
    const { features } = get();
    const targetFeature = features.find((f) => f.id === targetFeatureId);
    const toolFeature = features.find((f) => f.id === toolFeatureId);
    if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: target has no mesh');
      return;
    }
    if (!toolFeature?.mesh || !(toolFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine: tool has no mesh');
      return;
    }
    const tgtMesh = targetFeature.mesh as THREE.Mesh;
    const toolMesh = toolFeature.mesh as THREE.Mesh;
    let resultGeom: THREE.BufferGeometry;
    // CSG can throw on degenerate / non-manifold inputs. Catch + report so
    // the user gets a status message instead of a silent broken state, and
    // the partially-built result (if any) doesn't end up in the scene.
    // pushUndo is called AFTER the try/catch so a failed CSG doesn't leave
    // an orphaned snapshot on the undo stack.
    try {
      resultGeom = runBoolean(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (${operation}) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const n = features.filter((f) => f.type === 'combine').length + 1;
    const combineFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Combine ${n} (${operation})`,
      type: 'combine',
      params: {
        operation,
        keepTools: keepTool,
        targetId: targetFeatureId,
        toolId: toolFeatureId,
        booleanParentIds: [targetFeatureId, toolFeatureId],
        recomputeOnParentChange: true,
      },
      mesh: newMesh,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: targetFeature.bodyKind,
    };
    set((state) => {
      const updated = state.features.map((f) =>
        !keepTool && (f.id === targetFeatureId || f.id === toolFeatureId)
          ? { ...f, suppressed: true }
          : f
      );
      const suppressionEntries: Record<string, boolean> = {
        [combineFeature.id]: false,
        [targetFeatureId]: !keepTool,
        [toolFeatureId]: !keepTool,
      };
      return {
        features: [...updated, combineFeature],
        designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
        statusMessage: `Combine (${operation}) created with editable parents`,
      };
    });
  },

  // SLD17 Ã¢â‚¬â€ commitMirrorFeature: mirror a feature's mesh across a plane
  commitMirrorFeature: (featureId, plane) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature?.mesh) {
      get().setStatusMessage('Mirror Feature: no mesh on selected feature');
      return;
    }
    const srcMesh = feature.mesh as THREE.Mesh;
    if (!(srcMesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Mirror Feature: feature is not a mesh');
      return;
    }
    get().pushUndo();
    const mirrored = GeometryEngine.mirrorMesh(srcMesh, plane);
    mirrored.castShadow = true;
    mirrored.receiveShadow = true;
    const n = features.filter((f) => f.name.startsWith('Mirror Feature')).length + 1;
    const newFeature: Feature = {
      id: crypto.randomUUID(),
      name: `Mirror Feature ${n}`,
      type: 'mirror',
      params: { featureKind: 'mirror-feature', sourceId: featureId, plane },
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      mesh: mirrored,
      bodyKind: feature.bodyKind,
    };
    set((state) => ({
      features: [...state.features, newFeature],
      statusMessage: `Feature mirrored on ${plane} plane`,
    }));
  },

  // SLD12-edit — re-run CSG on an existing combine feature with new params.
  // Atomically updates params + mesh in one pushUndo so the edit is a single
  // undo step (avoids double-snapshot from separate updateFeatureParams + CSG).
  recommitCombine: (featureId, params) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature || feature.type !== 'combine') {
      get().setStatusMessage('Combine (edit): feature not found');
      return;
    }
    const { operation, keepTools, targetId, toolId } = params;
    const targetFeature = features.find((f) => f.id === targetId);
    const toolFeature = features.find((f) => f.id === toolId);
    if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine (edit): target has no mesh');
      return;
    }
    if (!toolFeature?.mesh || !(toolFeature.mesh instanceof THREE.Mesh)) {
      get().setStatusMessage('Combine (edit): tool has no mesh');
      return;
    }
    const tgtMesh = targetFeature.mesh as THREE.Mesh;
    const toolMesh = toolFeature.mesh as THREE.Mesh;
    let resultGeom: THREE.BufferGeometry;
    try {
      resultGeom = runBoolean(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (edit) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    const oldMesh = feature.mesh;
    set((state) => {
      const oldParentIds = getBooleanParentIds(feature);
      const nextParentIds = [targetId, toolId];
      const affectedParentIds = Array.from(new Set([...oldParentIds, ...nextParentIds]));
      const features = state.features.map((f) => {
        if (f.id === featureId) {
          return { ...f, mesh: newMesh, params: { ...f.params, operation, keepTools, targetId, toolId, booleanParentIds: [targetId, toolId], recomputeOnParentChange: true } };
        }
        if (affectedParentIds.includes(f.id)) {
          const isNextParent = nextParentIds.includes(f.id);
          const shouldSuppress = isNextParent
            ? !keepTools
            : parentIsHiddenByAnotherCombine(state.features, f.id, featureId);
          return { ...f, suppressed: shouldSuppress };
        }
        return f;
      });
      const suppressionEntries: Record<string, boolean> = { [featureId]: false };
      for (const id of affectedParentIds) {
        suppressionEntries[id] = !!features.find((candidate) => candidate.id === id)?.suppressed;
      }
      return {
        features,
        designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
        statusMessage: `Combine (${operation}) updated`,
      };
    });
    if (oldMesh instanceof THREE.Mesh) {
      const geo = oldMesh.geometry;
      setTimeout(() => geo.dispose(), 0);
    }
  },

  toggleFeatureVisibility: (id) => set((state) => ({
    features: state.features.map((f) =>
      f.id === id ? { ...f, visible: !f.visible } : f
    ),
  })),
  toggleFeatureSuppressed: (id) => set((state) => {
    const features = state.features.map((f) =>
      f.id === id ? { ...f, suppressed: !f.suppressed } : f
    );
    const target = features.find((feature) => feature.id === id);
    return {
      features,
      designConfigurations: state.designConfigurations.map((configuration) =>
        configuration.id === state.activeDesignConfigurationId && target
          ? {
              ...configuration,
              featureSuppression: {
                ...configuration.featureSuppression,
                [id]: !!target.suppressed,
              },
              updatedAt: Date.now(),
            }
          : configuration,
      ),
    };
  }),
  };
}

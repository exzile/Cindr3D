import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { recomputeBooleanDependents, runBooleanAsync } from './featureBooleanUtils';
import { errorMessage } from '../../../../utils/errorHandling';
import { parseFilletEdgeIds, computeFilletGeometry, type FilletCommitParams } from '../../../../utils/geometry/filletGeometry';
import { parseChamferEdgeIds, computeChamferGeometry, resolveChamferDistances } from '../../../../utils/geometry/chamferGeometry';
import { applyEdgeCut, cacheEdgeCutSource, getCachedEdgeCutSource } from './applyEdgeCut';
import { liveBodyMeshes, bodyGeometryCache } from '../../../../store/meshRegistry';

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

  // 3D edge fillet — rounds picked edges of a mesh-backed, primitive, OR
  // extrude (CSG-pipeline) body. Edge IDs (filletEdgeIds) use the format
  //   `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`
  // Non-destructive path: pass featureId to store the result on the fillet
  // feature node instead of mutating the parent. Omit featureId for legacy
  // behaviour (backwards compat with callers that don't use the new UI flow).
  commitFillet: (radius, segments, featureId?, filletParams?) => {
    const fp = filletParams as FilletCommitParams | undefined;
    applyEdgeCut({ get, set }, {
      tool: 'Fillet',
      edgeIds: get().filletEdgeIds,
      sizeValid: radius > 0,
      parse: parseFilletEdgeIds,
      compute: (srcGeo, edges) => computeFilletGeometry(srcGeo, edges, radius, segments, false, fp),
      pastVerb: 'Filleted',
      sizeLabel: `r=${radius}`,
      featureId,
    });
  },

  // 3D edge chamfer — flat bevel on picked edges. Same machinery as
  // commitFillet (shared applyEdgeCut + edge-cut core); only the per-edge
  // cutter differs (triangular wedge vs prism−cylinder). distance is the
  // live/face-1 setback; distance2 is the face-2 setback the dialog resolves
  // from its mode (equal / two-distance / distance+angle).
  commitChamfer: (distance, distance2, featureId?, chamferParams?) => {
    applyEdgeCut({ get, set }, {
      tool: 'Chamfer',
      edgeIds: get().chamferEdgeIds,
      sizeValid: distance > 0,
      parse: parseChamferEdgeIds,
      compute: (srcGeo, edges) => computeChamferGeometry(srcGeo, edges, distance, distance2, false, chamferParams as Record<string, unknown> | undefined),
      pastVerb: 'Chamfered',
      sizeLabel: `d=${distance}`,
      featureId,
    });
  },

  // Replay an existing fillet/chamfer feature with updated params (used by edit).
  // Resolves source geometry from the session cache or parent feature mesh.
  replayEdgeCutFeature: (featureId: string) => {
    const { features } = get();
    const feature = features.find((f) => f.id === featureId);
    if (!feature || (feature.type !== 'fillet' && feature.type !== 'chamfer')) return;

    const params = feature.params;
    const edgeIdsStr = typeof params.edgeIds === 'string' ? params.edgeIds : '';
    const edgeIds = edgeIdsStr.split(',').filter(Boolean);
    if (edgeIds.length === 0) {
      get().setStatusMessage(`Edit ${feature.type}: no edge IDs stored`);
      return;
    }

    // Resolve source geometry: session cache > parent mesh > live body meshes
    let srcGeo: THREE.BufferGeometry | null = null;
    const cached = getCachedEdgeCutSource(featureId);
    if (cached) {
      srcGeo = cached.clone();
    } else {
      // Try parent feature's mesh
      const parentId = (params.parentFeatureId as string | undefined) ?? feature.parentFeatureId;
      const parent = parentId ? features.find((f) => f.id === parentId) : null;
      if (parent?.mesh instanceof THREE.Mesh) {
        const c = parent.mesh.geometry.clone();
        srcGeo = c.index ? c.toNonIndexed() : c;
        if (srcGeo !== c) c.dispose();
      } else if (parentId) {
        // Try bodyGeometryCache (populated by ExtrudedBodies for extrudes)
        const cached2 = bodyGeometryCache.get(parentId);
        if (cached2) {
          const c = cached2.clone();
          srcGeo = c.index ? c.toNonIndexed() : c;
          if (srcGeo !== c) c.dispose();
        }
      }
      // Fallback: try liveBodyMeshes by meshUuid embedded in edge ID
      if (!srcGeo && edgeIds.length > 0) {
        const rest = edgeIds[0].includes('|') ? edgeIds[0].split('|')[1] : edgeIds[0];
        const meshUuid = rest.split(':')[0];
        const liveMesh = liveBodyMeshes.get(meshUuid);
        if (liveMesh) {
          const c = liveMesh.geometry.clone();
          srcGeo = c.index ? c.toNonIndexed() : c;
          if (srcGeo !== c) c.dispose();
        }
      }
    }
    if (!srcGeo) {
      get().setStatusMessage(`Edit ${feature.type}: source geometry unavailable — re-apply the operation`);
      return;
    }

    // Build new geometry with updated params
    let newGeo: THREE.BufferGeometry | null = null;
    if (feature.type === 'fillet') {
      const radius = (params.radius as number) ?? 2;
      const fp: FilletCommitParams = {
        mode: (params.mode as FilletCommitParams['mode']) ?? 'constant',
        chordLength: params.chordLength as number | undefined,
        startRadius: params.startRadius as number | undefined,
        endRadius: params.endRadius as number | undefined,
        propagate: params.propagate as boolean | undefined,
      };
      const parsedEdges = parseFilletEdgeIds(edgeIds);
      if (parsedEdges) newGeo = computeFilletGeometry(srcGeo, parsedEdges.edges, radius, 0, false, fp);
    } else {
      const parsedEdges = parseChamferEdgeIds(edgeIds);
      const [d1, d2] = resolveChamferDistances({
        mode: (params.mode as string ?? 'equal-dist') as import('../../../../utils/geometry/chamferGeometry').ChamferMode,
        distance: (params.distance as number) ?? 2,
        distance2: params.distance2 as number | undefined,
        angle: params.angle as number | undefined,
        isFlipped: params.isFlipped as boolean | undefined,
      });
      if (parsedEdges) newGeo = computeChamferGeometry(srcGeo, parsedEdges.edges, d1, d2);
    }
    srcGeo.dispose();

    if (!newGeo) {
      get().setStatusMessage(`Edit ${feature.type}: geometry computation failed`);
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId ? { ...f, healthState: 'error' as const, healthMessage: 'CSG failed — try adjusting the radius or edges' } : f,
        ),
      }));
      return;
    }

    // Keep existing material if possible
    const existingMesh = feature.mesh instanceof THREE.Mesh ? (feature.mesh as THREE.Mesh) : null;
    const mat = existingMesh?.material ?? new THREE.MeshStandardMaterial({ color: 0x5b9bd5, roughness: 0.4, metalness: 0.1 });
    const newMesh = new THREE.Mesh(newGeo, mat);
    newMesh.userData._edgeCutApplied = true;
    newMesh.userData.pickable = true;
    newMesh.userData.featureId = featureId;
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;

    get().pushUndo();
    set((state) => ({
      features: state.features.map((f) =>
        f.id === featureId
          ? { ...f, mesh: newMesh, healthState: 'healthy' as const, healthMessage: undefined }
          : f,
      ),
      statusMessage: `Updated ${feature.type}`,
    }));
    // Update session source cache with the same source
    if (cached) cacheEdgeCutSource(featureId, cached.clone());
  },

  // SLD12 Ã¢â‚¬â€ commitCombine: boolean op on two feature meshes
  commitCombine: async (targetFeatureId, toolFeatureId, operation, keepTool) => {
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
    const bodyKind = targetFeature.bodyKind;
    // CSG can throw on degenerate / non-manifold inputs. Catch + report so
    // the user gets a status message instead of a silent broken state, and
    // the partially-built result (if any) doesn't end up in the scene.
    // pushUndo is called AFTER the try/catch so a failed CSG doesn't leave
    // an orphaned snapshot on the undo stack.
    let resultGeom: THREE.BufferGeometry | null;
    try {
      resultGeom = await runBooleanAsync(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (${operation}) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    if (!resultGeom) {
      get().setStatusMessage(`Combine (${operation}) failed: CSG returned no result`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    // Use fresh state snapshot after the await so the feature list is current.
    const state = get();
    const n = state.features.filter((f) => f.type === 'combine').length + 1;
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
      bodyKind,
    };
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
    set({
      features: [...updated, combineFeature],
      designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
      statusMessage: `Combine (${operation}) created with editable parents`,
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
  recommitCombine: async (featureId, params) => {
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
    const oldMesh = feature.mesh;
    let resultGeom: THREE.BufferGeometry | null;
    try {
      resultGeom = await runBooleanAsync(tgtMesh, toolMesh, operation);
    } catch (err) {
      get().setStatusMessage(`Combine (edit) failed: ${errorMessage(err, 'unknown CSG error')}`);
      return;
    }
    if (!resultGeom) {
      get().setStatusMessage(`Combine (edit) failed: CSG returned no result`);
      return;
    }
    get().pushUndo();
    const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    // Use fresh state snapshot after the await so the feature list is current.
    const state = get();
    const oldParentIds = getBooleanParentIds(feature);
    const nextParentIds = [targetId, toolId];
    const affectedParentIds = Array.from(new Set([...oldParentIds, ...nextParentIds]));
    const updatedFeatures = state.features.map((f) => {
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
      suppressionEntries[id] = !!updatedFeatures.find((candidate) => candidate.id === id)?.suppressed;
    }
    set({
      features: updatedFeatures,
      designConfigurations: syncActiveConfigurationSuppression(state, suppressionEntries),
      statusMessage: `Combine (${operation}) updated`,
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

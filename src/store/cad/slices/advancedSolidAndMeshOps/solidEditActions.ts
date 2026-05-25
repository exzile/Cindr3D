import * as THREE from 'three';
import type { Feature } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { errorMessage } from '../../../../utils/errorHandling';
import { applyBodyBooleanAsync, pickMostRecentSolidTarget } from '../featureManagement/bodyBoolean';
import { performOccBooleanWithInstance } from '../../../../engine/occ/ops/booleanCore';
import { liveBodyMeshes } from '../../../meshRegistry';
import { occShellWithInstance } from '../../../../engine/occ/ops/shell';
import { occDraftWithInstance } from '../../../../engine/occ/ops/draft';
import { occOffsetFacesWithInstance } from '../../../../engine/occ/ops/offsetFaces';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../engine/occ/loader';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { disposeMeshDeferred } from '../../../../engine/occ/picking';
import type { BRepBody, BRepTessellation } from '../../../../engine/occ/brepBody';
import { findOccFaceIdByCentroid, requireMesh } from './advancedOpsUtils';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

/** Boundary-fill target = shared most-recent-solid pick, skipping the tool
 *  bodies that define the boundary and any prior boundary-fill body. */
function pickBoundaryFillTarget(features: Feature[], excludeIds: Set<string>): Feature | undefined {
  return pickMostRecentSolidTarget(features, { excludeIds, excludeFeatureKind: 'boundary-fill' });
}

/**
 * Compute the boundary-fill solid geometry from the selected tool meshes.
 */
async function computeBoundaryFillGeometry(
  toolFeatures: Feature[],
): Promise<{ geometry: THREE.BufferGeometry; brepBodyId?: string; note: string }> {
  const meshes = toolFeatures
    .map((f) => f.mesh)
    .filter((m): m is THREE.Mesh => m instanceof THREE.Mesh);

  const baked = meshes.map((m) => GeometryEngine.bakeMeshWorldGeometry(m));
  const disposeBaked = () => baked.forEach((g) => g.dispose());

  const openSurfaceMeshes = toolFeatures
    .filter((f) => f.bodyKind === 'surface' && f.mesh instanceof THREE.Mesh)
    .map((f) => f.mesh as THREE.Mesh);

  const fallbackBox = (reason: string): { geometry: THREE.BufferGeometry; note: string } => {
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const geom = new THREE.BoxGeometry(
      Math.max(size.x, 1e-3),
      Math.max(size.y, 1e-3),
      Math.max(size.z, 1e-3),
    );
    geom.translate(center.x, center.y, center.z);
    disposeBaked();
    return { geometry: geom, note: ` (${reason} — bounding-box fill)` };
  };

  try {
    if (baked.length >= 2) {
      const occ = getOccSync();
      const bodyIds = toolFeatures.map(
        (f) => (f.mesh instanceof THREE.Mesh ? f.mesh.userData['brepBodyId'] as string | undefined : undefined),
      );
      if (occ && bodyIds.every(Boolean)) {
        const bodies = bodyIds.map((id) => globalBRepBodyRegistry.get(id!));
        if (bodies.every(Boolean)) {
          let acc = bodies[0]!;
          const intermediateBodies: BRepBody[] = [];
          for (let i = 1; i < bodies.length; i++) {
            const result = performOccBooleanWithInstance(occ.oc, 'intersect', acc, bodies[i]!);
            if (!result) {
              for (const body of intermediateBodies) body.dispose();
              disposeBaked();
              return fallbackBox('selected bodies do not enclose a common region');
            }
            if (intermediateBodies.includes(acc)) {
              acc.dispose();
              intermediateBodies.splice(intermediateBodies.indexOf(acc), 1);
            }
            intermediateBodies.push(result);
            acc = result;
          }
          try {
            const tess = tessellateWithInstance(occ.oc, acc);
            if (!tess || tess.positions.length === 0) {
              for (const body of intermediateBodies) body.dispose();
              disposeBaked();
              return fallbackBox('selected bodies do not enclose a common region');
            }
            const geometry = tessellationToGeometry(tess);
            globalBRepBodyRegistry.add(acc);
            disposeBaked();
            return { geometry, brepBodyId: acc.id, note: '' };
          } catch (err) {
            for (const body of intermediateBodies) body.dispose();
            disposeBaked();
            return fallbackBox('selected bodies do not enclose a common region');
          }
        }
      }
      disposeBaked();
      return fallbackBox('selected bodies require OCC representation for boundary fill');
    }

    if (openSurfaceMeshes.length > 0) {
      const stitched = GeometryEngine.stitchSurfaces(openSurfaceMeshes);
      if (stitched.isSolid) {
        disposeBaked();
        return { geometry: stitched.geometry, note: '' };
      }
      stitched.geometry.dispose();
      return fallbackBox('selected surface(s) could not be stitched closed');
    }

    if (baked.length === 1) {
      const singleBodyId = meshes[0]?.userData['brepBodyId'] as string | undefined;
      return { geometry: baked[0], brepBodyId: singleBodyId, note: '' };
    }

    return fallbackBox('no usable tool geometry');
  } catch (err) {
    return fallbackBox(`fill failed: ${errorMessage(err, 'OCC error')}`);
  }
}

export function createSolidEditActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  // ── SLD10 — Shell ────────────────────────────────────────────────────────
  commitShell: (featureId, opts) => {
    const { features } = get();
    const srcFeature = features.find((f) => f.id === featureId);
    if (!srcFeature) {
      get().setStatusMessage('Shell: feature not found');
      return;
    }
    let srcMesh = srcFeature.mesh as THREE.Mesh | undefined;
    if (!srcMesh?.isMesh) {
      for (const [, m] of liveBodyMeshes) {
        if (m.userData.featureId === featureId && m.isMesh) { srcMesh = m; break; }
      }
    }
    if (!srcMesh?.isMesh) {
      get().setStatusMessage('Shell: no mesh found for selected feature');
      return;
    }

    const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
    if (occBodyId) {
      const occ = getOccSync();
      const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
      if (occ && srcBody) {
        const tess = srcMesh.userData['brepTessellation'] as BRepTessellation | undefined;
        const tin = Number.isFinite(opts.insideThickness) ? Math.max(0, opts.insideThickness) : 0;
        const tout = Number.isFinite(opts.outsideThickness) ? Math.max(0, opts.outsideThickness) : 0;
        if (tin <= 0 && tout <= 0) {
          get().setStatusMessage('Shell: set a positive inside or outside thickness');
          return;
        }
        const occFaceIds: number[] = tess
          ? opts.removeFaces
              .map((d) => findOccFaceIdByCentroid(tess, d.centroid))
              .filter((id): id is number => id !== null)
          : [];
        if (occFaceIds.length === 0) {
          get().setStatusMessage('Shell (OCC): select at least one face to open');
          return;
        }
        const shellResult = occShellWithInstance(occ.oc, srcBody, occFaceIds, tin, {
          sourceFeatureId: featureId,
          outsideThickness: tout > 0 ? tout : undefined,
          shellType: opts.shellType === 'rounded' ? 'rolling-ball' : 'sharp',
        });
        if (!shellResult) {
          get().setStatusMessage('Shell (OCC): BRep operation failed — check face selection');
          return;
        }
        shellResult.sourceFeatureId = featureId;
        let shellMesh: THREE.Mesh;
        try {
          shellMesh = createRegisteredOccMesh(occ.oc, shellResult, srcMesh.material, featureId);
        } catch (err) {
          get().setStatusMessage(`Shell (OCC) failed: ${errorMessage(err, 'unknown error')}`);
          return;
        }
        get().pushUndo();
        set((state) => ({
          features: state.features.map((f) =>
            f.id === featureId
              ? { ...f, mesh: shellMesh, params: { ...f.params, insideThickness: tin, outsideThickness: tout, shellType: opts.shellType, removeFaceCount: opts.removeFaces.length, featureKind: 'shell' } }
              : f,
          ),
          statusMessage: `Shell (OCC) applied (in ${tin}mm / out ${tout}mm, ${occFaceIds.length} opening(s))`,
        }));
        disposeMeshDeferred(srcMesh);
        return;
      }
    }

    get().setStatusMessage('Shell requires an OCC body (create solid via Extrude or Revolve first)');
  },

  // ── SLD11 — Draft ────────────────────────────────────────────────────────
  commitDraft: (featureId, pullAxisDir, draftAngle, fixedPlaneY, options) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Draft', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    if (!Number.isFinite(draftAngle) || Math.abs(draftAngle) >= 90) {
      get().setStatusMessage('Draft: angle must be finite and within (-90°, 90°)');
      return;
    }
    const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
    const faceIds = options?.faceIds?.filter((faceId) => Number.isInteger(faceId)) ?? [];
    if (occBodyId && faceIds.length > 0) {
      const occ = getOccSync();
      const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
      if (!occ || !srcBody) {
        get().setStatusMessage('Draft: OCC source body is no longer available');
        return;
      }
      const pull = pullAxisDir.clone().normalize();
      const draftResult = occDraftWithInstance(
        occ.oc,
        srcBody,
        faceIds,
        pull,
        THREE.MathUtils.degToRad(draftAngle),
        {
          origin: options?.neutralPlaneOrigin
            ? options.neutralPlaneOrigin.clone()
            : pull.clone().multiplyScalar(fixedPlaneY),
          normal: options?.neutralPlaneNormal
            ? options.neutralPlaneNormal.clone().normalize()
            : pull.clone(),
        },
        { sourceFeatureId: featureId },
      );
      if (!draftResult) {
        get().setStatusMessage('Draft: OCC operation failed for the selected face set');
        return;
      }
      draftResult.sourceFeatureId = featureId;
      let result: THREE.Mesh;
      try {
        result = createRegisteredOccMesh(occ.oc, draftResult, srcMesh.material, featureId);
      } catch (err) {
        get().setStatusMessage(`Draft (OCC) failed: ${errorMessage(err, 'unknown error')}`);
        return;
      }
      get().pushUndo();
      const nextFeatures = features.map((f) =>
        f.id === featureId
          ? { ...f, mesh: result, params: { ...f.params, draftAngle, fixedPlaneY, draftFaceIds: faceIds, featureKind: 'draft' } }
          : f,
      );
      set({ features: nextFeatures });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Draft (${draftAngle}°) applied with OCC`);
      return;
    }
    get().pushUndo();
    const result = GeometryEngine.draftMesh(srcMesh, pullAxisDir, draftAngle, fixedPlaneY);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, draftAngle, fixedPlaneY, featureKind: 'draft' } }
        : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Draft (${draftAngle}°) applied`);
  },

  // ── SLD14 — Offset Face ──────────────────────────────────────────────────
  commitOffsetFace: (featureId, distance, options) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Offset Face', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    if (!Number.isFinite(distance)) {
      get().setStatusMessage('Offset Face: distance must be a finite number');
      return;
    }
    const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
    const faceIds = options?.faceIds?.filter((faceId) => Number.isInteger(faceId)) ?? [];
    if (occBodyId && faceIds.length > 0) {
      const occ = getOccSync();
      const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
      if (!occ || !srcBody) {
        get().setStatusMessage('Offset Face: OCC source body is no longer available');
        return;
      }
      const offsetResult = occOffsetFacesWithInstance(
        occ.oc,
        srcBody,
        faceIds,
        distance,
        { sourceFeatureId: featureId },
      );
      if (!offsetResult) {
        get().setStatusMessage('Offset Face: OCC operation failed for the selected face set');
        return;
      }
      offsetResult.sourceFeatureId = featureId;
      let result: THREE.Mesh;
      try {
        result = createRegisteredOccMesh(occ.oc, offsetResult, srcMesh.material, featureId);
      } catch (err) {
        get().setStatusMessage(`Offset Face (OCC) failed: ${errorMessage(err, 'unknown error')}`);
        return;
      }
      get().pushUndo();
      const nextFeatures = features.map((f) =>
        f.id === featureId
          ? { ...f, mesh: result, params: { ...f.params, offsetDistance: distance, offsetFaceIds: faceIds, featureKind: 'offset-face' } }
          : f,
      );
      set({ features: nextFeatures });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Offset Face (${distance > 0 ? '+' : ''}${distance}mm) applied with OCC`);
      return;
    }
    get().pushUndo();
    const offsetGeom = GeometryEngine.offsetSurface(srcMesh, distance);
    const mat = srcMesh.material as THREE.Material;
    const result = new THREE.Mesh(offsetGeom, mat);
    result.castShadow = true;
    result.receiveShadow = true;
    result.userData = { ...srcMesh.userData };
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, offsetDistance: distance, featureKind: 'offset-face' } }
        : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Offset Face (${distance > 0 ? '+' : ''}${distance}mm) applied`);
  },

  // ── SLD16 — Remove Face ──────────────────────────────────────────────────
  commitRemoveFace: (featureId, faceNormal, faceCentroid) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Remove Face', get().setStatusMessage);
    if (!r) return;
    const { srcMesh } = r;
    const result = GeometryEngine.removeFaceAndHeal(srcMesh, faceNormal, faceCentroid);
    result.castShadow = true;
    result.receiveShadow = true;
    const nextFeatures = features.map((f) =>
      f.id === featureId
        ? { ...f, mesh: result, params: { ...f.params, featureKind: 'remove-face' } }
        : f,
    );
    set({ features: nextFeatures });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage('Remove Face: face removed and healed');
  },

  // ── SLD6 — Boundary Fill ─────────────────────────────────────────────────
  commitBoundaryFill: async (toolFeatureIds, operation) => {
    const { features } = get();
    const idSet = new Set(toolFeatureIds);
    const toolFeatures = toolFeatureIds
      .map((id) => features.find((f) => f.id === id))
      .filter((f): f is Feature => !!f && f.mesh instanceof THREE.Mesh);
    if (toolFeatures.length === 0) {
      get().setStatusMessage('Boundary Fill: no valid tool bodies selected');
      return;
    }

    const { geometry: fillGeom, brepBodyId: fillBodyId, note: fillNote } = await computeBoundaryFillGeometry(toolFeatures);

    let resultGeom: THREE.BufferGeometry = fillGeom;
    let resultBrepBodyId: string | undefined = fillBodyId;
    let opNote = '';
    let consumedTargetId: string | undefined;
    if (operation === 'join' || operation === 'cut') {
      const target = pickBoundaryFillTarget(features, idSet);
      if (!target || !(target.mesh instanceof THREE.Mesh)) {
        opNote = ` (no solid body to ${operation} — standalone body)`;
      } else if (fillBodyId) {
        // Wrap fill geometry in a temporary mesh so applyBodyBooleanAsync can read brepBodyId.
        const tempFillMesh = new THREE.Mesh(fillGeom);
        tempFillMesh.userData['brepBodyId'] = fillBodyId;
        const boolMesh = await applyBodyBooleanAsync(target.mesh, tempFillMesh, operation);
        if (boolMesh) {
          fillGeom.dispose();
          resultGeom = boolMesh.geometry;
          resultBrepBodyId = boolMesh.userData['brepBodyId'] as string | undefined;
          consumedTargetId = target.id;
        } else {
          opNote = ` (${operation} failed — standalone body)`;
        }
      } else {
        opNote = ` (${operation} requires OCC bodies — standalone body)`;
      }
    }

    const fillMesh = new THREE.Mesh(resultGeom);
    fillMesh.castShadow = true;
    fillMesh.receiveShadow = true;
    const featureId = crypto.randomUUID();
    fillMesh.userData.pickable = true;
    fillMesh.userData.featureId = featureId;
    if (resultBrepBodyId) fillMesh.userData['brepBodyId'] = resultBrepBodyId;
    const n = features.filter((f) => f.params?.featureKind === 'boundary-fill').length + 1;
    const feature: Feature = {
      id: featureId,
      name: `Boundary Fill ${n}`,
      type: 'boundary-fill',
      params: {
        featureKind: 'boundary-fill',
        toolFeatureIds: toolFeatureIds.join(','),
        operation,
        isBoundaryFill: true,
        ...(consumedTargetId ? { targetFeatureId: consumedTargetId } : {}),
      },
      mesh: fillMesh,
      bodyKind: 'solid',
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
    };
    get().pushUndo();
    set((state) => {
      const updated = consumedTargetId
        ? state.features.map((f) =>
            f.id === consumedTargetId ? { ...f, suppressed: true, visible: false } : f,
          )
        : state.features;
      return {
        features: [...updated, feature],
        statusMessage: `Boundary Fill ${n} (${operation})${fillNote}${opNote}`,
      };
    });
  },

  // ── SLD13 — Split Body ───────────────────────────────────────────────────
  commitSplitBody: ({ bodyFeatureId, toolType, toolId }) => {
    get().pushUndo();
    const { features } = get();
    const srcFeature = features.find((f) => f.id === bodyFeatureId);

    let srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
    if (!srcMesh?.isMesh) {
      for (const [, m] of liveBodyMeshes) {
        if ((m as THREE.Mesh).userData?.featureId === bodyFeatureId) {
          srcMesh = m as THREE.Mesh;
          break;
        }
      }
    }
    if (!srcFeature || !srcMesh?.isMesh) {
      get().setStatusMessage('Split Body: mesh not found for selected feature');
      return;
    }

    if (toolType !== 'plane') {
      get().setStatusMessage('Split Body: sketch/face splitting tools require a face or surface pick — use Silhouette Split for plane cuts');
      return;
    }

    const normals: Record<string, THREE.Vector3> = {
      XY: new THREE.Vector3(0, 0, 1),
      XZ: new THREE.Vector3(0, 1, 0),
      YZ: new THREE.Vector3(1, 0, 0),
    };
    const planeNormal = normals[toolId.toUpperCase()];
    if (!planeNormal) {
      get().setStatusMessage(`Split Body: unknown plane "${toolId}" — use XY, XZ, or YZ`);
      return;
    }

    const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, 0, 'positive');
    const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, 0, 'negative');
    partA.castShadow = true; partA.receiveShadow = true;
    partB.castShadow = true; partB.receiveShadow = true;

    const n = features.filter((f) => f.params?.featureKind === 'split-body-plane').length + 1;
    const featureA: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}A`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'positive', toolId },
      mesh: partA,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };
    const featureB: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}B`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'negative', toolId },
      mesh: partB,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };

    const nextFeatures = features.map((f) =>
      f.id === bodyFeatureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, featureA, featureB] });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Split Body ${n}: split by ${toolId} plane into two parts`);
  },

  // ── SLD15 — Silhouette Split ─────────────────────────────────────────────
  commitSilhouetteSplit: (featureId, planeNormal, planeOffset) => {
    const { features } = get();
    const r = requireMesh(features, featureId, 'Split Body', get().setStatusMessage);
    if (!r) return;
    const { srcFeature, srcMesh } = r;
    const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'positive');
    const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'negative');
    partA.castShadow = true; partA.receiveShadow = true;
    partB.castShadow = true; partB.receiveShadow = true;
    const n = features.filter((f) => f.params?.featureKind === 'silhouette-split').length + 1;
    const featureA: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}A`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'positive' },
      mesh: partA,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };
    const featureB: Feature = {
      id: crypto.randomUUID(),
      name: `${srcFeature.name} Split ${n}B`,
      type: 'split-body' as Feature['type'],
      params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'negative' },
      mesh: partB,
      visible: true,
      suppressed: false,
      timestamp: Date.now(),
      bodyKind: srcFeature.bodyKind ?? 'solid',
    };
    const nextFeatures = features.map((f) =>
      f.id === featureId ? { ...f, visible: false } : f,
    );
    set({ features: [...nextFeatures, featureA, featureB] });
    disposeMeshDeferred(srcMesh);
    get().setStatusMessage(`Split Body ${n}: split into two parts`);
  },
  };
}

import * as THREE from 'three';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import type { BRepTessellation } from '../../../../../engine/occ/brepBody';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { getOccSync } from '../../../../../engine/occ/loader';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { occDraftWithInstance } from '../../../../../engine/occ/ops/draft';
import { occOffsetFacesWithInstance } from '../../../../../engine/occ/ops/offsetFaces';
import { occShellWithInstance } from '../../../../../engine/occ/ops/shell';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { errorMessage } from '../../../../../utils/errorHandling';
import { liveBodyMeshes } from '../../../../meshRegistry';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { findOccFaceIdByCentroid, requireMesh } from '../advancedOpsUtils';

export function createShellDraftOffsetActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
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
            get().setStatusMessage('Shell (OCC): BRep operation failed - check face selection');
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

    commitDraft: (featureId, pullAxisDir, draftAngle, fixedPlaneY, options) => {
      const { features } = get();
      const r = requireMesh(features, featureId, 'Draft', get().setStatusMessage);
      if (!r) return;
      const { srcMesh } = r;
      if (!Number.isFinite(draftAngle) || Math.abs(draftAngle) >= 90) {
        get().setStatusMessage('Draft: angle must be finite and within (-90deg, 90deg)');
        return;
      }
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      const faceIds = options?.faceIds?.filter((faceId) => Number.isInteger(faceId)) ?? [];
      if (!occBodyId) {
        get().setStatusMessage('Draft requires an OCC body');
        return;
      }
      if (faceIds.length === 0) {
        get().setStatusMessage('Draft: select one or more OCC faces');
        return;
      }
      {
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
        get().setStatusMessage(`Draft (${draftAngle}deg) applied with OCC`);
        return;
      }
    },

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
      if (!occBodyId) {
        get().setStatusMessage('Offset Face requires an OCC body');
        return;
      }
      if (faceIds.length === 0) {
        get().setStatusMessage('Offset Face: select one or more OCC faces');
        return;
      }
      {
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
    },

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
  };
}

import * as THREE from 'three';
import type { Feature } from '../../../../../types/cad';
import { GeometryEngine } from '../../../../../engine/GeometryEngine';
import { disposeMeshDeferred } from '../../../../../engine/occ/picking';
import { liveBodyMeshes } from '../../../../meshRegistry';
import type { CADSliceContext } from '../../../sliceContext';
import type { CADState } from '../../../state';
import { requireMesh } from '../advancedOpsUtils';
import { getOccSync } from '../../../../../engine/occ/loader';
import { createOccPlaneFrame } from '../../../../../engine/occ/plane';
import { occExtrudeRect } from '../../../../../engine/occ/ops/extrude';
import { performOccBooleanWithInstance } from '../../../../../engine/occ/ops/booleanCore';
import { occSplitBodyBySurface } from '../../../../../engine/occ/ops/splitBody';
import { occSilhouetteSplitWithInstance } from '../../../../../engine/occ/ops/silhouetteSplit';
import { globalBRepBodyRegistry } from '../../../../../engine/occ/globalRegistry';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../../utils/errorHandling';
import type { BRepBody } from '../../../../../engine/occ/brepBody';
import type { OcctRaw } from '../../../../../engine/occ/types';

/** Size of the halfspace cutting tool — large enough to cover any conceivable model. */
const HALF_SPACE_SIZE = 200000; // 200 m
const HALF_SPACE_DIST = 100000; // 100 m extrusion depth

/**
 * Split an OCC body into two halves by a plane (defined by normal + offset).
 * Returns [positiveHalf, negativeHalf] — either may be null if the boolean fails.
 * Caller is responsible for calling body.dispose() on any non-null results it doesn't use.
 */
function occPlaneSplitBodies(
  oc: OcctRaw,
  srcBody: BRepBody,
  planeNormal: THREE.Vector3,
  planeOffset: number,
  idA: string,
  idB: string,
): [BRepBody | null, BRepBody | null] {
  const n = planeNormal.clone().normalize();
  const origin = n.clone().multiplyScalar(planeOffset);

  // Build two halfspace boxes: one on each side of the cutting plane.
  const posFrame = createOccPlaneFrame(origin, n);
  const negNormal = n.clone().negate();
  const negFrame = createOccPlaneFrame(origin, negNormal);

  const posHalf = occExtrudeRect(oc, HALF_SPACE_SIZE, HALF_SPACE_SIZE, HALF_SPACE_DIST, posFrame);
  const negHalf = occExtrudeRect(oc, HALF_SPACE_SIZE, HALF_SPACE_SIZE, HALF_SPACE_DIST, negFrame);

  // partA = positive side = source minus the negative halfspace
  const partA = performOccBooleanWithInstance(oc, 'subtract', srcBody, negHalf, {
    id: idA, sourceFeatureId: idA,
  });
  negHalf.dispose();

  // partB = negative side = source minus the positive halfspace
  const partB = performOccBooleanWithInstance(oc, 'subtract', srcBody, posHalf, {
    id: idB, sourceFeatureId: idB,
  });
  posHalf.dispose();

  return [partA, partB];
}

export function createSplitBodyActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitSplitBody: ({
      bodyFeatureId,
      toolType,
      toolId,
      planeOffset = 0,
      isSplittingToolExtended = true,
      splitToolOccBodyId,
      splitToolOccFaceId,
    }) => {
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

      // ── OCC BRepAlgoAPI_Splitter path (toolType === 'face') ──────────────
      if (toolType === 'face') {
        if (!splitToolOccBodyId) {
          get().setStatusMessage('Split Body: pick a splitting body/face first (set splitToolOccBodyId)');
          return;
        }

        const occ = getOccSync();
        const srcBrepBodyId = srcMesh.userData.brepBodyId as string | undefined;
        const srcBody = srcBrepBodyId ? globalBRepBodyRegistry.get(srcBrepBodyId) : undefined;
        const toolBody = globalBRepBodyRegistry.get(splitToolOccBodyId);

        if (!occ || !srcBody || !toolBody) {
          get().setStatusMessage('Split Body: OCC bodies not available for Splitter');
          return;
        }

        let splitResults: ReturnType<typeof occSplitBodyBySurface>;
        try {
          splitResults = occSplitBodyBySurface(occ.oc, srcBody, toolBody, { isSplittingToolExtended });
        } catch (err) {
          console.warn('[commitSplitBody] occSplitBodyBySurface threw:', err);
          get().setStatusMessage(`Split Body: Splitter failed — ${errorMessage(err, 'unknown')}`);
          return;
        }

        if (splitResults.length === 0) {
          get().setStatusMessage('Split Body: BRepAlgoAPI_Splitter produced no pieces (tool may not intersect body)');
          return;
        }

        const n = features.filter((f) => f.params?.featureKind === 'split-body-surface').length + 1;

        const newFeatures: Feature[] = splitResults.map((piece, i) => {
          const pieceId = crypto.randomUUID();
          const pieceMesh = createRegisteredOccMesh(occ.oc, piece, BODY_MATERIAL, pieceId);
          pieceMesh.castShadow = true;
          pieceMesh.receiveShadow = true;
          return {
            id: pieceId,
            name: `${srcFeature.name} Split ${n}${String.fromCharCode(65 + i)}`,
            type: 'split-body' as Feature['type'],
            params: {
              featureKind: 'split-body-surface',
              sourceFeatureId: bodyFeatureId,
              splitToolOccBodyId,
              splitToolOccFaceId: splitToolOccFaceId ?? null,
              piece: i,
            },
            mesh: pieceMesh,
            bodyKind: srcFeature.bodyKind ?? 'solid',
            visible: true,
            suppressed: false,
            timestamp: Date.now(),
          } satisfies Feature;
        });

        get().pushUndo();
        set({
          features: [
            ...features.map((f) => (f.id === bodyFeatureId ? { ...f, visible: false } : f)),
            ...newFeatures,
          ],
        });
        get().setStatusMessage(`Split Body ${n}: ${splitResults.length} piece${splitResults.length === 1 ? '' : 's'} created (OCC Splitter)`);
        return;
      }

      if (toolType === 'sketch') {
        get().setStatusMessage('Split Body: sketch splitting tool is not yet supported — use Plane or Face/Body tool type');
        return;
      }

      const planeNormals: Record<string, THREE.Vector3> = {
        XY: new THREE.Vector3(0, 0, 1),
        XZ: new THREE.Vector3(0, 1, 0),
        YZ: new THREE.Vector3(1, 0, 0),
      };
      const planeNormal = planeNormals[toolId.toUpperCase()];
      if (!planeNormal) {
        get().setStatusMessage(`Split Body: unknown plane "${toolId}" - use XY, XZ, or YZ`);
        return;
      }

      const n = features.filter((f) => f.params?.featureKind === 'split-body-plane').length + 1;
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();

      // ── OCC-15.4: Try OCC halfspace-subtract split ─────────────────────
      const srcBrepBodyId = srcMesh.userData.brepBodyId as string | undefined;
      const occ = getOccSync();
      if (occ && srcBrepBodyId) {
        const srcBody = globalBRepBodyRegistry.get(srcBrepBodyId);
        if (srcBody) {
          try {
            const [partABody, partBBody] = occPlaneSplitBodies(occ.oc, srcBody, planeNormal, planeOffset, idA, idB);
            if (partABody && partBBody) {
              const meshA = createRegisteredOccMesh(occ.oc, partABody, BODY_MATERIAL, idA);
              const meshB = createRegisteredOccMesh(occ.oc, partBBody, BODY_MATERIAL, idB);
              meshA.castShadow = true; meshA.receiveShadow = true;
              meshB.castShadow = true; meshB.receiveShadow = true;
              const featureA: Feature = {
                id: idA, name: `${srcFeature.name} Split ${n}A`, type: 'split-body' as Feature['type'],
                params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'positive', toolId },
                mesh: meshA, bodyKind: srcFeature.bodyKind ?? 'solid', visible: true, suppressed: false, timestamp: Date.now(),
              };
              const featureB: Feature = {
                id: idB, name: `${srcFeature.name} Split ${n}B`, type: 'split-body' as Feature['type'],
                params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'negative', toolId },
                mesh: meshB, bodyKind: srcFeature.bodyKind ?? 'solid', visible: true, suppressed: false, timestamp: Date.now(),
              };
              get().pushUndo();
              set({ features: [...features.map((f) => f.id === bodyFeatureId ? { ...f, visible: false } : f), featureA, featureB] });
              get().setStatusMessage(`Split Body ${n}: split by ${toolId} plane (OCC) into two parts`);
              return;
            }
            // Clean up any partial result
            if (partABody) globalBRepBodyRegistry.delete(partABody.id);
            if (partBBody) globalBRepBodyRegistry.delete(partBBody.id);
          } catch (err) {
            console.warn(`[commitSplitBody] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
          }
        }
      }

      // ── THREE mesh fallback ────────────────────────────────────────────
      const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'positive');
      const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'negative');
      partA.castShadow = true; partA.receiveShadow = true;
      partB.castShadow = true; partB.receiveShadow = true;

      const featureA: Feature = {
        id: idA, name: `${srcFeature.name} Split ${n}A`, type: 'split-body' as Feature['type'],
        params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'positive', toolId },
        mesh: partA, visible: true, suppressed: false, timestamp: Date.now(), bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      const featureB: Feature = {
        id: idB, name: `${srcFeature.name} Split ${n}B`, type: 'split-body' as Feature['type'],
        params: { featureKind: 'split-body-plane', sourceFeatureId: bodyFeatureId, half: 'negative', toolId },
        mesh: partB, visible: true, suppressed: false, timestamp: Date.now(), bodyKind: srcFeature.bodyKind ?? 'solid',
      };

      get().pushUndo();
      set({ features: [...features.map((f) => f.id === bodyFeatureId ? { ...f, visible: false } : f), featureA, featureB] });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Split Body ${n}: split by ${toolId} plane into two parts`);
    },

    commitSilhouetteSplit: (featureId, planeNormal, planeOffset) => {
      const { features } = get();
      const r = requireMesh(features, featureId, 'Planar Split', get().setStatusMessage);
      if (!r) return;
      const { srcFeature, srcMesh } = r;
      const n = features.filter((f) => f.params?.featureKind === 'silhouette-split').length + 1;
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();

      // ── OCC-15.4: Try OCC halfspace-subtract split ─────────────────────
      const srcBrepBodyId = srcMesh.userData.brepBodyId as string | undefined;
      const occ = getOccSync();
      if (occ && srcBrepBodyId) {
        const srcBody = globalBRepBodyRegistry.get(srcBrepBodyId);
        if (srcBody) {
          try {
            const [partABody, partBBody] = occPlaneSplitBodies(occ.oc, srcBody, planeNormal, planeOffset, idA, idB);
            if (partABody && partBBody) {
              const meshA = createRegisteredOccMesh(occ.oc, partABody, BODY_MATERIAL, idA);
              const meshB = createRegisteredOccMesh(occ.oc, partBBody, BODY_MATERIAL, idB);
              meshA.castShadow = true; meshA.receiveShadow = true;
              meshB.castShadow = true; meshB.receiveShadow = true;
              const featureA: Feature = {
                id: idA, name: `${srcFeature.name} Split ${n}A`, type: 'split-body' as Feature['type'],
                params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'positive' },
                mesh: meshA, bodyKind: srcFeature.bodyKind ?? 'solid', visible: true, suppressed: false, timestamp: Date.now(),
              };
              const featureB: Feature = {
                id: idB, name: `${srcFeature.name} Split ${n}B`, type: 'split-body' as Feature['type'],
                params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'negative' },
                mesh: meshB, bodyKind: srcFeature.bodyKind ?? 'solid', visible: true, suppressed: false, timestamp: Date.now(),
              };
              get().pushUndo();
              set({ features: [...features.map((f) => f.id === featureId ? { ...f, visible: false } : f), featureA, featureB] });
              get().setStatusMessage(`Planar Split ${n}: split by plane (OCC) into two parts`);
              return;
            }
            if (partABody) globalBRepBodyRegistry.delete(partABody.id);
            if (partBBody) globalBRepBodyRegistry.delete(partBBody.id);
          } catch (err) {
            console.warn(`[commitSilhouetteSplit] OCC path failed (${errorMessage(err, 'unknown')}), falling back to mesh`);
          }
        }
      }

      // ── THREE mesh fallback ────────────────────────────────────────────
      const partA = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'positive');
      const partB = GeometryEngine.planeCutMesh(srcMesh, planeNormal, planeOffset, 'negative');
      partA.castShadow = true; partA.receiveShadow = true;
      partB.castShadow = true; partB.receiveShadow = true;
      const featureA: Feature = {
        id: idA, name: `${srcFeature.name} Split ${n}A`, type: 'split-body' as Feature['type'],
        params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'positive' },
        mesh: partA, visible: true, suppressed: false, timestamp: Date.now(), bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      const featureB: Feature = {
        id: idB, name: `${srcFeature.name} Split ${n}B`, type: 'split-body' as Feature['type'],
        params: { featureKind: 'silhouette-split', sourceFeatureId: featureId, half: 'negative' },
        mesh: partB, visible: true, suppressed: false, timestamp: Date.now(), bodyKind: srcFeature.bodyKind ?? 'solid',
      };
      get().pushUndo();
      set({ features: [...features.map((f) => f.id === featureId ? { ...f, visible: false } : f), featureA, featureB] });
      disposeMeshDeferred(srcMesh);
      get().setStatusMessage(`Planar Split ${n}: split into two parts`);
    },

    // OCC-21.4e — REAL silhouette split (view-dependent outline imprint).
    // Imprints the body's silhouette curves (cylindrical faces) as seen along
    // viewDir onto its faces via BRepFeat_SplitShape. FacesOnly: the solid is
    // unchanged, the cylindrical face is subdivided along the outline. Requires
    // an OCC body — falls back to a status message otherwise.
    commitSilhouetteImprint: (featureId, viewDir) => {
      const { features } = get();
      const r = requireMesh(features, featureId, 'Silhouette Split', get().setStatusMessage);
      if (!r) return;
      const { srcFeature, srcMesh } = r;

      const brepBodyId = srcMesh.userData.brepBodyId as string | undefined;
      const occ = brepBodyId ? getOccSync() : null;
      const srcBody = occ && brepBodyId ? globalBRepBodyRegistry.get(brepBodyId) : null;
      if (!occ || !srcBody) {
        get().setStatusMessage('Silhouette Split: requires an OCC solid (cylindrical faces) — create one first');
        return;
      }

      let result: BRepBody | null = null;
      try {
        result = occSilhouetteSplitWithInstance(
          occ.oc,
          srcBody,
          [viewDir.x, viewDir.y, viewDir.z],
          { sourceFeatureId: featureId, operation: 'faces-only' },
        );
      } catch (err) {
        get().setStatusMessage(`Silhouette Split failed: ${errorMessage(err, 'unknown')}`);
        return;
      }

      if (!result) {
        get().setStatusMessage('Silhouette Split: no cylindrical silhouette for this view direction');
        return;
      }

      let newMesh;
      try {
        newMesh = createRegisteredOccMesh(occ.oc, result, srcMesh.material, featureId);
      } catch (err) {
        get().setStatusMessage(`Silhouette Split failed: ${errorMessage(err, 'unknown')}`);
        return;
      }
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;

      get().pushUndo();
      set((state) => ({
        features: state.features.map((f) =>
          f.id === featureId
            ? { ...f, mesh: newMesh, params: { ...f.params, featureKind: 'silhouette-imprint' } }
            : f,
        ),
        statusMessage: `Silhouette Split: outline imprinted on ${srcFeature.name}`,
      }));
      if (srcMesh.isMesh) disposeMeshDeferred(srcMesh);
    },
  };
}

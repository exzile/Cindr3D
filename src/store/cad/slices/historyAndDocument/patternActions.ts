import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { occRectangularPatternWithInstance, occCircularPatternWithInstance } from "../../../../engine/occ/ops/pattern";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import { getOccSync } from "../../../../engine/occ/loader";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { errorMessage } from "../../../../utils/errorHandling";

export function createPatternActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    // ── SLD7 — Linear Pattern ─────────────────────────────────────────────────
    commitLinearPattern: (featureId, params) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Linear Pattern: no mesh found for selected feature",
        );
        return;
      }

      // OCC path: fuse all copies into a single BRep body
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const dirX = new THREE.Vector3(params.dirX, params.dirY, params.dirZ);
          const countX = Math.max(1, Math.round(params.count));
          const spacingX = params.spacing;
          const countY = params.count2 ? Math.max(1, Math.round(params.count2)) : 1;
          const spacingY = params.spacing2 ?? 0;
          const dirY = params.dir2X !== undefined
            ? new THREE.Vector3(params.dir2X, params.dir2Y ?? 0, params.dir2Z ?? 0)
            : new THREE.Vector3(0, dirX.y !== 0 ? 0 : 1, dirX.y !== 0 ? 1 : 0);
          const newFeatureId = crypto.randomUUID();
          const occResult = occRectangularPatternWithInstance(occ.oc, srcBody, countX, spacingX, countY, spacingY, dirX, dirY, { sourceFeatureId: newFeatureId });
          if (occResult) {
            let patMesh: THREE.Mesh;
            try {
              occResult.sourceFeatureId = newFeatureId;
              patMesh = createRegisteredOccMesh(occ.oc, occResult, srcMesh.material, newFeatureId);
            } catch (err) {
              get().setStatusMessage(`OCC Linear Pattern failed: ${errorMessage(err)}`);
              return;
            }
            const nPat = features.filter((f) => f.params?.featureKind === 'rect-pattern').length + 1;
            const patFeature: Feature = {
              id: newFeatureId,
              name: `Pattern ${nPat}`,
              type: 'primitive',
              params: { featureKind: 'rect-pattern', sourceFeatureId: featureId, countX, spacingX, countY, spacingY },
              mesh: patMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              bodyKind: srcFeature.bodyKind ?? 'solid',
            };
            get().pushUndo();
            set({ features: [...features, patFeature], statusMessage: `OCC Linear Pattern: ${countX * countY} copies (merged)` });
            return;
          }
        }
      }

      get().pushUndo();
      const copies = GeometryEngine.linearPattern(srcMesh, params);
      const newFeatures: Feature[] = copies.map((copy, idx) => ({
        id: crypto.randomUUID(),
        name: `${srcFeature.name} (Pattern ${idx + 2})`,
        type: "primitive" as Feature["type"],
        params: {
          featureKind: "linear-pattern-copy",
          sourceFeatureId: featureId,
          index: idx + 2,
        },
        mesh: copy,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? "solid",
      }));
      set({ features: [...features, ...newFeatures] });
      get().setStatusMessage(`Linear Pattern: created ${copies.length} copies`);
    },

    // ── SLD8 — Circular Pattern ───────────────────────────────────────────────
    commitCircularPattern: (featureId, params) => {
      const { features } = get();
      const srcFeature = features.find((f) => f.id === featureId);
      const srcMesh = srcFeature?.mesh as THREE.Mesh | undefined;
      if (!srcFeature || !srcMesh?.isMesh) {
        get().setStatusMessage(
          "Circular Pattern: no mesh found for selected feature",
        );
        return;
      }

      // OCC path: fuse all rotation copies into a single BRep body
      const occBodyId = srcMesh.userData['brepBodyId'] as string | undefined;
      if (occBodyId) {
        const occ = getOccSync();
        const srcBody = occ ? globalBRepBodyRegistry.get(occBodyId) : undefined;
        if (occ && srcBody) {
          const axis = {
            origin: new THREE.Vector3(params.originX, params.originY, params.originZ),
            direction: new THREE.Vector3(params.axisX, params.axisY, params.axisZ),
          };
          const count = Math.max(1, Math.round(params.count));
          const totalAngleRad = THREE.MathUtils.degToRad(params.totalAngle);
          const newFeatureId = crypto.randomUUID();
          const occResult = occCircularPatternWithInstance(occ.oc, srcBody, axis, count, totalAngleRad, { sourceFeatureId: newFeatureId });
          if (occResult) {
            let patMesh: THREE.Mesh;
            try {
              occResult.sourceFeatureId = newFeatureId;
              patMesh = createRegisteredOccMesh(occ.oc, occResult, srcMesh.material, newFeatureId);
            } catch (err) {
              get().setStatusMessage(`OCC Circular Pattern failed: ${errorMessage(err)}`);
              return;
            }
            const nPat = features.filter((f) => f.params?.featureKind === 'circ-pattern').length + 1;
            const patFeature: Feature = {
              id: newFeatureId,
              name: `Circular Pattern ${nPat}`,
              type: 'primitive',
              params: { featureKind: 'circ-pattern', sourceFeatureId: featureId, count, totalAngle: params.totalAngle },
              mesh: patMesh,
              visible: true,
              suppressed: false,
              timestamp: Date.now(),
              bodyKind: srcFeature.bodyKind ?? 'solid',
            };
            get().pushUndo();
            set({ features: [...features, patFeature], statusMessage: `OCC Circular Pattern: ${count} copies (merged)` });
            return;
          }
        }
      }

      get().pushUndo();
      const copies = GeometryEngine.circularPattern(srcMesh, params);
      const newFeatures: Feature[] = copies.map((copy, idx) => ({
        id: crypto.randomUUID(),
        name: `${srcFeature.name} (Pattern ${idx + 2})`,
        type: "primitive" as Feature["type"],
        params: {
          featureKind: "circular-pattern-copy",
          sourceFeatureId: featureId,
          index: idx + 2,
        },
        mesh: copy,
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        bodyKind: srcFeature.bodyKind ?? "solid",
      }));
      set({ features: [...features, ...newFeatures] });
      get().setStatusMessage(
        `Circular Pattern: created ${copies.length} copies`,
      );
    },
  };
}

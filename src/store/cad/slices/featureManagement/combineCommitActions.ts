import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { getOccSync } from "../../../../engine/occ/loader";
import { performOccBooleanMultiWithInstance } from "../../../../engine/occ/ops/booleanCore";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { disposeMeshesDeferred } from "../../../../engine/occ/picking";
import { syncConfigurationSuppression } from "./bodyBoolean";

export function createCombineCommitActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool, isNewComponent = false) => {
      const { features } = get();
      const toolFeatureIds = Array.isArray(toolFeatureId) ? toolFeatureId : [toolFeatureId];
      const targetFeature = features.find((f) => f.id === targetFeatureId);
      const toolFeatures = toolFeatureIds
        .map((id) => features.find((f) => f.id === id))
        .filter((f): f is Feature => !!f);
      if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Combine: target has no mesh");
        return;
      }
      if (toolFeatures.length === 0 || toolFeatures.some((f) => !(f.mesh instanceof THREE.Mesh))) {
        get().setStatusMessage("Combine: tool has no mesh");
        return;
      }
      const tgtMesh = targetFeature.mesh as THREE.Mesh;
      const toolMeshes = toolFeatures.map((feature) => feature.mesh as THREE.Mesh);
      const featureId = crypto.randomUUID();
      const occ = getOccSync();
      const targetOccBodyId = tgtMesh.userData['brepBodyId'] as string | undefined;
      const targetOccBody = occ && targetOccBodyId ? globalBRepBodyRegistry.get(targetOccBodyId) : undefined;
      const toolOccBodies = occ
        ? toolMeshes
            .map((mesh) => globalBRepBodyRegistry.get(mesh.userData['brepBodyId'] as string))
            .filter((body): body is BRepBody => !!body)
        : [];
      if (occ && targetOccBody && toolOccBodies.length === toolMeshes.length) {
        const occOp = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
        const occResult = performOccBooleanMultiWithInstance(
          occ.oc,
          occOp,
          targetOccBody,
          toolOccBodies,
          { sourceFeatureId: featureId },
        );
        if (!occResult) {
          get().setStatusMessage(`Combine (${operation}) failed: OCC boolean failed`);
          return;
        }
        let occMesh: THREE.Mesh;
        try {
          occResult.sourceFeatureId = featureId;
          occMesh = createRegisteredOccMesh(occ.oc, occResult, tgtMesh.material, featureId);
        } catch (err) {
          get().setStatusMessage(`Combine (${operation}) failed: ${errorMessage(err, "unknown error")}`);
          return;
        }
        get().pushUndo();
        const n = features.filter((f) => f.type === "combine").length + 1;
        const combineFeature: Feature = {
          id: featureId,
          name: `Combine ${n} (${operation})`,
          type: "combine",
          params: {
            operation,
            keepTools: keepTool,
            isNewComponent,
            targetId: targetFeatureId,
            toolId: toolFeatureIds[0],
            toolIds: toolFeatureIds,
            booleanParentIds: [targetFeatureId, ...toolFeatureIds],
            recomputeOnParentChange: true,
          },
          mesh: occMesh,
          visible: true,
          suppressed: false,
          timestamp: Date.now(),
          bodyKind: targetFeature.bodyKind,
        };
        set((state) => {
          const parentIds = [targetFeatureId, ...toolFeatureIds];
          // isNewComponent: keep all input bodies visible; result is a new body
          // alongside the originals (mirrors Fusion CombineFeatureInput.isNewComponent).
          const suppressParents = !keepTool && !isNewComponent;
          const updated = state.features.map((f) =>
            suppressParents && parentIds.includes(f.id)
              ? { ...f, suppressed: true }
              : f,
          );
          const suppressionEntries: Record<string, boolean> = {
            [combineFeature.id]: false,
            ...Object.fromEntries(parentIds.map((id) => [id, suppressParents])),
          };
          return {
            features: [...updated, combineFeature],
            designConfigurations: syncConfigurationSuppression(
              state,
              suppressionEntries,
            ),
            statusMessage: `Combine (${operation}) created with ${toolFeatureIds.length} tool bodies (OCC)${isNewComponent ? ' [new component]' : ''}`,
          };
        });
        if (!keepTool && !isNewComponent) {
          disposeMeshesDeferred([tgtMesh, ...toolMeshes]);
        }
        return;
      }
      get().setStatusMessage(`Combine (${operation}) requires OCC-backed target and tool bodies`);
    },
  };
}

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
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { syncConfigurationSuppression } from "./bodyBoolean";
import { getBooleanParentIds, parentIsHiddenByAnotherCombine } from "./booleanCombineHelpers";

export function createCombineRecommitActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    recommitCombine: (featureId, params) => {
      const { features } = get();
      const feature = features.find((f) => f.id === featureId);
      if (!feature || feature.type !== "combine") {
        get().setStatusMessage("Combine (edit): feature not found");
        return;
      }
      const { operation, keepTools, targetId, toolId } = params;
      const toolIds = params.toolIds?.length ? params.toolIds : [toolId];
      const targetFeature = features.find((f) => f.id === targetId);
      const toolFeatures = toolIds
        .map((id) => features.find((f) => f.id === id))
        .filter((f): f is Feature => !!f);
      if (!targetFeature?.mesh || !(targetFeature.mesh instanceof THREE.Mesh)) {
        get().setStatusMessage("Combine (edit): target has no mesh");
        return;
      }
      if (toolFeatures.length === 0 || toolFeatures.some((toolFeature) => !(toolFeature.mesh instanceof THREE.Mesh))) {
        get().setStatusMessage("Combine (edit): tool has no mesh");
        return;
      }
      const tgtMesh = targetFeature.mesh as THREE.Mesh;
      const toolMeshes = toolFeatures.map((toolFeature) => toolFeature.mesh as THREE.Mesh);
      const occ = getOccSync();
      const targetOccBodyId = tgtMesh.userData['brepBodyId'] as string | undefined;
      const targetOccBody = occ && targetOccBodyId ? globalBRepBodyRegistry.get(targetOccBodyId) : undefined;
      const toolOccBodies = occ
        ? toolMeshes
            .map((mesh) => globalBRepBodyRegistry.get(mesh.userData['brepBodyId'] as string))
            .filter((body): body is BRepBody => !!body)
        : [];
      if (!occ || !targetOccBody || toolOccBodies.length !== toolMeshes.length) {
        get().setStatusMessage(`Combine (edit ${operation}) requires OCC-backed target and tool bodies`);
        return;
      }
      const occOp = operation === 'join' ? 'union' : operation === 'cut' ? 'subtract' : 'intersect';
      const occResult = performOccBooleanMultiWithInstance(
        occ.oc,
        occOp,
        targetOccBody,
        toolOccBodies,
        { id: featureId, sourceFeatureId: featureId },
      );
      if (!occResult) {
        get().setStatusMessage(`Combine (edit ${operation}) failed: OCC boolean failed`);
        return;
      }
      let newMesh: THREE.Mesh;
      try {
        newMesh = createRegisteredOccMesh(occ.oc, occResult, tgtMesh.material, featureId);
      } catch (err) {
        get().setStatusMessage(`Combine (edit ${operation}) failed: ${errorMessage(err, "unknown error")}`);
        return;
      }
      get().pushUndo();
      const oldMesh = feature.mesh;
      set((state) => {
        const oldParentIds = getBooleanParentIds(feature);
        const nextParentIds = [targetId, ...toolIds];
        const affectedParentIds = Array.from(
          new Set([...oldParentIds, ...nextParentIds]),
        );
        const features = state.features.map((f) => {
          if (f.id === featureId) {
            return {
              ...f,
              mesh: newMesh,
              params: {
                ...f.params,
                operation,
                keepTools,
                targetId,
                toolId: toolIds[0],
                toolIds,
                booleanParentIds: [targetId, ...toolIds],
                recomputeOnParentChange: true,
              },
            };
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
        const suppressionEntries: Record<string, boolean> = {
          [featureId]: false,
        };
        for (const id of affectedParentIds) {
          suppressionEntries[id] = !!features.find(
            (candidate) => candidate.id === id,
          )?.suppressed;
        }
        return {
          features,
          designConfigurations: syncConfigurationSuppression(
            state,
            suppressionEntries,
          ),
          statusMessage: `Combine (${operation}) updated`,
        };
      });
      if (oldMesh instanceof THREE.Mesh) disposeMeshDeferred(oldMesh as THREE.Mesh);
    },
  };
}

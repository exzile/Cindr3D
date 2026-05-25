import * as THREE from "three";
import type { Feature } from "../../../../types/cad";
import { GeometryEngine } from "../../../../engine/GeometryEngine";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { recomputeBooleanDependents, runBoolean } from "./featureBooleanUtils";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { getOccSync } from "../../../../engine/occ/loader";
import { performOccBooleanMultiWithInstance } from "../../../../engine/occ/ops/booleanCore";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { disposeMeshDeferred, disposeMeshesDeferred } from "../../../../engine/occ/picking";
import { syncConfigurationSuppression } from "./bodyBoolean";

function getBooleanParentIds(feature: Feature): string[] {
  const fromArray = feature.params.booleanParentIds;
  if (Array.isArray(fromArray))
    return fromArray.filter((id): id is string => typeof id === "string");
  return [feature.params.targetId, feature.params.toolId].filter(
    (id): id is string => typeof id === "string",
  );
}

function keepsParentsHidden(feature: Feature): boolean {
  return feature.type === "combine" && feature.params.keepTools === false;
}

function parentIsHiddenByAnotherCombine(
  features: Feature[],
  parentId: string,
  excludeCombineId: string,
): boolean {
  return features.some(
    (feature) =>
      feature.id !== excludeCombineId &&
      keepsParentsHidden(feature) &&
      getBooleanParentIds(feature).includes(parentId),
  );
}

export function createBooleanCombineActions({
  set,
  get,
}: CADSliceContext): Partial<CADState> {
  return {
    // MSH7 — commitMeshCombine: merge all listed feature meshes into one
    commitMeshCombine: (featureIds) => {
      const { features } = get();
      const meshes: THREE.Mesh[] = [];
      for (const fid of featureIds) {
        const f = features.find((x) => x.id === fid);
        if (f?.mesh instanceof THREE.Mesh) meshes.push(f.mesh as THREE.Mesh);
      }
      if (meshes.length < 2) {
        get().setStatusMessage("Mesh Combine: need at least 2 mesh features");
        return;
      }
      const combined = GeometryEngine.combineMeshes(meshes);
      combined.castShadow = true;
      combined.receiveShadow = true;
      const n =
        features.filter((f) => f.name.startsWith("Mesh Combine")).length + 1;
      const newFeature: Feature = {
        id: crypto.randomUUID(),
        name: `Mesh Combine ${n}`,
        type: "import",
        params: {
          featureKind: "mesh-combine",
          sourceIds: featureIds.join(","),
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        mesh: combined,
        bodyKind: "mesh",
      };
      set((state) => ({
        features: [...state.features, newFeature],
        statusMessage: "Meshes combined",
      }));
    },

    // SLD12 — commitCombine: boolean op on two feature meshes
    commitCombine: (targetFeatureId, toolFeatureId, operation, keepTool) => {
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
          const updated = state.features.map((f) =>
            !keepTool && parentIds.includes(f.id)
              ? { ...f, suppressed: true }
              : f,
          );
          const suppressionEntries: Record<string, boolean> = {
            [combineFeature.id]: false,
            ...Object.fromEntries(parentIds.map((id) => [id, !keepTool])),
          };
          return {
            features: [...updated, combineFeature],
            designConfigurations: syncConfigurationSuppression(
              state,
              suppressionEntries,
            ),
            statusMessage: `Combine (${operation}) created with ${toolFeatureIds.length} tool bodies (OCC)`,
          };
        });
        // Dispose suppressed parent geometries after state is committed.
        // Defer to next tick so any in-flight renders still referencing the
        // old geometry can finish before the WebGL buffers are released.
        if (!keepTool) {
          disposeMeshesDeferred([tgtMesh, ...toolMeshes]);
        }
        return;
      }
      let resultGeom: THREE.BufferGeometry;
      // CSG can throw on degenerate / non-manifold inputs. Catch + report so
      // the user gets a status message instead of a silent broken state, and
      // the partially-built result (if any) doesn't end up in the scene.
      // pushUndo is called AFTER the try/catch so a failed CSG doesn't leave
      // an orphaned snapshot on the undo stack.
      try {
        resultGeom = toolMeshes.reduce(
          (acc, toolMesh) =>
            runBoolean(new THREE.Mesh(acc, tgtMesh.material), toolMesh, operation),
          tgtMesh.geometry as THREE.BufferGeometry,
        );
      } catch (err) {
        get().setStatusMessage(
          `Combine (${operation}) failed: ${errorMessage(err, "unknown CSG error")}`,
        );
        return;
      }
      get().pushUndo();
      const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
      const n = features.filter((f) => f.type === "combine").length + 1;
      const combineFeature: Feature = {
        id: featureId,
        name: `Combine ${n} (${operation})`,
        type: "combine",
        params: {
          operation,
          keepTools: keepTool,
          targetId: targetFeatureId,
          toolId: toolFeatureIds[0],
          toolIds: toolFeatureIds,
          booleanParentIds: [targetFeatureId, ...toolFeatureIds],
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
          !keepTool && (f.id === targetFeatureId || toolFeatureIds.includes(f.id))
            ? { ...f, suppressed: true }
            : f,
        );
        const suppressionEntries: Record<string, boolean> = {
          [combineFeature.id]: false,
          [targetFeatureId]: !keepTool,
          ...Object.fromEntries(toolFeatureIds.map((id) => [id, !keepTool])),
        };
        return {
          features: [...updated, combineFeature],
          designConfigurations: syncConfigurationSuppression(
            state,
            suppressionEntries,
          ),
          statusMessage: `Combine (${operation}) created with editable parents`,
        };
      });
      // Free GPU buffers for suppressed source meshes. THREE.js dispose() only
      // triggers the renderer to release WebGL buffers — the CPU-side Float32Arrays
      // remain, so recomputeBooleanDependents can still read geometry for CSG.
      if (!keepTool) {
        setTimeout(() => {
          tgtMesh.geometry.dispose();
          toolMeshes.forEach((toolMesh) => toolMesh.geometry.dispose());
        }, 0);
      }
    },

    // SLD12-edit — re-run CSG on an existing combine feature with new params.
    // Atomically updates params + mesh in one pushUndo so the edit is a single
    // undo step (avoids double-snapshot from separate updateFeatureParams + CSG).
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
      let resultGeom: THREE.BufferGeometry;
      try {
        resultGeom = toolMeshes.reduce(
          (acc, toolMesh) =>
            runBoolean(new THREE.Mesh(acc, tgtMesh.material), toolMesh, operation),
          tgtMesh.geometry as THREE.BufferGeometry,
        );
      } catch (err) {
        get().setStatusMessage(
          `Combine (edit) failed: ${errorMessage(err, "unknown CSG error")}`,
        );
        return;
      }
      get().pushUndo();
      const newMesh = new THREE.Mesh(resultGeom, tgtMesh.material);
      newMesh.castShadow = true;
      newMesh.receiveShadow = true;
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

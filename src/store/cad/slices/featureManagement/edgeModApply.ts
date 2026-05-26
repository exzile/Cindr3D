import * as THREE from "three";
import type { CADSliceContext } from "../../sliceContext";
import type { CADState } from "../../state";
import { errorMessage } from "../../../../utils/errorHandling";
import { globalBRepBodyRegistry } from "../../../../engine/occ/globalRegistry";
import {
  occFilletEdgeSetsWithInstance,
  occFullRoundFilletWithInstance,
  type FullRoundSideFaces,
  type OccFilletEdgeSet,
} from "../../../../engine/occ/ops/fillet";
import type { BRepBody } from "../../../../engine/occ/brepBody";
import { occChamferWithInstance } from "../../../../engine/occ/ops/chamfer";
import { getOccSync } from "../../../../engine/occ/loader";
import { createRegisteredOccMesh } from "../../../../engine/occ/registeredMesh";
import { parseOccEdgeSelection } from "../../../../utils/occEdgeUtils";
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";
import { DEFAULT_FILLET_RADIUS, propagateTangentEdges } from "./edgeModHelpers";

export function createOccEdgeModificationHelpers({ set, get }: CADSliceContext) {
  const markOccEdgeModificationError = (featureId: string | undefined, tool: string, message: string): false => {
    const statusMessage = `${tool}: ${message}`;
    if (!featureId) {
      set({ statusMessage });
      return false;
    }
    set((state) => ({
      features: state.features.map((feature) =>
        feature.id === featureId
          ? {
              ...feature,
              healthState: "error" as const,
              healthMessage: message,
            }
          : feature,
      ),
      statusMessage,
    }));
    return false;
  };

  const bodyForFeature = (feature: CADState['features'][number] | undefined): BRepBody | undefined => {
    if (!feature) return undefined;
    const meshBodyId =
      feature.mesh instanceof THREE.Mesh
        ? (feature.mesh.userData['brepBodyId'] as string | undefined)
        : undefined;
    if (meshBodyId) {
      const body = globalBRepBodyRegistry.get(meshBodyId);
      if (body) return body;
    }
    return globalBRepBodyRegistry.getByFeature(feature.id)[0];
  };

  const resolveLiveSourceBody = (
    selectionBodyId: string,
    selectionEdgeIds: number[],
    featureId: string,
  ): BRepBody | undefined => {
    const direct = globalBRepBodyRegistry.get(selectionBodyId);
    if (direct) return direct;

    const matchingLiveBody = globalBRepBodyRegistry
      .snapshot()
      .bodyIds
      .map((bodyId) => globalBRepBodyRegistry.get(bodyId))
      .find((body): body is BRepBody =>
        !!body && selectionEdgeIds.every((edgeId) => body.edgeIds.has(edgeId)),
      );
    if (matchingLiveBody) return matchingLiveBody;

    const features = get().features;
    const feature = features.find((candidate) => candidate.id === featureId);
    const currentBody = bodyForFeature(feature);
    if (currentBody) return currentBody;

    const sourceFeatureId =
      (feature?.params.sourceFeatureId as string | undefined) ??
      (feature?.params.parentFeatureId as string | undefined) ??
      (feature?.parentFeatureId as string | undefined) ??
      (feature?.params.targetId as string | undefined);
    const sourceBody = bodyForFeature(features.find((candidate) => candidate.id === sourceFeatureId));
    if (sourceBody) return sourceBody;

    const featureIndex = features.findIndex((candidate) => candidate.id === featureId);
    for (let index = featureIndex - 1; index >= 0; index -= 1) {
      const candidate = features[index];
      if (candidate.type === 'sketch' || candidate.suppressed) continue;
      const body = bodyForFeature(candidate);
      if (body) return body;
    }
    return undefined;
  };

  /**
   * Tessellate a result BRepBody, register a mesh, update feature state, and
   * free the old shape. Shared by full-round and rule-fillet paths that compute
   * the result body themselves rather than going through applyOccEdgeModification.
   */
  const installResultMesh = (
    tool: string,
    featureId: string,
    srcBody: BRepBody,
    resultBody: BRepBody,
    statusMessage: string,
    pushUndo: boolean,
  ): boolean => {
    const occ = getOccSync();
    if (!occ) {
      return markOccEdgeModificationError(featureId, tool, "OCC kernel is no longer available");
    }
    const srcFeatureId = srcBody.sourceFeatureId;
    const srcFeature = srcFeatureId
      ? get().features.find((f) => f.id === srcFeatureId)
      : undefined;
    const material = srcFeature?.mesh instanceof THREE.Mesh ? srcFeature.mesh.material : BODY_MATERIAL;
    let newMesh: THREE.Mesh;
    try {
      resultBody.sourceFeatureId = featureId;
      newMesh = createRegisteredOccMesh(occ.oc, resultBody, material, featureId);
    } catch (err) {
      return markOccEdgeModificationError(featureId, tool, `OCC tessellation failed: ${errorMessage(err, "unknown error")}`);
    }
    const currentFeature = get().features.find((f) => f.id === featureId);
    const prevMesh = currentFeature?.mesh instanceof THREE.Mesh ? currentFeature.mesh : null;
    const oldBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;
    if (pushUndo) get().pushUndo();
    set((state) => ({
      features: state.features.map((f) =>
        f.id === featureId
          ? { ...f, mesh: newMesh, healthState: "healthy" as const, healthMessage: undefined }
          : f,
      ),
      statusMessage,
    }));
    if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
      disposeMeshDeferred(prevMesh);
      if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
    }
    return true;
  };

  const applyOccEdgeModification = ({
    tool,
    featureId,
    edgeIds,
    radius,
    filletEdgeSets,
    continuity,
    tangencyWeight,
    distance,
    distance2,
    propagate = false,
    pushUndo = false,
    fullRoundFaces,
  }: {
    tool: "Fillet" | "Chamfer";
    featureId?: string;
    edgeIds: string[];
    radius?: number;
    filletEdgeSets?: OccFilletEdgeSet[];
    continuity?: 'G1' | 'G2';
    tangencyWeight?: number;
    distance?: number;
    distance2?: number;
    propagate?: boolean;
    pushUndo?: boolean;
    fullRoundFaces?: { centerFaceId: number; sideFaces: FullRoundSideFaces };
  }): boolean => {
    if (!featureId) {
      return markOccEdgeModificationError(undefined, tool, "OCC edge operations require a feature id");
    }
    const occ = getOccSync();
    if (!occ) {
      return markOccEdgeModificationError(featureId, tool, "OCC kernel is still loading; try again in a moment");
    }
    const selection = parseOccEdgeSelection(edgeIds);
    if (!selection) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        "Only OCC topology edge selections are supported on this branch",
      );
    }
    const srcBody = resolveLiveSourceBody(selection.bodyId, selection.edgeIds, featureId);
    if (!srcBody) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC source body is no longer available");
    }
    let numericEdgeIds = selection.edgeIds.filter((edgeId) =>
      srcBody.edgeIds.has(edgeId),
    );
    if (numericEdgeIds.length === 0) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC edges no longer exist on the source body");
    }

    // GAP B/C: Propagation for chamfer (fillet propagation is handled in commitFillet
    // before filletEdgeSets are built; chamfer propagation is handled here).
    if (propagate && tool === "Chamfer") {
      numericEdgeIds = propagateTangentEdges(occ, srcBody, numericEdgeIds);
    }

    const effectiveFilletEdgeSets: OccFilletEdgeSet[] =
      filletEdgeSets ?? [{ edgeIds: numericEdgeIds, radius: radius ?? DEFAULT_FILLET_RADIUS }];

    const result =
      tool === "Fillet"
        ? (fullRoundFaces
            ? occFullRoundFilletWithInstance(
                occ.oc,
                srcBody,
                fullRoundFaces.centerFaceId,
                fullRoundFaces.sideFaces,
                { sourceFeatureId: featureId },
              )
            : occFilletEdgeSetsWithInstance(
                occ.oc,
                srcBody,
                effectiveFilletEdgeSets,
                { sourceFeatureId: featureId, continuity, tangencyWeight },
              ))
        : occChamferWithInstance(occ.oc, srcBody, numericEdgeIds, distance ?? 0, {
            distance2:
              distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
            sourceFeatureId: featureId,
          });
    if (!result) {
      return markOccEdgeModificationError(featureId, tool, "OCC operation failed for the selected edge set");
    }

    const srcFeatureId = selection.sourceFeatureId ?? srcBody.sourceFeatureId;
    const srcFeature = srcFeatureId
      ? get().features.find((feature) => feature.id === srcFeatureId)
      : undefined;
    const srcMesh = srcFeature?.mesh;
    // Use the shared BODY_MATERIAL singleton when the source mesh cannot be
    // resolved. Creating a new material here was a per-fillet leak; BODY_MATERIAL
    // is a module-level singleton that is safe to share across edge-modification meshes.
    const material = srcMesh instanceof THREE.Mesh ? srcMesh.material : BODY_MATERIAL;
    let newMesh: THREE.Mesh;
    try {
      result.sourceFeatureId = featureId;
      newMesh = createRegisteredOccMesh(occ.oc, result, material, featureId);
    } catch (err) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        `OCC tessellation failed: ${errorMessage(err, "unknown error")}`,
      );
    }

    const currentFeature = get().features.find((feature) => feature.id === featureId);
    const prevMesh = currentFeature?.mesh instanceof THREE.Mesh ? currentFeature.mesh : null;
    // Capture the old body ID before set() so we can evict it from the registry
    // after the state update. Without this, each replay leaks one WASM OCC shape.
    const oldBodyId = prevMesh?.userData['brepBodyId'] as string | undefined;
    if (pushUndo) get().pushUndo();
    set((state) => ({
      features: state.features.map((feature) =>
        feature.id === featureId
          ? {
              ...feature,
              parentFeatureId: srcFeatureId ?? feature.parentFeatureId,
              params: {
                ...feature.params,
                parentFeatureId: srcFeatureId ?? feature.params.parentFeatureId,
                sourceFeatureId: srcFeatureId ?? feature.params.sourceFeatureId,
              },
              mesh: newMesh,
              healthState: "healthy" as const,
              healthMessage: undefined,
            }
          : feature,
      ),
      statusMessage:
        tool === "Fillet"
          ? `Filleted ${numericEdgeIds.length} OCC edge(s)${continuity === 'G2' ? ' (G2)' : ''}`
          : `Chamfered ${numericEdgeIds.length} OCC edge(s) at d=${distance}`,
    }));
    if (prevMesh && prevMesh.geometry !== newMesh.geometry) {
      disposeMeshDeferred(prevMesh);
      if (oldBodyId) globalBRepBodyRegistry.delete(oldBodyId);
    }
    return true;
  };

  return { applyOccEdgeModification, installResultMesh, markOccEdgeModificationError };
}

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
import { parseOccEdgeSelection, storedEdgeIds } from "../../../../utils/occEdgeUtils";
import { disposeMeshDeferred } from "../../../../engine/occ/picking";
import { BODY_MATERIAL } from "../../../../components/viewport/scene/bodyMaterial";
import { isBRepBodyAlive } from "../../../../engine/occ/brepBody";
import { refreshStaleBodySync } from "../../persistence";
import { DEFAULT_FILLET_RADIUS, propagateTangentEdges, resolveOccFilletEdgeSets } from "./edgeModHelpers";
import { analyzeMeshGeometry } from "../../../../meshRepair/meshRepair";

type SourceFeature = CADState['features'][number];

/**
 * Primitives apply their position / rotation at the React mesh level (params
 * x/y/z + rx/ry/rz in degrees) — the OCC tessellation is in local body space,
 * centered at origin. When a fillet / chamfer creates a new BRep body, the
 * result tessellation inherits that local space and the new THREE.Mesh
 * defaults to position (0,0,0). Without this transfer the rounded body
 * appears at world origin instead of where the primitive sits.
 *
 * Extrudes / revolves bake their world transform into their geometry, so
 * they have no params.x/y/z to copy — this is a no-op for them.
 */
function copySourceTransformToMesh(srcFeature: SourceFeature | undefined, mesh: THREE.Mesh): void {
  if (!srcFeature) return;
  if (srcFeature.type !== 'primitive') return;
  const { params } = srcFeature;
  mesh.position.set(
    (params.x as number) || 0,
    (params.y as number) || 0,
    (params.z as number) || 0,
  );
  mesh.rotation.set(
    THREE.MathUtils.degToRad((params.rx as number) || 0),
    THREE.MathUtils.degToRad((params.ry as number) || 0),
    THREE.MathUtils.degToRad((params.rz as number) || 0),
  );
  mesh.updateMatrix();
}

function edgeModificationIntroducedOpenMesh(
  sourceMesh: THREE.Mesh | undefined,
  resultMesh: THREE.Mesh,
): { boundaryDelta: number; nonManifoldDelta: number } | null {
  if (!(sourceMesh instanceof THREE.Mesh)) return null;
  const sourceReport = analyzeMeshGeometry(sourceMesh.geometry);
  const resultReport = analyzeMeshGeometry(resultMesh.geometry);
  const boundaryDelta = resultReport.boundaryEdges - sourceReport.boundaryEdges;
  const nonManifoldDelta = resultReport.nonManifoldEdges - sourceReport.nonManifoldEdges;

  // OCC sometimes exposes partial fillet/chamfer results as "done" even though
  // the tessellated body is open. Do not install a result that made topology
  // visibly less watertight than the source body.
  if (boundaryDelta > 0 || nonManifoldDelta > 0) {
    return { boundaryDelta, nonManifoldDelta };
  }
  return null;
}

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

  /**
   * If a body's WASM shape wrapper is stale ("already deleted"), attempt to
   * restore it from the feature's serialized STEP data synchronously.
   * Returns the refreshed body, or undefined if restoration failed.
   */
  const ensureBodyAlive = (body: BRepBody, bodyId: string): BRepBody | undefined => {
    if (isBRepBodyAlive(body)) return body;
    // Body shape is stale — find the feature that owns it and restore from STEP.
    const features = get().features;
    const ownerFeature = features.find((f) => {
      if (!(f.mesh instanceof THREE.Mesh)) return false;
      return f.mesh.userData['brepBodyId'] === bodyId;
    }) ?? features.find((f) => f.id === body.sourceFeatureId);
    if (ownerFeature && refreshStaleBodySync(ownerFeature, bodyId)) {
      return globalBRepBodyRegistry.get(bodyId);
    }
    return undefined;
  };

  /**
   * After a hard refresh the registry is empty but features still carry
   * _occStepData and mesh.userData.brepBodyId. Find the feature that owns
   * the given bodyId and restore its OCC body from STEP synchronously.
   */
  const restoreMissingBodyFromFeature = (bodyId: string): BRepBody | undefined => {
    const features = get().features;
    const ownerFeature = features.find((f) => {
      if (!(f.mesh instanceof THREE.Mesh)) return false;
      return f.mesh.userData['brepBodyId'] === bodyId;
    });
    if (ownerFeature && refreshStaleBodySync(ownerFeature, bodyId)) {
      return globalBRepBodyRegistry.get(bodyId);
    }
    return undefined;
  };

  const resolveLiveSourceBody = (
    selectionBodyId: string,
    selectionEdgeIds: number[],
    featureId: string,
  ): BRepBody | undefined => {
    // 1. Direct lookup by selection body ID.
    const direct = globalBRepBodyRegistry.get(selectionBodyId);
    if (direct) {
      const alive = ensureBodyAlive(direct, selectionBodyId);
      if (alive) return alive;
    }

    // 2. Body missing entirely (e.g. after hard refresh) — restore from STEP.
    if (!direct) {
      const restored = restoreMissingBodyFromFeature(selectionBodyId);
      if (restored) return restored;
    }

    // 3. Search registry for any body that has all the selected edges.
    const matchingLiveBody = globalBRepBodyRegistry
      .snapshot()
      .bodyIds
      .map((bodyId) => globalBRepBodyRegistry.get(bodyId))
      .find((body): body is BRepBody =>
        !!body && selectionEdgeIds.every((edgeId) => body.edgeIds.has(edgeId)),
      );
    if (matchingLiveBody) {
      const alive = ensureBodyAlive(matchingLiveBody, matchingLiveBody.id);
      if (alive) return alive;
    }

    // 4. Look up body via feature associations.
    const features = get().features;
    const feature = features.find((candidate) => candidate.id === featureId);

    // 4a. Try restoring from the fillet feature's own source/parent feature.
    const sourceFeatureId =
      (feature?.params.sourceFeatureId as string | undefined) ??
      (feature?.params.parentFeatureId as string | undefined) ??
      (feature?.parentFeatureId as string | undefined) ??
      (feature?.params.targetId as string | undefined);
    if (sourceFeatureId) {
      const sourceFeature = features.find((candidate) => candidate.id === sourceFeatureId);
      if (sourceFeature) {
        const srcBodyId = sourceFeature.mesh instanceof THREE.Mesh
          ? (sourceFeature.mesh.userData['brepBodyId'] as string | undefined)
          : undefined;
        if (srcBodyId) {
          const existing = globalBRepBodyRegistry.get(srcBodyId);
          if (existing) {
            const alive = ensureBodyAlive(existing, srcBodyId);
            if (alive) return alive;
          } else {
            const restored = restoreMissingBodyFromFeature(srcBodyId);
            if (restored) return restored;
          }
        }
      }
    }

    // 4b. Current feature's body.
    const currentBody = bodyForFeature(feature);
    if (currentBody) {
      const alive = ensureBodyAlive(currentBody, currentBody.id);
      if (alive) return alive;
    }

    // 4c. Source feature's body (via bodyForFeature).
    const sourceBody = bodyForFeature(features.find((candidate) => candidate.id === sourceFeatureId));
    if (sourceBody) {
      const alive = ensureBodyAlive(sourceBody, sourceBody.id);
      if (alive) return alive;
    }

    // 5. Walk backwards through feature list for any body.
    const featureIndex = features.findIndex((candidate) => candidate.id === featureId);
    for (let index = featureIndex - 1; index >= 0; index -= 1) {
      const candidate = features[index];
      if (candidate.type === 'sketch' || candidate.suppressed) continue;
      const body = bodyForFeature(candidate);
      if (body) {
        const alive = ensureBodyAlive(body, body.id);
        if (alive) return alive;
      }
      // Body not in registry — try STEP restore from this feature.
      const candidateBodyId = candidate.mesh instanceof THREE.Mesh
        ? (candidate.mesh.userData['brepBodyId'] as string | undefined)
        : undefined;
      if (candidateBodyId && !globalBRepBodyRegistry.get(candidateBodyId)) {
        const restored = restoreMissingBodyFromFeature(candidateBodyId);
        if (restored) return restored;
      }
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
      copySourceTransformToMesh(srcFeature, newMesh);
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
    filletParams,
    continuity,
    tangencyWeight,
    isRollingBallCorner,
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
    filletParams?: Record<string, unknown>;
    continuity?: 'G1' | 'G2';
    tangencyWeight?: number;
    isRollingBallCorner?: boolean;
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
    const resolvedBody = resolveLiveSourceBody(selection.bodyId, selection.edgeIds, featureId);
    if (!resolvedBody) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC source body is no longer available");
    }

    // Prefer the most-downstream body in the feature chain that still has all
    // the selected edges. This handles the case where the edge picker recorded
    // a body ID from an intermediate body (e.g. the base extrude) while a later
    // body (e.g. after corner fillets) also carries those edges. Applying to the
    // most-downstream body ensures the result preserves all previous modifications.
    const allFeatures = get().features;
    const currentIndex = allFeatures.findIndex((f) => f.id === featureId);
    const limit = currentIndex >= 0 ? currentIndex : allFeatures.length;

    const srcBody = (() => {
      let best = resolvedBody;
      for (let i = 0; i < limit; i++) {
        const f = allFeatures[i];
        if (f.type === 'sketch' || f.suppressed) continue;
        const candidate = bodyForFeature(f);
        const alive = candidate ? ensureBodyAlive(candidate, candidate.id) : null;
        if (alive && selection.edgeIds.every((id) => alive.edgeIds.has(id))) {
          best = alive;
        }
      }
      if (best.id !== resolvedBody.id) {
        console.log(
          `[${tool}] upgraded source body: ${resolvedBody.id}` +
          ` → ${best.id} (feature=${best.sourceFeatureId ?? '?'})`,
        );
      }
      return best;
    })();

    let numericEdgeIds = selection.edgeIds.filter((edgeId) =>
      srcBody.edgeIds.has(edgeId),
    );
    console.log(
      `[${tool}] srcBody edgeCount=${srcBody.edgeIds.size} faceCount=${srcBody.faceIds.size}` +
      ` selectedEdges=[${numericEdgeIds.join(',')}] bodyId=${srcBody.id}`,
    );
    if (numericEdgeIds.length === 0) {
      return markOccEdgeModificationError(featureId, tool, "Selected OCC edges no longer exist on the source body");
    }

    // GAP B/C: Propagation for chamfer (fillet propagation is handled in commitFillet
    // before filletEdgeSets are built; chamfer propagation is handled here).
    if (propagate && tool === "Chamfer") {
      numericEdgeIds = propagateTangentEdges(occ, srcBody, numericEdgeIds);
    }

    // The "current" edge sets for this specific fillet commit.
    const currentFilletEdgeSets: OccFilletEdgeSet[] =
      filletEdgeSets ??
      resolveOccFilletEdgeSets(
        numericEdgeIds,
        srcBody,
        filletParams,
        radius ?? DEFAULT_FILLET_RADIUS,
      );

    // When no upstream body upgrade was found and this is a standard fillet, collect
    // all preceding sibling fillet features that reference the same source body.
    // These sibling sets will be combined with the current operation so the resulting
    // body preserves all prior fillets on this body (handles the reload case where
    // upstream fillet bodies are absent from the registry).
    const siblingFilletEdgeSets: OccFilletEdgeSet[] = [];
    if (tool === 'Fillet' && !fullRoundFaces && srcBody.id === resolvedBody.id) {
      for (let i = 0; i < limit; i++) {
        const f = allFeatures[i];
        if (f.type !== 'fillet' || f.suppressed || f.id === featureId) continue;
        const mode = f.params.mode as string | undefined;
        if (mode === 'full-round' || mode === 'rule-fillet') continue;
        const sibStoredIds = storedEdgeIds(f.params.edgeIds);
        if (sibStoredIds.length === 0) continue;
        const sibSel = parseOccEdgeSelection(sibStoredIds);
        if (!sibSel || sibSel.bodyId !== selection.bodyId) continue;
        const sibNumericIds = sibSel.edgeIds.filter((id) => srcBody.edgeIds.has(id));
        if (sibNumericIds.length === 0) continue;
        const sibEdgeSets = resolveOccFilletEdgeSets(sibNumericIds, srcBody, f.params as Record<string, unknown>);
        siblingFilletEdgeSets.push(...sibEdgeSets);
      }
    }

    // Build the combined edge-set list (sibling sets prepended, current sets last).
    // Deduplicate: if a sibling set's tangent-chain propagation overlaps with the
    // current set's edges, drop the duplicate from the sibling set so each edge
    // appears exactly once — OCC cannot fillet the same edge twice in one build pass.
    let effectiveFilletEdgeSets: OccFilletEdgeSet[] = currentFilletEdgeSets;
    if (siblingFilletEdgeSets.length > 0) {
      const currentEdgeIds = new Set(currentFilletEdgeSets.flatMap((es) => es.edgeIds));
      const deduplicatedSiblings = siblingFilletEdgeSets
        .map((es) => ({ ...es, edgeIds: es.edgeIds.filter((id) => !currentEdgeIds.has(id)) }))
        .filter((es) => es.edgeIds.length > 0);
      if (deduplicatedSiblings.length > 0) {
        effectiveFilletEdgeSets = [...deduplicatedSiblings, ...currentFilletEdgeSets];
        console.log(
          `[${tool}] combined ${deduplicatedSiblings.length} sibling edge-set(s)` +
          ` → ${effectiveFilletEdgeSets.length} total applied to base body`,
        );
      }
    }

    // Compute the fillet / chamfer result.
    let result: BRepBody | null;
    if (tool === 'Fillet') {
      if (fullRoundFaces) {
        result = occFullRoundFilletWithInstance(
          occ.oc, srcBody,
          fullRoundFaces.centerFaceId, fullRoundFaces.sideFaces,
          { sourceFeatureId: featureId, continuity, tangencyWeight, isRollingBallCorner },
        );
      } else {
        // Primary path: apply all edge sets (siblings + current) in one OCC build.
        result = occFilletEdgeSetsWithInstance(
          occ.oc, srcBody, effectiveFilletEdgeSets,
          { sourceFeatureId: featureId, continuity, tangencyWeight, isRollingBallCorner },
        );

        // Arc-first sequential fallback: the combined pass fails when the corner edge
        // and arc edge share a vertex (OCC cannot compute the fillet surface junction in
        // one pass). Instead, apply the current (arc) fillet to the base body first,
        // then find the corner edge IDs in the arc-filleted intermediate body and apply
        // all sibling (corner) fillets on top. Corner edges are geometrically far from
        // the arc region, so their IDs remain stable after the arc fillet topology change.
        if (!result && siblingFilletEdgeSets.length > 0) {
          console.warn(`[${tool}] combined fillet failed — trying arc-first sequential fallback`);
          try {
            // Step 1: Apply the current (arc) fillet to the base body.
            const arcBody = occFilletEdgeSetsWithInstance(
              occ.oc, srcBody, currentFilletEdgeSets,
              { sourceFeatureId: `${featureId}_arc` },
            );
            if (arcBody) {
              // Step 2: Re-map sibling (corner) edge sets to the arc-filleted body.
              // Corner edges are unaffected by the arc fillet, so their IDs survive.
              const cornerSetsInArcBody: OccFilletEdgeSet[] = [];
              for (let i = 0; i < limit; i++) {
                const f = allFeatures[i];
                if (f.type !== 'fillet' || f.suppressed || f.id === featureId) continue;
                const mode = f.params.mode as string | undefined;
                if (mode === 'full-round' || mode === 'rule-fillet') continue;
                const sibStoredIds = storedEdgeIds(f.params.edgeIds);
                if (sibStoredIds.length === 0) continue;
                const sibSel = parseOccEdgeSelection(sibStoredIds);
                if (!sibSel || sibSel.bodyId !== selection.bodyId) continue;
                const sibNumericIds = sibSel.edgeIds.filter((id) => arcBody.edgeIds.has(id));
                if (sibNumericIds.length === 0) continue;
                const sibEdgeSets = resolveOccFilletEdgeSets(sibNumericIds, arcBody, f.params as Record<string, unknown>);
                cornerSetsInArcBody.push(...sibEdgeSets);
              }
              if (cornerSetsInArcBody.length > 0) {
                // Step 3: Apply all corner fillets to the arc-filleted body.
                result = occFilletEdgeSetsWithInstance(
                  occ.oc, arcBody, cornerSetsInArcBody,
                  { sourceFeatureId: featureId, continuity, tangencyWeight, isRollingBallCorner },
                );
              }
              console.log(
                `[${tool}] arc-first fallback: cornerSets=${cornerSetsInArcBody.length}` +
                ` result=${result ? 'ok' : 'null'}`,
              );
              if (!result) arcBody.dispose();
            } else {
              console.warn(`[${tool}] arc-first fallback: arc fillet on base body failed`);
            }
          } catch (seqErr) {
            console.warn(`[${tool}] arc-first fallback threw`, seqErr);
          }
        }
      }
    } else {
      result = occChamferWithInstance(occ.oc, srcBody, numericEdgeIds, distance ?? 0, {
        distance2: distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
        sourceFeatureId: featureId,
      });
    }
    if (!result) {
      return markOccEdgeModificationError(featureId, tool, "OCC operation failed for the selected edge set");
    }
    if (result.faceIds.size <= srcBody.faceIds.size) {
      const resultFaceCount = result.faceIds.size;
      const sourceFaceCount = srcBody.faceIds.size;
      result.dispose();
      return markOccEdgeModificationError(
        featureId,
        tool,
        `${tool} returned topology without a new blend face ` +
          `(source faces: ${sourceFaceCount}, result faces: ${resultFaceCount}); kept the previous body unchanged`,
      );
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
      copySourceTransformToMesh(srcFeature, newMesh);
    } catch (err) {
      return markOccEdgeModificationError(
        featureId,
        tool,
        `OCC tessellation failed: ${errorMessage(err, "unknown error")}`,
      );
    }
    const meshTopologyFailure = edgeModificationIntroducedOpenMesh(
      srcMesh instanceof THREE.Mesh ? srcMesh : undefined,
      newMesh,
    );
    if (meshTopologyFailure) {
      const { boundaryDelta, nonManifoldDelta } = meshTopologyFailure;
      newMesh.geometry.dispose();
      globalBRepBodyRegistry.delete(result.id);
      result.dispose();
      const requestedSize = tool === "Fillet" ? radius : distance;
      const sizeHint =
        typeof requestedSize === "number"
          ? ` The requested ${tool.toLowerCase()} size (${requestedSize}) is likely too large for the selected edge(s) or nearby blends; try a smaller value.`
          : "";
      return markOccEdgeModificationError(
        featureId,
        tool,
        `${tool} produced an open mesh ` +
          `(new boundary edges: ${boundaryDelta}, new non-manifold edges: ${nonManifoldDelta}); ` +
          `kept the previous body unchanged.${sizeHint}`,
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

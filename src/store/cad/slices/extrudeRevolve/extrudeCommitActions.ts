import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import { EXTRUDE_DEFAULTS } from '../../defaults';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { detachTessellationFromMesh } from '../../../../engine/occ/picking';
import { OCC_BOOLEAN_VERSION } from '../../../../utils/occConstants';
import {
  collapseSameSketchProfilesForNewBody,
  computeToObjectDistance,
  resolveSelectedExtrudeProfiles,
} from './extrudeCommitHelpers';
import { resolveEffectiveExtrudeOperation } from './extrudeCommitOperation';
import { registerExtrudeBody } from './extrudeCommitBodyRegistration';
import {
  buildImmediateOccBooleanExtrudeMesh,
  buildMultiProfileOccBooleanExtrudeMesh,
  buildSingleProfileOccBooleanExtrudeMesh,
} from './extrudeCommitOccBoolean';
import { buildOccNewBodyExtrudeMesh } from './extrudeCommitOccNewBody';

export function createExtrudeCommitActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitExtrude: async () => {
    const {
      extrudeSelectedSketchId, extrudeSelectedSketchIds, extrudeDistance, extrudeDistance2, extrudeDirection,
      extrudeOperation, extrudeThinEnabled, extrudeThinThickness, extrudeThinSide,
      extrudeThinSide2, extrudeThinThickness2,
      extrudeStartType, extrudeStartOffset, extrudeStartEntityId, extrudeExtentType, extrudeTaperAngle, extrudeTaperAngle2,
      extrudeBodyKind, extrudeSymmetricFullLength, extrudeParticipantBodyIds,
      extrudeConfinedFaceIds,
      extrudeExtentType2,
      extrudeToEntityFaceId, extrudeToEntityFaceNormal,
      extrudeStartFaceCentroid, extrudeStartFaceNormal,
      extrudeCreationOccurrence,
      extrudeTargetBaseFeature,
      extrudeToEntityFaceCentroid, extrudeToObjectFlipDirection,
      editingFeatureId,
      sketches, features, units,
      pushUndo,
    } = get();
    // EX-13: edit mode â€" identify the feature being replaced
    const editingExtrude = editingFeatureId
      ? features.find((f) => f.id === editingFeatureId && f.type === 'extrude') ?? null
      : null;
    const editingIndex = editingExtrude ? features.findIndex((f) => f.id === editingFeatureId) : -1;
    // Capture old mesh + brepBodyId before the filter discards the feature.
    // Must be done here -- after filter the reference is gone from nextFeatures.
    const editingOldMesh = editingExtrude?.mesh instanceof THREE.Mesh ? editingExtrude.mesh : null;
    const editingOldBrepBodyId = editingOldMesh?.userData['brepBodyId'] as string | undefined;
    const selectedSketchIds =
      extrudeSelectedSketchIds.length > 0
        ? extrudeSelectedSketchIds
        : (extrudeSelectedSketchId ? [extrudeSelectedSketchId] : []);
    if (selectedSketchIds.length === 0) {
      set({ statusMessage: 'No profile selected' });
      return;
    }
    const selectedProfiles = resolveSelectedExtrudeProfiles(selectedSketchIds, sketches);

    if (selectedProfiles.length === 0) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    const requestedBooleanOperation = extrudeOperation === 'cut' || extrudeOperation === 'intersect';
    const profilesToCommit = collapseSameSketchProfilesForNewBody(selectedProfiles, requestedBooleanOperation);
    if (extrudeExtentType === 'distance' && Math.abs(extrudeDistance) < 0.01) {
      set({ statusMessage: 'Distance must be non-zero' });
      return;
    }
    pushUndo();
    // Use absolute distance â€" negative just means the user dragged in reverse
    const absDistance = extrudeExtentType === 'all'
      ? 10000
      : extrudeExtentType === 'to-object'
        ? computeToObjectDistance(
            (profilesToCommit[0]?.sketchForOp) ?? (profilesToCommit[0]?.sourceSketch),
            extrudeDistance,
            extrudeToEntityFaceCentroid,
            extrudeToEntityFaceNormal,
            extrudeStartFaceCentroid,
            extrudeToObjectFlipDirection,
          )
        : Math.abs(extrudeDistance);
    // EX-10: side 2 uses its own independent extent type
    const absDistance2 = extrudeExtentType2 === 'all'
      ? 10000
      : extrudeExtentType2 === 'to-object'
        ? computeToObjectDistance(
            (profilesToCommit[0]?.sketchForOp) ?? (profilesToCommit[0]?.sourceSketch),
            extrudeDistance,
            extrudeToEntityFaceCentroid,
            extrudeToEntityFaceNormal,
            extrudeStartFaceCentroid,
            extrudeToObjectFlipDirection,
          )
        : Math.abs(extrudeDistance2);
    // Direction follows the sign of the distance (two-sides never flips)
    const finalDirection = extrudeDirection === 'two-sides' ? 'two-sides' : (extrudeDistance < 0 ? 'negative' : extrudeDirection);
    // Operation is set explicitly by the user in the panel (new-body, join, cut)
    const finalOperation = extrudeOperation;

    // EX-13: in edit mode, remove the old feature first (new one inserts at same position)
    // Re-read from get() at each await boundary -- concurrent undo/removeFeature can change
    // the live features array while we're in an async OCC op.
    const nextFeatures = editingExtrude
      ? features.filter((f) => f.id !== editingFeatureId)
      : [...features];
    let createdCount = 0;
    let firstCreatedSketchName: string | null = null;

    for (const selected of profilesToCommit) {
      const { sourceSketch, sketchForOp, profileIndex, profileIndices } = selected;
      let committedDirection = finalDirection;
      const requestedBoolean = finalOperation === 'cut' || finalOperation === 'intersect';
      const isClosedProfile = profileIndices?.length
        ? profileIndices.every((index) => GeometryEngine.createProfileSketch(sourceSketch, index) !== null)
        : requestedBoolean && selected.profileIndex !== undefined
          ? true
          : GeometryEngine.isSketchClosedProfile(sketchForOp);
      const resolvedBodyKind: 'solid' | 'surface' = !isClosedProfile
        ? 'surface'
        : requestedBoolean
          ? 'solid'
          : extrudeBodyKind === 'surface' ? 'surface' : 'solid';

      // Generate stored meshes for surface/thin extrudes. Standard solids are
      // produced by the OCC path below and must store a registered OCC mesh.
      let featureMesh: THREE.Mesh | undefined;
      if (resolvedBodyKind === 'surface') {
        featureMesh = GeometryEngine.extrudeSketchSurface(sketchForOp, absDistance) ?? undefined;
      } else if (extrudeThinEnabled) {
        const thinSide: 'inside' | 'outside' | 'center' = extrudeThinSide === 'side1' ? 'inside' : extrudeThinSide === 'side2' ? 'outside' : 'center';
        featureMesh = GeometryEngine.extrudeThinSketch(sketchForOp, absDistance, extrudeThinThickness, thinSide) ?? undefined;
      }
      // Solid non-thin: featureMesh left undefined here; OCC path below must provide it.

      // Apply start offset to thin/surface stored meshes.
      if (featureMesh && extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
        const n = GeometryEngine.getSketchExtrudeNormal(sketchForOp);
        featureMesh.position.addScaledVector(n, extrudeStartOffset);
      }

      // Thin and surface extrudes always need a stored mesh. Solid non-thin starts
      // false; OCC path below may promote it to true.
      let needsStoredMesh = resolvedBodyKind === 'surface' || extrudeThinEnabled;

      // Multi-profile selection: when the user picks several profiles and
      // chooses 'new-body', profiles that overlap each other should fuse into
      // a single body (Fusion 360 parity â€" they are "connected" after extrude).
      // We do this by routing the 2nd-onwards profile through the 'join' path,
      // which already has the bbox-overlap check + auto-promote-to-new-body
      // behavior for disconnected profiles. The 1st profile stays 'new-body'
      // so disconnected selections still start with a fresh body.
      const effectiveOperation = await resolveEffectiveExtrudeOperation({
        finalOperation,
        profilesToCommitCount: profilesToCommit.length,
        createdCount,
        resolvedBodyKind,
        extrudeThinEnabled,
        nextFeatures,
        selected,
        absDistance,
        finalDirection,
        extrudeTaperAngle,
        extrudeStartOffset,
        extrudeStartType,
        absDistance2,
        extrudeTaperAngle2,
        sketches,
      });
      const featureId = crypto.randomUUID();
      let occFailureMessage: string | null = null;

      const occNewBodyResult = await buildOccNewBodyExtrudeMesh({
        resolvedBodyKind,
        extrudeThinEnabled,
        effectiveOperation,
        profileIndices,
        sourceSketch,
        sketchForOp,
        profileIndex,
        featureId,
        finalDirection,
        absDistance,
        absDistance2,
        extrudeSymmetricFullLength,
        extrudeStartType,
        extrudeStartOffset,
        extrudeTaperAngle,
        extrudeTaperAngle2,
      });
      if (occNewBodyResult.featureMesh) {
        featureMesh = occNewBodyResult.featureMesh;
        needsStoredMesh = occNewBodyResult.needsStoredMesh;
      }
      if (occNewBodyResult.occFailureMessage) occFailureMessage = occNewBodyResult.occFailureMessage;

      const immediateOccBooleanResult = buildImmediateOccBooleanExtrudeMesh({
        resolvedBodyKind,
        extrudeThinEnabled,
        effectiveOperation,
        profileIndices,
        extrudeExtentType,
        nextFeatures,
        sourceSketch,
        sketchForOp,
        profileIndex,
        featureId,
        finalDirection,
        absDistance,
        absDistance2,
        extrudeSymmetricFullLength,
        extrudeStartType,
        extrudeStartOffset,
        extrudeTaperAngle,
        extrudeTaperAngle2,
      });
      if (immediateOccBooleanResult.featureMesh) {
        featureMesh = immediateOccBooleanResult.featureMesh;
        needsStoredMesh = immediateOccBooleanResult.needsStoredMesh;
        if (immediateOccBooleanResult.suppressedTargetId) {
          const targetIndex = nextFeatures.findIndex((feature) => feature.id === immediateOccBooleanResult.suppressedTargetId);
          if (targetIndex >= 0) nextFeatures[targetIndex] = { ...nextFeatures[targetIndex], suppressed: true, visible: false };
        }
      }
      if (immediateOccBooleanResult.occFailureMessage) occFailureMessage = immediateOccBooleanResult.occFailureMessage;

      const featureName = editingExtrude && profilesToCommit.length === 1
        ? editingExtrude.name
        : `${extrudeThinEnabled ? 'Thin ' : ''}${effectiveOperation === 'cut' ? 'Cut' : 'Extrude'} ${nextFeatures.filter(f => f.type === 'extrude').length + createdCount + 1}`;
      let componentId: string | undefined;
      let bodyId: string | undefined;

      // Guard: for solid non-thin new-body/new-component extrudes, the OCC path must
      // have produced a mesh before we touch componentStore. Without this guard, a
      // failed OCC commit persists an orphaned body (no matching cadStore feature) ->
      // phantom body entries in the Bodies panel on every reload.
      // (join/cut/intersect don't create a new-body entry here, so they don't orphan;
      //  they're handled by the later gate after the remaining boolean paths.)
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        (effectiveOperation === 'new-body' || effectiveOperation === 'new-component') &&
        !featureMesh
      ) {
        set({
          statusMessage: occFailureMessage
            ? `Extrude ${effectiveOperation} failed: ${occFailureMessage}`
            : `Extrude ${effectiveOperation} requires a valid OCC solid`,
        });
        continue;
      }

      // When an extrude produces geometrically disconnected pieces (two
      // disjoint profiles, or an OCC cut that split a body) each piece should
      // show up as its own entry in the Bodies browser. Build a preview
      // mesh here solely to count connected components, and register one
      // body per piece. The extra ids are stored on the feature so the
      // renderer can match a split geometry â†' bodies by index.
      const registeredBody = await registerExtrudeBody({
        effectiveOperation,
        sourceSketch,
        resolvedBodyKind,
        featureId,
        needsStoredMesh,
        featureMesh,
        selected,
        absDistance,
        finalDirection,
        extrudeTaperAngle,
        extrudeStartType,
        extrudeStartOffset,
        absDistance2,
        extrudeTaperAngle2,
      });
      componentId = registeredBody.componentId;
      bodyId = registeredBody.bodyId;
      const { extraBodyIds } = registeredBody;

      // OCC join/cut path: boolean the extrude against the most recent OCC-backed solid target.
      // Only runs for solid, non-thin, distance-extent extrudes in join/cut/intersect mode where
      // the target already carries a brepBodyId (was produced by the OCC pipeline).
      let occBoolTargetIdToSuppress: string | undefined;
      let occBooleanResolved = false;
      const singleProfileOccBooleanResult = await buildSingleProfileOccBooleanExtrudeMesh({
        resolvedBodyKind,
        extrudeThinEnabled,
        needsStoredMesh,
        effectiveOperation,
        profileIndices,
        nextFeatures,
        sketches,
        sourceSketch,
        sketchForOp,
        selected,
        profileIndex,
        featureId,
        finalDirection,
        absDistance,
        absDistance2,
        extrudeSymmetricFullLength,
        extrudeStartType,
        extrudeStartOffset,
        extrudeTaperAngle,
        extrudeTaperAngle2,
        isStale: () => get().features !== features,
      });
      if (singleProfileOccBooleanResult.stale) return;
      if (singleProfileOccBooleanResult.featureMesh) {
        featureMesh = singleProfileOccBooleanResult.featureMesh;
        needsStoredMesh = singleProfileOccBooleanResult.needsStoredMesh;
        if (singleProfileOccBooleanResult.committedDirection) {
          committedDirection = singleProfileOccBooleanResult.committedDirection;
        }
        occBoolTargetIdToSuppress = singleProfileOccBooleanResult.suppressedTargetId;
        bodyId = singleProfileOccBooleanResult.bodyId;
        componentId = singleProfileOccBooleanResult.componentId;
        if (bodyId && featureMesh) {
          const componentState = useComponentStore.getState();
          componentState.addFeatureToBody(bodyId, featureId);
          componentState.setBodyMesh(bodyId, featureMesh);
        }
        occBooleanResolved = singleProfileOccBooleanResult.occBooleanResolved;
      }

      // OCC join/cut path for multi-profile extrude (profileIndices defined).
      // Fuses all profile extrudes into one tool body then booleans against target.
      const multiProfileOccBooleanResult = await buildMultiProfileOccBooleanExtrudeMesh({
        resolvedBodyKind,
        extrudeThinEnabled,
        needsStoredMesh,
        effectiveOperation,
        profileIndices,
        extrudeExtentType,
        nextFeatures,
        sourceSketch,
        sketchForOp,
        featureId,
        finalDirection,
        absDistance,
        absDistance2,
        extrudeSymmetricFullLength,
        extrudeTaperAngle,
        extrudeTaperAngle2,
        isStale: () => get().features !== features,
      });
      if (multiProfileOccBooleanResult.stale) return;
      if (multiProfileOccBooleanResult.featureMesh) {
        featureMesh = multiProfileOccBooleanResult.featureMesh;
        needsStoredMesh = multiProfileOccBooleanResult.needsStoredMesh;
        occBoolTargetIdToSuppress = multiProfileOccBooleanResult.suppressedTargetId;
        bodyId = multiProfileOccBooleanResult.bodyId;
        componentId = multiProfileOccBooleanResult.componentId;
        if (bodyId && featureMesh) {
          const componentState = useComponentStore.getState();
          componentState.addFeatureToBody(bodyId, featureId);
          componentState.setBodyMesh(bodyId, featureMesh);
        }
        occBooleanResolved = multiProfileOccBooleanResult.occBooleanResolved;
      }
      if (multiProfileOccBooleanResult.occFailureMessage) {
        occFailureMessage = multiProfileOccBooleanResult.occFailureMessage;
      }

      if (requestedBoolean && !occBooleanResolved) {
        needsStoredMesh = false;
      }

      if (resolvedBodyKind === 'solid' && !extrudeThinEnabled && !featureMesh) {
        set({
          statusMessage: occFailureMessage
            ? `Extrude ${effectiveOperation} failed in OCC: ${occFailureMessage}`
            : `Extrude ${effectiveOperation} requires an OCC-backed profile and target`,
        });
        continue;
      }

      const feature: Feature = {
        id: featureId,
        name: featureName,
        type: 'extrude',
        sketchId: sourceSketch.id,
        bodyId,
        componentId,
        params: {
          distance: finalDirection === 'symmetric'
            ? (extrudeSymmetricFullLength ? absDistance / 2 : absDistance)
            : absDistance,
          distanceExpr: String(absDistance),
          ...(finalDirection === 'two-sides' ? { distance2: absDistance2 } : {}),
          // Extra body ids for disconnected pieces (2nd piece onwards). The
          // renderer uses these to label each split component separately so
          // every disconnected piece becomes its own row in the Bodies list.
          ...(extraBodyIds.length > 0 ? { extraBodyIds } : {}),
          direction: committedDirection,
          operation: effectiveOperation,
          ...(occBooleanResolved ? { occBooleanVersion: OCC_BOOLEAN_VERSION } : {}),
          thin: extrudeThinEnabled,
          thinThickness: extrudeThinThickness,
          thinSide: extrudeThinSide,
          // EX-7/EX-8: per-side thin values (relevant only when direction=two-sides)
          thinSide2: extrudeThinSide2,
          thinThickness2: extrudeThinThickness2,
          startType: extrudeStartType,
          startOffset: extrudeStartOffset,
          ...(extrudeStartType === 'entity' ? { startEntityId: extrudeStartEntityId } : {}),
          // EX-4: From-Entity face data
          ...(extrudeStartFaceCentroid ? { startFaceCentroid: extrudeStartFaceCentroid, startFaceNormal: extrudeStartFaceNormal } : {}),
          // EX-9: participant bodies (empty array = all bodies)
          ...(extrudeParticipantBodyIds.length > 0 ? { participantBodyIds: extrudeParticipantBodyIds } : {}),
          // SDK-12: confined faces (empty = no confinement)
          ...(extrudeConfinedFaceIds.length > 0 ? { confinedFaceIds: extrudeConfinedFaceIds } : {}),
          // EX-15: occurrence context the profile was created in
          ...(extrudeCreationOccurrence ? { creationOccurrence: extrudeCreationOccurrence } : {}),
          // EX-16: target base feature container for direct-edit mode
          ...(extrudeTargetBaseFeature ? { targetBaseFeature: extrudeTargetBaseFeature } : {}),
          extentType: extrudeExtentType,
          // EX-3/EX-12: save to-object face data + flip for edit round-trip
          ...(extrudeExtentType === 'to-object' && extrudeToEntityFaceCentroid
            ? { toEntityFaceId: extrudeToEntityFaceId, toEntityFaceNormal: extrudeToEntityFaceNormal, toEntityFaceCentroid: extrudeToEntityFaceCentroid, toObjectFlipDirection: extrudeToObjectFlipDirection }
            : {}),
          ...(finalDirection === 'two-sides' ? { extentType2: extrudeExtentType2 } : {}),
          taperAngle: extrudeTaperAngle,
          ...(finalDirection === 'two-sides' ? { taperAngle2: extrudeTaperAngle2 } : {}),
          profileIndex,
          ...(profileIndices ? { profileIndices } : {}),
        },
        visible: true,
        suppressed: false,
        timestamp: Date.now(),
        // OCC-backed solids store their registered display mesh; thin/surface
        // features use their explicit stored preview/display mesh.
        mesh: needsStoredMesh ? featureMesh : undefined,
        bodyKind: resolvedBodyKind,
        // EX-16: when targeting a base feature, exclude from parametric timeline
        ...(extrudeTargetBaseFeature ? { suppressTimeline: true } : {}),
        // EX-17: stable synthetic face IDs â€" start, end, and one side-face per sketch edge
        startFaceIds: [`${featureId}_start_0`],
        endFaceIds: [`${featureId}_end_0`],
        sideFaceIds: sketchForOp.entities.map((_: Sketch['entities'][number], ei: number) => `${featureId}_side_${ei}`),
      };

      // Dispose the mesh if we're not storing it to avoid GPU leak
      if (!needsStoredMesh && featureMesh) {
        featureMesh.geometry.dispose();
      }

      // EX-13: edit mode inserts at the old feature's index; create mode appends
      if (editingExtrude && editingIndex >= 0) {
        nextFeatures.splice(editingIndex, 0, feature);
      } else {
        nextFeatures.push(feature);
      }
      // Suppress the OCC target that was consumed by this boolean operation
      if (occBoolTargetIdToSuppress) {
        const tidx = nextFeatures.findIndex((f) => f.id === occBoolTargetIdToSuppress);
        if (tidx >= 0) {
          nextFeatures[tidx] = { ...nextFeatures[tidx], suppressed: true, visible: false };
        }
      }
      createdCount += 1;
      if (!firstCreatedSketchName) firstCreatedSketchName = sourceSketch.name;
    }

    if (createdCount === 0) return;

    const actionVerb = editingExtrude ? 'Updated' : (finalOperation === 'cut' ? 'Cut' : 'Extruded');
    set({
      features: nextFeatures,
      activeTool: 'select',
      editingFeatureId: null,
      ...EXTRUDE_DEFAULTS,
      statusMessage:
        createdCount > 1
          ? `${actionVerb} ${createdCount} profiles${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`
          : `${actionVerb} ${firstCreatedSketchName ?? 'profile'}${extrudeExtentType === 'all' ? ' (All)' : ` by ${absDistance}${units}`}`,
    });
    // EX-13 edit mode: dispose the old stored mesh after the new feature is committed.
    // Defer so any in-flight render using the old geometry can finish first.
    if (editingOldMesh) {
      setTimeout(() => {
        editingOldMesh.geometry.dispose();
        detachTessellationFromMesh(editingOldMesh);
        if (editingOldBrepBodyId) globalBRepBodyRegistry.delete(editingOldBrepBodyId);
        // OCC extrude allocates a fresh MeshPhysicalMaterial per commit -- dispose
        // it here since it has no userData.shared flag (not a shared singleton).
        const oldMat = editingOldMesh.material;
        const mats = Array.isArray(oldMat) ? oldMat : (oldMat ? [oldMat] : []);
        for (const m of mats) { if (m && !m.userData?.shared) m.dispose(); }
      }, 0);
    }
  },

  };
}

import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import { EXTRUDE_DEFAULTS } from '../../defaults';
import { boxesHaveJoinableContact } from '../../../../utils/geometry/boundsContact';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOcc, getOccSync } from '../../../../engine/occ/loader';
import { disposeBRepBody, type BRepBody } from '../../../../engine/occ/brepBody';
import { occExtrudeShapeWithInstance, occExtrudeWithInstance } from '../../../../engine/occ/ops/extrude';
import {
  performOccBooleanWithInstance,
  type OccBooleanOperation,
} from '../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { attachTessellationToMesh, detachTessellationFromMesh } from '../../../../engine/occ/picking';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import { OCC_BOOLEAN_VERSION } from '../../../../utils/occConstants';
import {
  buildExtrudeMeshForProfileSelectionAsync,
  collapseSameSketchProfilesForNewBody,
  computeToObjectDistance,
  createOffsetOccFrame,
  makeSketchProfileFromShape,
  makeCutOvertravelFrame,
  performRobustBooleanWithRawTool,
  resolveBooleanExtrudeDirection,
  resolveOccExtrudeDistance,
  resolveSelectedExtrudeProfiles,
  tryBuildExactCircleToolShape,
} from './extrudeCommitHelpers';

// Scratch Box3 instances reused across the existingSolids overlap loop in commitExtrude.
// Safe because the loop is synchronous; no await can interleave while these are live.
const _proposedBox = new THREE.Box3();
const _efBox = new THREE.Box3();

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
      let effectiveOperation = finalOperation;
      const isMultiProfileSubsequent =
        finalOperation === 'new-body' &&
        profilesToCommit.length > 1 &&
        createdCount > 0 &&
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled;
      if (isMultiProfileSubsequent) effectiveOperation = 'join';
      // â"€â"€ Fusion 360 parity: auto-promote 'join' â†' 'new-body' when detached â"€â"€
      // If the user chose 'join' but the proposed geometry doesn't intersect any
      // existing solid body (e.g. an offset extrusion floating in space), Fusion
      // 360 automatically creates a new body. We replicate that here by doing a
      // cheap bounding-box check against all currently committed solid extrudes.
      if (effectiveOperation === 'join' && resolvedBodyKind === 'solid' && !extrudeThinEnabled) {
        const existingSolids = nextFeatures.filter(
          (f) => f.type === 'extrude' && !f.suppressed && f.visible &&
                 f.bodyKind !== 'surface' &&
                 (f.params.operation === 'new-body' || f.params.operation === 'join'),
        );
        if (existingSolids.length === 0) {
          // No solid bodies yet â€" this must be the first one
          effectiveOperation = 'new-body';
        } else {
          // Build the proposed geometry once. We need its bbox for cheap
          // pre-filtering AND the baked world-space geometry for the exact
          // overlap test that determines real intersection.
          const proposedMesh = await buildExtrudeMeshForProfileSelectionAsync(
            selected, absDistance, finalDirection, extrudeTaperAngle,
            extrudeStartType === 'offset' ? extrudeStartOffset : 0,
            absDistance2,
            extrudeTaperAngle2,
          );
          if (proposedMesh) {
            proposedMesh.updateMatrixWorld(true);
            _proposedBox.setFromObject(proposedMesh);
            proposedMesh.geometry.dispose();

            let intersectsAny = false;
            for (const ef of existingSolids) {
              const efSk = sketches.find((s) => s.id === ef.sketchId);
              if (!efSk) continue;
              const efPI = ef.params.profileIndex as number | undefined;
              const efSketchForOp = efPI !== undefined
                ? GeometryEngine.createProfileSketch(efSk, efPI)
                : efSk;
              if (!efSketchForOp) continue;
              const efMesh = GeometryEngine.buildExtrudeFeatureMesh(
                efSketchForOp,
                (ef.params.distance as number) ?? 10,
                ((ef.params.direction as string) || 'positive') as 'positive' | 'negative' | 'symmetric' | 'two-sides',
                (ef.params.taperAngle as number) ?? 0,
                (ef.params.startType as string) === 'offset' ? ((ef.params.startOffset as number) ?? 0) : 0,
                (ef.params.distance2 as number) ?? (ef.params.distance as number) ?? 10,
              );
              if (!efMesh) continue;
              efMesh.updateMatrixWorld(true);
              _efBox.setFromObject(efMesh);
              efMesh.geometry.dispose();
              // hasJoinableContact rejects edge/corner-only contact; face or volume
              // contact is sufficient to auto-promote from new-body to join/cut.
              if (boxesHaveJoinableContact(_proposedBox, _efBox)) {
                intersectsAny = true;
                break;
              }
            }
            if (!intersectsAny) effectiveOperation = 'new-body';
          }
        }
      }

      const featureId = crypto.randomUUID();
      let occFailureMessage: string | null = null;

      // OCC new-body path: builds an exact BRep solid with optional taper angle.
      // Handles distance, symmetric, two-sides, to-object, and through-all (all) extents.
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        (effectiveOperation === 'new-body' || effectiveOperation === 'new-component') &&
        profileIndices === undefined
      ) {
        const occ = getOccSync() ?? await getOcc();
        if (occ) {
          try {
            const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
            const firstShape = profileIndex !== undefined ? shapes[profileIndex] : shapes[0];
            if (firstShape) {
              const sketchProfile = makeSketchProfileFromShape(firstShape);
              const frame = createOffsetOccFrame(sketchForOp, extrudeStartType, extrudeStartOffset);
              const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
                finalDirection,
                absDistance,
                absDistance2,
                extrudeSymmetricFullLength,
              );

              const occBody = occExtrudeWithInstance(occ.oc, sketchProfile, occDistance, frame, {
                id: featureId,
                sourceFeatureId: featureId,
                symmetric: occSymmetric,
                twoSideDist: occTwoSideDist,
                taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
                taperAngle2: Math.abs(extrudeTaperAngle2 ?? 0) > 0.001 ? extrudeTaperAngle2 : undefined,
              });

              featureMesh = createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId);
              needsStoredMesh = true;
            }
          } catch (err) {
            occFailureMessage = errorMessage(err, 'unknown');
            console.error(`[commitExtrude] OCC path failed (${occFailureMessage})`, err);
          }
        }
      }

      // OCC new-body path for multi-profile extrude (profileIndices defined).
      // Extrudes each selected profile independently then fuses all into one body.
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        (effectiveOperation === 'new-body' || effectiveOperation === 'new-component') &&
        profileIndices !== undefined &&
        profileIndices.length > 0
      ) {
        const occ = getOccSync() ?? await getOcc();
        if (occ) {
          try {
            const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
            const frame = createOffsetOccFrame(sketchForOp, extrudeStartType, extrudeStartOffset);
            const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
              finalDirection,
              absDistance,
              absDistance2,
              extrudeSymmetricFullLength,
            );
            let accBody: BRepBody | null = null;
            for (const idx of profileIndices) {
              const shape = shapes[idx];
              if (!shape) continue;
              const sp = makeSketchProfileFromShape(shape);
              const profileBody = occExtrudeWithInstance(occ.oc, sp, occDistance, frame, {
                id: `${featureId}_p${idx}`,
                sourceFeatureId: featureId,
                symmetric: occSymmetric,
                twoSideDist: occTwoSideDist,
                taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
                taperAngle2: Math.abs(extrudeTaperAngle2 ?? 0) > 0.001 ? extrudeTaperAngle2 : undefined,
              });
              if (!profileBody) continue;
              if (!accBody) {
                accBody = profileBody;
              } else {
                const fused = performOccBooleanWithInstance(occ.oc, 'union', accBody, profileBody, {
                  id: featureId,
                  sourceFeatureId: featureId,
                });
                disposeBRepBody(accBody);
                disposeBRepBody(profileBody);
                accBody = fused;
              }
            }
            if (accBody) {
              featureMesh = createRegisteredOccMesh(occ.oc, accBody, BODY_MATERIAL, featureId);
              needsStoredMesh = true;
            }
          } catch (err) {
            occFailureMessage = errorMessage(err, 'unknown');
            console.warn(`[commitExtrude] OCC multi-profile path failed (${occFailureMessage})`);
          }
        }
      }

      // OCC join/cut/intersect path: boolean the extrude tool body against an existing OCC body.
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        (effectiveOperation === 'join' || effectiveOperation === 'cut' || effectiveOperation === 'intersect') &&
        profileIndices === undefined &&
        extrudeExtentType !== 'all'
      ) {
        const occ = getOccSync();
        if (occ) {
          let occTarget: Feature | undefined;
          for (let fi = nextFeatures.length - 1; fi >= 0; fi--) {
            const f = nextFeatures[fi];
            if (!f.visible || f.suppressed || f.bodyKind === 'surface') continue;
            if (!(f.mesh instanceof THREE.Mesh)) continue;
            if (!(f.mesh as THREE.Mesh).userData['brepBodyId']) continue;
            occTarget = f;
            break;
          }
          if (occTarget) {
            try {
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
              const firstShape = profileIndex !== undefined ? shapes[profileIndex] : shapes[0];
              if (firstShape) {
                const sketchProfile = makeSketchProfileFromShape(firstShape);
                const frame = createOffsetOccFrame(sketchForOp, extrudeStartType, extrudeStartOffset);
                const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
                  finalDirection,
                  absDistance,
                  absDistance2,
                  extrudeSymmetricFullLength,
                );
                const toolBody = occExtrudeWithInstance(occ.oc, sketchProfile, occDistance, frame, {
                  id: `${featureId}_tool`,
                  sourceFeatureId: featureId,
                  symmetric: occSymmetric,
                  twoSideDist: occTwoSideDist,
                  taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
                  taperAngle2: Math.abs(extrudeTaperAngle2 ?? 0) > 0.001 ? extrudeTaperAngle2 : undefined,
                });
                try {
                  const targetMesh = occTarget.mesh as THREE.Mesh;
                  const targetOccBodyId = targetMesh.userData['brepBodyId'] as string;
                  const targetOccBody = globalBRepBodyRegistry.get(targetOccBodyId);
                  if (targetOccBody) {
                    const occOp: OccBooleanOperation = effectiveOperation === 'join' ? 'union' : effectiveOperation === 'cut' ? 'subtract' : 'intersect';
                    const boolResult = performOccBooleanWithInstance(occ.oc, occOp, targetOccBody, toolBody, {
                      id: featureId,
                      sourceFeatureId: featureId,
                    });
                    if (boolResult) {
                      globalBRepBodyRegistry.add(boolResult);
                      const tess = tessellateWithInstance(occ.oc, boolResult);
                      const geo = tessellationToGeometry(tess);
                      const mat = new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide });
                      const occMesh = new THREE.Mesh(geo, mat);
                      attachTessellationToMesh(occMesh, tess, boolResult.id);
                      occMesh.userData['pickable'] = true;
                      occMesh.userData['featureId'] = featureId;
                      occMesh.castShadow = true;
                      occMesh.receiveShadow = true;
                      featureMesh = occMesh;
                      needsStoredMesh = true;
                      const tgtIdx = nextFeatures.findIndex((f) => f.id === occTarget!.id);
                      if (tgtIdx >= 0) {
                        nextFeatures[tgtIdx] = { ...nextFeatures[tgtIdx], suppressed: true, visible: false };
                      }
                    }
                  }
                } finally {
                  disposeBRepBody(toolBody);
                }
              }
            } catch (err) {
              occFailureMessage = errorMessage(err, 'unknown');
              console.warn(`[commitExtrude] OCC ${effectiveOperation} path failed (${occFailureMessage})`);
            }
          }
        }
      }

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
      const extraBodyIds: string[] = [];
      if (effectiveOperation === 'new-body') {
        const componentStore = useComponentStore.getState();
        componentId = sourceSketch.componentId ?? componentStore.activeComponentId ?? componentStore.rootComponentId;
        const bodyCount = Object.keys(componentStore.bodies).length + 1;
        const bodyLabel = `${resolvedBodyKind === 'surface' ? 'Surface' : 'Body'} ${bodyCount}`;
        const createdBodyId = componentStore.addBody(componentId, bodyLabel);
        if (createdBodyId) {
          bodyId = createdBodyId;
          componentStore.addFeatureToBody(createdBodyId, featureId);
          // Store the generated display mesh on the body when this path owns one.
          if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
        // Detect disconnected pieces for stored thin/surface mesh paths.
        if (!needsStoredMesh && createdBodyId) {
          try {
            const probe = await buildExtrudeMeshForProfileSelectionAsync(
              selected,
              absDistance,
              finalDirection,
              extrudeTaperAngle,
              extrudeStartType === 'offset' ? extrudeStartOffset : 0,
              absDistance2,
              extrudeTaperAngle2,
            );
            if (probe) {
              const parts = GeometryEngine.splitByConnectedComponents(probe.geometry);
              if (parts.length > 1) {
                for (let i = 1; i < parts.length; i++) {
                  const extraId = componentStore.addBody(
                    componentId,
                    `${bodyLabel}.${i + 1}`,
                  );
                  if (extraId) {
                    componentStore.addFeatureToBody(extraId, featureId);
                    extraBodyIds.push(extraId);
                  }
                }
              }
              // splitByConnectedComponents returns [probe.geometry] (same ref)
              // when singly connected, and N fresh allocations (NOT including
              // probe.geometry) when actually split. Dispose the parts list --
              // which covers probe.geometry in the singly-connected case -- and
              // then dispose probe.geometry explicitly when it was NOT in parts,
              // otherwise it leaks on every multi-body extrude.
              for (const g of parts) g.dispose();
              if (parts.length !== 1 || parts[0] !== probe.geometry) {
                probe.geometry.dispose();
              }
            }
          } catch { /* ignore -- fall back to single body */ }
        }
      } else if (effectiveOperation === 'new-component') {
        const componentStore = useComponentStore.getState();
        const parentId = componentStore.activeComponentId ?? componentStore.rootComponentId;
        const newCompId = componentStore.addComponent(parentId, 'Component ' + (Object.keys(componentStore.components ?? {}).length + 1));
        const createdBodyId = componentStore.addBody(newCompId, 'Body 1');
        componentId = newCompId;
        bodyId = createdBodyId;
        if (createdBodyId) {
          componentStore.addFeatureToBody(createdBodyId, featureId);
          if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
      }

      // OCC join/cut path: boolean the extrude against the most recent OCC-backed solid target.
      // Only runs for solid, non-thin, distance-extent extrudes in join/cut/intersect mode where
      // the target already carries a brepBodyId (was produced by the OCC pipeline).
      let occBoolTargetIdToSuppress: string | undefined;
      let occBooleanResolved = false;
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        !needsStoredMesh &&
        (effectiveOperation === 'join' || effectiveOperation === 'cut' || effectiveOperation === 'intersect') &&
        profileIndices === undefined
      ) {
        const occ = getOccSync() ?? await getOcc();
        // Re-read after await: abort if a concurrent undo changed the feature list.
        if (get().features !== features) {
          console.warn('[commitExtrude] features changed during OCC boolean init - aborting stale commit');
          return;
        }
        if (occ) {
          // Reverse-scan nextFeatures for the most recent OCC-backed solid
          let occTargetFeature: Feature | undefined;
          for (let i = nextFeatures.length - 1; i >= 0; i--) {
            const f = nextFeatures[i];
            if (
              !f.suppressed && f.visible &&
              f.bodyKind !== 'surface' &&
              f.mesh instanceof THREE.Mesh &&
              (f.mesh as THREE.Mesh).userData['brepBodyId']
            ) {
              occTargetFeature = f;
              break;
            }
          }
          const targetBrepBodyId = occTargetFeature?.mesh instanceof THREE.Mesh
            ? ((occTargetFeature.mesh as THREE.Mesh).userData['brepBodyId'] as string | undefined)
            : undefined;
          const targetBRepBody = targetBrepBodyId
            ? globalBRepBodyRegistry.get(targetBrepBodyId)
            : undefined;

          if (targetBRepBody && occTargetFeature) {
            try {
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
              const firstShape = profileIndex !== undefined ? shapes[profileIndex] : shapes[0];
              if (firstShape && firstShape.holes.length === 0) {
                const sketchProfile = makeSketchProfileFromShape(firstShape, false);
                const frame = createOffsetOccFrame(sketchForOp, 'profile', 0);

                const booleanDirection = await resolveBooleanExtrudeDirection(
                  selected,
                  occTargetFeature.mesh as THREE.Mesh,
                  finalDirection,
                  absDistance,
                  extrudeTaperAngle,
                  extrudeStartType === 'offset' ? extrudeStartOffset : 0,
                  absDistance2,
                  extrudeTaperAngle2,
                );

                const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
                  booleanDirection,
                  absDistance,
                  absDistance2,
                  extrudeSymmetricFullLength,
                );

                const boolOp: OccBooleanOperation =
                  effectiveOperation === 'cut' ? 'subtract' :
                  effectiveOperation === 'intersect' ? 'intersect' : 'union';
                const toolExtrude = boolOp === 'subtract' && !occSymmetric && occTwoSideDist === undefined
                  ? makeCutOvertravelFrame(frame, occDistance)
                  : { frame, distance: occDistance };

                let resultBody = null;
                try {
                  const exactCircleToolShape = boolOp === 'subtract' && !occSymmetric && occTwoSideDist === undefined && Math.abs(extrudeTaperAngle) <= 0.001
                    ? tryBuildExactCircleToolShape(occ.oc, sourceSketch, sketchProfile, toolExtrude.distance, toolExtrude.frame)
                    : null;
                  const toolShape = exactCircleToolShape ?? occExtrudeShapeWithInstance(occ.oc, sketchProfile, toolExtrude.distance, toolExtrude.frame, {
                    symmetric: occSymmetric,
                    twoSideDist: occTwoSideDist,
                    taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
                  });

                  resultBody = (() => {
                    try {
                      return performRobustBooleanWithRawTool(
                        occ.oc, boolOp, targetBRepBody, toolShape.shape,
                        { id: featureId, sourceFeatureId: featureId },
                      );
                    } finally {
                      toolShape.dispose();
                    }
                  })();
                } catch (err) {
                  console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')})`);
                }

                if (resultBody) {
                  featureMesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, featureId);
                  needsStoredMesh = true;
                  committedDirection = booleanDirection;
                  occBoolTargetIdToSuppress = occTargetFeature.id;
                  // Inherit the target's body slot so the result stays in the same Bodies entry
                  bodyId = occTargetFeature.bodyId;
                  componentId = occTargetFeature.componentId;
                  if (bodyId && featureMesh) {
                    const cs = useComponentStore.getState();
                    cs.addFeatureToBody(bodyId, featureId);
                    cs.setBodyMesh(bodyId, featureMesh);
                  }
                  occBooleanResolved = true;
                }
              }
            } catch (err) {
              console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')})`);
            }
          }
        }
      }

      // OCC join/cut path for multi-profile extrude (profileIndices defined).
      // Fuses all profile extrudes into one tool body then booleans against target.
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        !needsStoredMesh &&
        (effectiveOperation === 'join' || effectiveOperation === 'cut' || effectiveOperation === 'intersect') &&
        profileIndices !== undefined &&
        profileIndices.length > 0 &&
        extrudeExtentType !== 'all'
      ) {
        const occ = getOccSync() ?? await getOcc();
        if (get().features !== features) {
          console.warn('[commitExtrude] features changed during multi-profile OCC boolean init - aborting stale commit');
          return;
        }
        if (occ) {
          let occTargetFeature: Feature | undefined;
          for (let i = nextFeatures.length - 1; i >= 0; i--) {
            const f = nextFeatures[i];
            if (!f.suppressed && f.visible && f.bodyKind !== 'surface' && f.mesh instanceof THREE.Mesh && (f.mesh as THREE.Mesh).userData['brepBodyId']) {
              occTargetFeature = f;
              break;
            }
          }
          const targetBrepBodyId = occTargetFeature?.mesh instanceof THREE.Mesh ? ((occTargetFeature.mesh as THREE.Mesh).userData['brepBodyId'] as string | undefined) : undefined;
          const targetBRepBody = targetBrepBodyId ? globalBRepBodyRegistry.get(targetBrepBodyId) : undefined;
          if (targetBRepBody && occTargetFeature) {
            try {
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
              const frame = createOffsetOccFrame(sketchForOp, 'profile', 0);
              const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
                finalDirection,
                absDistance,
                absDistance2,
                extrudeSymmetricFullLength,
              );
              let toolBody: BRepBody | null = null;
              for (const idx of profileIndices) {
                const shape = shapes[idx];
                if (!shape) continue;
                const sp = makeSketchProfileFromShape(shape);
                const profileBody = occExtrudeWithInstance(occ.oc, sp, occDistance, frame, {
                  id: `${featureId}_tool_p${idx}`,
                  sourceFeatureId: featureId,
                  symmetric: occSymmetric,
                  twoSideDist: occTwoSideDist,
                  taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
                  taperAngle2: Math.abs(extrudeTaperAngle2 ?? 0) > 0.001 ? extrudeTaperAngle2 : undefined,
                });
                if (!profileBody) continue;
                if (!toolBody) {
                  toolBody = profileBody;
                } else {
                  const fused = performOccBooleanWithInstance(occ.oc, 'union', toolBody, profileBody, {
                    id: `${featureId}_tool`,
                    sourceFeatureId: featureId,
                  });
                  disposeBRepBody(toolBody);
                  disposeBRepBody(profileBody);
                  toolBody = fused;
                }
              }
              if (toolBody) {
                try {
                  const boolOp: OccBooleanOperation = effectiveOperation === 'cut' ? 'subtract' : effectiveOperation === 'intersect' ? 'intersect' : 'union';
                  const resultBody = performOccBooleanWithInstance(occ.oc, boolOp, targetBRepBody, toolBody, {
                    id: featureId,
                    sourceFeatureId: featureId,
                  });
                  if (resultBody) {
                    featureMesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, featureId);
                    needsStoredMesh = true;
                    occBoolTargetIdToSuppress = occTargetFeature.id;
                    bodyId = occTargetFeature.bodyId;
                    componentId = occTargetFeature.componentId;
                    if (bodyId && featureMesh) {
                      const cs = useComponentStore.getState();
                      cs.addFeatureToBody(bodyId, featureId);
                      cs.setBodyMesh(bodyId, featureMesh);
                    }
                    occBooleanResolved = true;
                  }
                } finally {
                  disposeBRepBody(toolBody);
                }
              }
            } catch (err) {
              occFailureMessage = errorMessage(err, 'unknown');
              console.warn(`[commitExtrude] OCC multi-profile boolean path failed (${occFailureMessage})`);
            }
          }
        }
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

import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import { EXTRUDE_DEFAULTS } from '../../defaults';
import { boxesHaveJoinableContact, boxesShareFaceContact } from '../../../../utils/geometry/boundsContact';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';

type SelectedExtrudeProfile = {
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  selectionId: string;
  profileIndex: number | undefined;
  profileIndices?: number[];
};

function buildExtrudeMeshForProfileSelection(
  selected: SelectedExtrudeProfile,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngle: number,
  startOffset: number,
  distance2: number,
  taperAngle2: number,
): THREE.Mesh | null {
  const profileIndices = selected.profileIndices;
  if (!profileIndices || profileIndices.length <= 1) {
    return GeometryEngine.buildExtrudeFeatureMesh(
      selected.sketchForOp,
      distance,
      direction,
      taperAngle,
      startOffset,
      distance2,
      taperAngle2,
    );
  }

  let merged: THREE.BufferGeometry | null = null;
  for (const profileIndex of profileIndices) {
    const profileSketch = GeometryEngine.createProfileSketch(selected.sourceSketch, profileIndex);
    if (!profileSketch) continue;
    const mesh = GeometryEngine.buildExtrudeFeatureMesh(
      profileSketch,
      distance,
      direction,
      taperAngle,
      startOffset,
      distance2,
      taperAngle2,
    );
    if (!mesh) continue;
    const geom = GeometryEngine.bakeMeshWorldGeometry(mesh);
    mesh.geometry.dispose();
    if (!merged) {
      merged = geom;
    } else {
      const next = GeometryEngine.csgUnion(merged, geom);
      merged.dispose();
      geom.dispose();
      merged = next;
    }
  }

  return merged ? new THREE.Mesh(merged) : null;
}

export function createExtrudeCommitActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
  commitExtrude: () => {
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
      editingFeatureId,
      sketches, features, units,
    } = get();
    // EX-13: edit mode â€” identify the feature being replaced
    const editingExtrude = editingFeatureId
      ? features.find((f) => f.id === editingFeatureId && f.type === 'extrude') ?? null
      : null;
    const editingIndex = editingExtrude ? features.findIndex((f) => f.id === editingFeatureId) : -1;
    const selectedSketchIds =
      extrudeSelectedSketchIds.length > 0
        ? extrudeSelectedSketchIds
        : (extrudeSelectedSketchId ? [extrudeSelectedSketchId] : []);
    if (selectedSketchIds.length === 0) {
      set({ statusMessage: 'No profile selected' });
      return;
    }
    const selectedProfiles = selectedSketchIds
      .map((id) => {
        const [sketchId, rawIndex] = id.split('::');
        const sourceSketch = sketches.find((s) => s.id === sketchId);
        if (!sourceSketch) return null;
        if (rawIndex === undefined) {
          return { sourceSketch, sketchForOp: sourceSketch, selectionId: id, profileIndex: undefined as number | undefined };
        }
        const parsed = Number(rawIndex);
        if (!Number.isFinite(parsed)) return null;
        const profileSketch = GeometryEngine.createProfileSketch(sourceSketch, parsed);
        if (!profileSketch) return null;
        return { sourceSketch, sketchForOp: profileSketch, selectionId: id, profileIndex: parsed };
      })
      .filter(Boolean) as SelectedExtrudeProfile[];

    if (selectedProfiles.length === 0) {
      set({ statusMessage: 'Selected profile not found' });
      return;
    }
    const firstProfile = selectedProfiles[0];
    const requestedBooleanOperation = extrudeOperation === 'cut' || extrudeOperation === 'intersect';
    const shouldCollapseSameSketchProfiles =
      !requestedBooleanOperation &&
      selectedProfiles.length > 1 &&
      selectedProfiles.every(
        (profile) =>
          profile.sourceSketch.id === firstProfile.sourceSketch.id &&
          profile.profileIndex !== undefined,
      );
    const profilesToCommit: SelectedExtrudeProfile[] = shouldCollapseSameSketchProfiles
      ? [{
          sourceSketch: firstProfile.sourceSketch,
          sketchForOp: firstProfile.sourceSketch,
          selectionId: firstProfile.sourceSketch.id,
          profileIndex: undefined,
          profileIndices: selectedProfiles.map((profile) => profile.profileIndex as number),
        }]
      : selectedProfiles;
    if (extrudeExtentType === 'distance' && Math.abs(extrudeDistance) < 0.01) {
      set({ statusMessage: 'Distance must be non-zero' });
      return;
    }
    get().pushUndo();
    // EX-3: for to-object extent, derive distance from profile plane â†’ face centroid projection
    const { extrudeToEntityFaceCentroid, extrudeToObjectFlipDirection } = get();
    const computeToObjectDistance = (profileSketch: Sketch): number => {
      if (!extrudeToEntityFaceCentroid) return Math.abs(extrudeDistance);
      const target = new THREE.Vector3(...extrudeToEntityFaceCentroid);
      const origin = profileSketch.planeOrigin.clone();
      // EX-4: if From-Entity start is set, use that face centroid as origin
      if (extrudeStartFaceCentroid) origin.set(...extrudeStartFaceCentroid);
      const n = extrudeToEntityFaceNormal
        ? new THREE.Vector3(...extrudeToEntityFaceNormal)
        : profileSketch.planeNormal.clone().normalize();
      // EX-12: directionHint â€” flip the sign so the extrude goes the other way
      const raw = target.clone().sub(origin).dot(n);
      const d = extrudeToObjectFlipDirection ? -raw : raw;
      return Math.max(0.01, Math.abs(d));
    };
    // Use absolute distance â€” negative just means the user dragged in reverse
    const absDistance = extrudeExtentType === 'all'
      ? 10000
      : extrudeExtentType === 'to-object'
        ? computeToObjectDistance(
            (profilesToCommit[0]?.sketchForOp) ?? (profilesToCommit[0]?.sourceSketch)
          )
        : Math.abs(extrudeDistance);
    // EX-10: side 2 uses its own independent extent type
    const absDistance2 = extrudeExtentType2 === 'all'
      ? 10000
      : extrudeExtentType2 === 'to-object'
        ? computeToObjectDistance(
            (profilesToCommit[0]?.sketchForOp) ?? (profilesToCommit[0]?.sourceSketch)
          )
        : Math.abs(extrudeDistance2);
    // Direction follows the sign of the distance (two-sides never flips)
    const finalDirection = extrudeDirection === 'two-sides' ? 'two-sides' : (extrudeDistance < 0 ? 'negative' : extrudeDirection);
    // Operation is set explicitly by the user in the panel (new-body, join, cut)
    const finalOperation = extrudeOperation;

    // EX-13: in edit mode, remove the old feature first (new one inserts at same position)
    const nextFeatures = editingExtrude
      ? features.filter((f) => f.id !== editingFeatureId)
      : [...features];
    let createdCount = 0;
    let firstCreatedSketchName: string | null = null;

    for (const selected of profilesToCommit) {
      const { sourceSketch, sketchForOp, profileIndex, profileIndices } = selected;
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

      // Generate mesh: surface â†’ thin â†’ standard solid (taper is rebuilt by
      // ExtrudedBodies via buildExtrudeFeatureMesh, so no stored mesh).
      let featureMesh: THREE.Mesh | undefined;
      if (resolvedBodyKind === 'surface') {
        featureMesh = GeometryEngine.extrudeSketchSurface(sketchForOp, absDistance) ?? undefined;
      } else if (extrudeThinEnabled) {
        const thinSide: 'inside' | 'outside' | 'center' = extrudeThinSide === 'side1' ? 'inside' : extrudeThinSide === 'side2' ? 'outside' : 'center';
        featureMesh = GeometryEngine.extrudeThinSketch(sketchForOp, absDistance, extrudeThinThickness, thinSide) ?? undefined;
      } else {
        featureMesh = GeometryEngine.extrudeSketch(sketchForOp, absDistance) ?? undefined;
      }

      // Apply start offset to thin/surface stored meshes (standard solid +
      // taper get the offset applied during the CSG rebuild instead).
      if (featureMesh && extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
        const n = GeometryEngine.getSketchExtrudeNormal(sketchForOp);
        featureMesh.position.addScaledVector(n, extrudeStartOffset);
      }

      // Standard solid extrudes (with or without taper/offset) are rebuilt by
      // the ExtrudedBodies CSG pipeline so they participate in join/cut. Only
      // thin and surface extrudes need a stored mesh.
      const needsStoredMesh = resolvedBodyKind === 'surface' || extrudeThinEnabled;

      // Multi-profile selection: when the user picks several profiles and
      // chooses 'new-body', profiles that overlap each other should fuse into
      // a single body (Fusion 360 parity â€” they are "connected" after extrude).
      // We do this by routing the 2nd-onwards profile through the 'join' path,
      // which already has the bbox-overlap check + auto-promote-to-new-body
      // fallback for disconnected profiles. The 1st profile stays 'new-body'
      // so disconnected selections still start with a fresh body.
      let effectiveOperation = finalOperation;
      const isMultiProfileSubsequent =
        finalOperation === 'new-body' &&
        profilesToCommit.length > 1 &&
        createdCount > 0 &&
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled;
      if (isMultiProfileSubsequent) effectiveOperation = 'join';
      // â”€â”€ Fusion 360 parity: auto-promote 'join' â†’ 'new-body' when detached â”€â”€
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
          // No solid bodies yet â€” this must be the first one
          effectiveOperation = 'new-body';
        } else {
          // Build the proposed geometry once. We need its bbox for cheap
          // pre-filtering AND the baked world-space geometry for the exact
          // CSG-intersection test that determines real overlap.
          const proposedMesh = buildExtrudeMeshForProfileSelection(
            selected, absDistance, finalDirection, extrudeTaperAngle,
            extrudeStartType === 'offset' ? extrudeStartOffset : 0,
            absDistance2,
            extrudeTaperAngle2,
          );
          if (proposedMesh) {
            proposedMesh.updateMatrixWorld(true);
            const proposedBox = new THREE.Box3().setFromObject(proposedMesh);
            const proposedGeomW = GeometryEngine.bakeMeshWorldGeometry(proposedMesh);
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
              const efBox = new THREE.Box3().setFromObject(efMesh);
              // Cheap bbox pre-filter. If the boxes don't even touch or share
              // a real face/volume contact, we can skip the expensive CSG work.
              // Face-touching solids are valid join candidates; edge/corner
              // contact stays detached.
              const hasJoinableContact = boxesHaveJoinableContact(proposedBox, efBox);
              const hasSharedFaceContact = boxesShareFaceContact(proposedBox, efBox);
              if (!hasJoinableContact) {
                efMesh.geometry.dispose();
                continue;
              }
              // Accurate test: do the two solids truly overlap in volume,
              // or do they just touch? CSG intersection produces an empty
              // (or near-empty) geometry for coplanar face contact.
              // Threshold 6 = 2 triangles; anything less is degenerate
              // coplanar contact. Because hasJoinableContact already rejected
              // edge/corner-only contact, a degenerate result here still means
              // face contact and should remain a join.
              const efGeomW = GeometryEngine.bakeMeshWorldGeometry(efMesh);
              efMesh.geometry.dispose();
              try {
                const inter = GeometryEngine.csgIntersect(proposedGeomW, efGeomW);
                const triVerts = (inter.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
                inter.dispose();
                if (triVerts > 6 || hasSharedFaceContact) {
                  intersectsAny = true;
                  efGeomW.dispose();
                  break;
                }
              } catch { /* malformed geometry â€” fall back to bbox result */
                intersectsAny = true;
                efGeomW.dispose();
                break;
              }
              efGeomW.dispose();
            }
            proposedGeomW.dispose();
            if (!intersectsAny) effectiveOperation = 'new-body';
          }
        }
      }

      const featureId = crypto.randomUUID();
      const featureName = editingExtrude && profilesToCommit.length === 1
        ? editingExtrude.name
        : `${extrudeThinEnabled ? 'Thin ' : ''}${effectiveOperation === 'cut' ? 'Cut' : 'Extrude'} ${nextFeatures.filter(f => f.type === 'extrude').length + createdCount + 1}`;
      let componentId: string | undefined;
      let bodyId: string | undefined;
      // When an extrude produces geometrically disconnected pieces (two
      // disjoint profiles, or CSG cut that split a body) each piece should
      // show up as its own entry in the Bodies browser. Build a preview
      // mesh here solely to count connected components, and register one
      // body per piece. The extra ids are stored on the feature so the
      // renderer can match a split geometry â†’ bodies by index.
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
          // Only store mesh on body for thin/taper/surface â€” standard solid
          // extrudes are rendered by the CSG pipeline in ExtrudedBodies.
          if (needsStoredMesh && featureMesh) componentStore.setBodyMesh(createdBodyId, featureMesh);
        }
        // Detect disconnected pieces â€” only for standard (CSG-pipeline) solids.
        if (!needsStoredMesh && createdBodyId) {
          try {
            const probe = buildExtrudeMeshForProfileSelection(
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
              // probe.geometry) when actually split. Dispose the parts list —
              // which covers probe.geometry in the singly-connected case — and
              // then dispose probe.geometry explicitly when it was NOT in parts,
              // otherwise it leaks on every multi-body extrude.
              for (const g of parts) g.dispose();
              if (parts.length !== 1 || parts[0] !== probe.geometry) {
                probe.geometry.dispose();
              }
            }
          } catch { /* ignore â€” fall back to single body */ }
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
          direction: finalDirection,
          operation: effectiveOperation,
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
        // Standard solid extrudes (no thin, no taper) must NOT store a mesh â€”
        // ExtrudedBodies.tsx CSG pipeline rebuilds them from sketch + params
        // via buildExtrudeFeatureMesh and applies csgSubtract/csgUnion.
        // Only thin/taper/surface extrudes store a mesh (can't be rebuilt
        // from just sketch + distance + direction).
        mesh: needsStoredMesh ? featureMesh : undefined,
        bodyKind: resolvedBodyKind,
        // EX-16: when targeting a base feature, exclude from parametric timeline
        ...(extrudeTargetBaseFeature ? { suppressTimeline: true } : {}),
        // EX-17: stable synthetic face IDs â€” start, end, and one side-face per sketch edge
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
      createdCount += 1;
      if (!firstCreatedSketchName) firstCreatedSketchName = sourceSketch.name;
    }

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
  },

  };
}

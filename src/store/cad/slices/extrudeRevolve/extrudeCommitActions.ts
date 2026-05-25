import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Feature, Sketch, SketchEntity } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useComponentStore } from '../../../componentStore';
import { EXTRUDE_DEFAULTS } from '../../defaults';
import { boxesHaveJoinableContact } from '../../../../utils/geometry/boundsContact';
import type { CADSliceContext } from '../../sliceContext';
import type { CADState } from '../../state';
import { getOcc, getOccSync } from '../../../../engine/occ/loader';
import { disposeBRepBody } from '../../../../engine/occ/brepBody';
import { createOccPlaneFrameFromSketch } from '../../../../engine/occ/plane';
import { occExtrudeFaceShapeWithInstance, occExtrudeShapeWithInstance, occExtrudeWithInstance } from '../../../../engine/occ/ops/extrude';
import {
  performOccBooleanWithRawTool,
  performOccBooleanWithInstance,
  type OccBooleanOptions,
  type OccBooleanOperation,
} from '../../../../engine/occ/ops/booleanCore';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { attachTessellationToMesh, detachTessellationFromMesh } from '../../../../engine/occ/picking';
import { migrateLegacyExtrudeFeatures } from '../../../../engine/occ/legacyMigration';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { mergeCutTopology } from '../../../../components/viewport/scene/extrudedBodies/cutTopology';
import { errorMessage } from '../../../../utils/errorHandling';
import { csgSubtract } from '../../../../engine/geometryEngine/core/solid/csg';
import { extrudeProfileTopology } from '../../../../engine/geometryEngine/core/solid/profileTopology';
import type { BodyTopology } from '../../../../engine/geometryEngine/core/solid/edgeTypes';
import { OCC_PROFILE_POINT_COUNT, OCC_BOOLEAN_VERSION } from '../../../../utils/occConstants';
import { sketchEntitiesToWire, wiresToFace } from '../../../../engine/occ/sketchEntityToWire';

// Scratch Box3 instances reused across the existingSolids overlap loop in commitExtrude.
// Safe because the loop is synchronous; no await can interleave while these are live.
const _proposedBox = new THREE.Box3();
const _efBox = new THREE.Box3();
const CSG_BOOLEAN_FALLBACK_VERSION = 1;
const OCC_CUT_OVERTRAVEL_MM = 0.05;

type SelectedExtrudeProfile = {
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  selectionId: string;
  profileIndex: number | undefined;
  profileIndices?: number[];
};

async function buildExtrudeMeshForProfileSelectionAsync(
  selected: SelectedExtrudeProfile,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngle: number,
  startOffset: number,
  distance2: number,
  taperAngle2: number,
): Promise<THREE.Mesh | null> {
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
      const next = mergeGeometries([merged, geom]);
      merged.dispose();
      geom.dispose();
      merged = next;
    }
  }

  return merged ? new THREE.Mesh(merged) : null;
}

function boxesOverlapVolume(a: THREE.Box3, b: THREE.Box3): boolean {
  const x = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const y = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const z = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  const scale = Math.max(
    a.min.distanceTo(a.max),
    b.min.distanceTo(b.max),
    1,
  );
  const tolerance = scale * 1e-5;
  return x > tolerance && y > tolerance && z > tolerance;
}

async function buildExtrudeProbeBox(
  selected: SelectedExtrudeProfile,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngle: number,
  startOffset: number,
  distance2: number,
  taperAngle2: number,
): Promise<THREE.Box3 | null> {
  const mesh = await buildExtrudeMeshForProfileSelectionAsync(
    selected,
    distance,
    direction,
    taperAngle,
    startOffset,
    distance2,
    taperAngle2,
  );
  if (!mesh) return null;
  try {
    mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh);
  } finally {
    mesh.geometry.dispose();
  }
}

async function resolveBooleanExtrudeDirection(
  selected: SelectedExtrudeProfile,
  targetMesh: THREE.Mesh,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  distance: number,
  taperAngle: number,
  startOffset: number,
  distance2: number,
  taperAngle2: number,
): Promise<'positive' | 'negative' | 'symmetric' | 'two-sides'> {
  if (direction !== 'positive' && direction !== 'negative') return direction;

  targetMesh.updateMatrixWorld(true);
  const targetBox = new THREE.Box3().setFromObject(targetMesh);
  const forwardBox = await buildExtrudeProbeBox(
    selected,
    distance,
    direction,
    taperAngle,
    startOffset,
    distance2,
    taperAngle2,
  );
  if (forwardBox && boxesOverlapVolume(forwardBox, targetBox)) return direction;

  const reverseDirection = direction === 'positive' ? 'negative' : 'positive';
  const reverseBox = await buildExtrudeProbeBox(
    selected,
    distance,
    reverseDirection,
    taperAngle,
    startOffset,
    distance2,
    taperAngle2,
  );
  return reverseBox && boxesOverlapVolume(reverseBox, targetBox)
    ? reverseDirection
    : direction;
}

function makeCutOvertravelFrame(
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
  signedDistance: number,
): { frame: ReturnType<typeof createOccPlaneFrameFromSketch>; distance: number } {
  const sign = signedDistance < 0 ? -1 : 1;
  const overtravel = Math.max(OCC_CUT_OVERTRAVEL_MM, Math.abs(signedDistance) * 1e-4);
  return {
    frame: {
      ...frame,
      origin: frame.origin.clone().addScaledVector(frame.normal, -sign * overtravel),
    },
    distance: signedDistance + sign * overtravel * 2,
  };
}

function polygonArea2D(points: readonly THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function projectSketchPointToFrame(
  point: { x: number; y: number; z: number },
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): THREE.Vector2 {
  const d = new THREE.Vector3(point.x, point.y, point.z).sub(frame.origin);
  return new THREE.Vector2(d.dot(frame.uDir), d.dot(frame.vDir));
}

function profileCentroid(profile: SketchProfile): THREE.Vector2 {
  const center = new THREE.Vector2();
  for (const point of profile.outer) center.add(point);
  return profile.outer.length > 0 ? center.multiplyScalar(1 / profile.outer.length) : center;
}

function findMatchingCircularProfileEntity(
  sourceSketch: Sketch,
  profile: SketchProfile,
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): SketchEntity | null {
  if (profile.holes.length > 0 || profile.outer.length < 8) return null;
  const profileArea = polygonArea2D(profile.outer);
  const center = profileCentroid(profile);
  let best: { entity: SketchEntity; score: number } | null = null;

  for (const entity of sourceSketch.entities) {
    if (entity.type !== 'circle' || typeof entity.radius !== 'number' || entity.radius <= 0 || !entity.points[0]) continue;
    const expectedArea = Math.PI * entity.radius * entity.radius;
    const areaError = Math.abs(profileArea - expectedArea) / Math.max(expectedArea, 1e-6);
    if (areaError > 0.08) continue;
    const circleCenter = projectSketchPointToFrame(entity.points[0], frame);
    const centerError = circleCenter.distanceTo(center) / Math.max(entity.radius, 1);
    if (centerError > 0.08) continue;
    const score = areaError + centerError;
    if (!best || score < best.score) best = { entity, score };
  }

  return best?.entity ?? null;
}

function tryBuildExactCircleToolShape(
  oc: unknown,
  sourceSketch: Sketch,
  profile: SketchProfile,
  distance: number,
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
) {
  const circle = findMatchingCircularProfileEntity(sourceSketch, profile, frame);
  if (!circle) return null;
  const wire = sketchEntitiesToWire(oc as never, [circle], frame);
  if (!wire) return null;
  const face = wiresToFace(oc as never, wire, []);
  if (!face) {
    (wire as { delete?: () => void }).delete?.();
    return null;
  }
  return occExtrudeFaceShapeWithInstance(oc as never, face, distance, frame, {}, [wire]);
}

function performRobustBooleanWithRawTool(
  oc: unknown,
  operation: OccBooleanOperation,
  targetBody: Parameters<typeof performOccBooleanWithInstance>[2],
  toolShape: unknown,
  options: OccBooleanOptions,
): ReturnType<typeof performOccBooleanWithInstance> {
  return performOccBooleanWithRawTool(oc, operation, targetBody, toolShape, {
    ...options,
    fuzzyValue: options.fuzzyValue ?? 1e-5,
  });
}

async function buildCsgCutFallbackMesh(
  selected: SelectedExtrudeProfile,
  targetMesh: THREE.Mesh,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngle: number,
  startOffset: number,
  distance2: number,
  taperAngle2: number,
  featureId: string,
): Promise<THREE.Mesh | null> {
  let fallbackDistance = distance;
  let fallbackDistance2 = distance2;
  let fallbackStartOffset = startOffset;
  const overtravel = Math.max(OCC_CUT_OVERTRAVEL_MM, Math.abs(distance) * 1e-4);
  if (direction === 'positive') {
    fallbackStartOffset -= overtravel;
    fallbackDistance += overtravel * 2;
  } else if (direction === 'negative') {
    fallbackStartOffset += overtravel;
    fallbackDistance += overtravel * 2;
  } else if (direction === 'symmetric') {
    fallbackDistance += overtravel * 2;
  } else {
    fallbackDistance += overtravel;
    fallbackDistance2 += Math.max(OCC_CUT_OVERTRAVEL_MM, Math.abs(distance2) * 1e-4);
  }

  const toolMesh = await buildExtrudeMeshForProfileSelectionAsync(
    selected,
    fallbackDistance,
    direction,
    taperAngle,
    fallbackStartOffset,
    fallbackDistance2,
    taperAngle2,
  );
  if (!toolMesh) return null;

  const targetGeom = GeometryEngine.bakeMeshWorldGeometry(targetMesh);
  const toolGeom = GeometryEngine.bakeMeshWorldGeometry(toolMesh);
  const toolTopo = extrudeProfileTopology(
    selected.sketchForOp,
    fallbackDistance,
    direction,
    fallbackStartOffset,
    fallbackDistance2,
    taperAngle2,
  );
  const targetTopo = targetMesh.geometry.userData?.topology as BodyTopology | undefined;
  const bodyBox = new THREE.Box3().setFromBufferAttribute(
    targetGeom.attributes.position as THREE.BufferAttribute,
  );
  const toolBox = new THREE.Box3().setFromBufferAttribute(
    toolGeom.attributes.position as THREE.BufferAttribute,
  );
  toolBox.expandByScalar(Math.max(toolBox.min.distanceTo(toolBox.max) * 5e-3, 1e-4));
  toolMesh.geometry.dispose();
  try {
    const resultGeom = csgSubtract(targetGeom, toolGeom);
    const mergedTopology = mergeCutTopology(
      targetTopo,
      resultGeom.userData?.topology as BodyTopology | undefined,
      toolBox,
      bodyBox,
      toolTopo.edges.length > 0 ? toolTopo : undefined,
    );
    if (mergedTopology) resultGeom.userData.topology = mergedTopology;
    const mesh = new THREE.Mesh(resultGeom, BODY_MATERIAL);
    mesh.userData.pickable = true;
    mesh.userData.featureId = featureId;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  } finally {
    targetGeom.dispose();
    toolGeom.dispose();
  }
}

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
    // EX-13: edit mode â€” identify the feature being replaced
    const editingExtrude = editingFeatureId
      ? features.find((f) => f.id === editingFeatureId && f.type === 'extrude') ?? null
      : null;
    const editingIndex = editingExtrude ? features.findIndex((f) => f.id === editingFeatureId) : -1;
    // Capture old mesh + brepBodyId before the filter discards the feature.
    // Must be done here — after filter the reference is gone from nextFeatures.
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
    pushUndo();
    // EX-3: for to-object extent, derive distance from profile plane → face centroid projection
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
    // Re-read from get() at each await boundary — concurrent undo/removeFeature can change
    // the live features array while we're in an async OCC op.
    const nextFeatures = editingExtrude
      ? features.filter((f) => f.id !== editingFeatureId)
      : [...features];
    if (!editingExtrude && (finalOperation === 'join' || finalOperation === 'cut' || finalOperation === 'intersect')) {
      const migrationOcc = getOccSync() ?? await getOcc();
      // Re-read after await: abort if a concurrent undo changed the feature list.
      const liveAfterMigrationInit = get().features;
      if (liveAfterMigrationInit !== features) {
        console.warn('[commitExtrude] features changed during OCC init – aborting stale commit');
        return;
      }
      const migrated = migrateLegacyExtrudeFeatures(nextFeatures, sketches, migrationOcc);
      if (migrated.some((feature, index) => feature !== nextFeatures[index])) {
        nextFeatures.splice(0, nextFeatures.length, ...migrated);
      }
    }
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

      // Generate mesh: surface â†’ thin â†’ standard solid (taper is rebuilt by
      // ExtrudedBodies via buildExtrudeFeatureMesh, so no stored mesh).
      let featureMesh: THREE.Mesh | undefined;
      if (resolvedBodyKind === 'surface') {
        featureMesh = GeometryEngine.extrudeSketchSurface(sketchForOp, absDistance) ?? undefined;
      } else if (extrudeThinEnabled) {
        const thinSide: 'inside' | 'outside' | 'center' = extrudeThinSide === 'side1' ? 'inside' : extrudeThinSide === 'side2' ? 'outside' : 'center';
        featureMesh = GeometryEngine.extrudeThinSketch(sketchForOp, absDistance, extrudeThinThickness, thinSide) ?? undefined;
      }
      // Solid non-thin: featureMesh left undefined here; OCC path below will provide it.
      // CSG fallback (no feature.mesh) lets ExtrudedBodies rebuild from sketch params.

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

      // OCC new-body path: builds an exact BRep solid with optional taper angle.
      // Handles distance, symmetric, two-sides, to-object, and through-all (all) extents.
      // Falls back silently to CSG pipeline on any failure.
      if (
        resolvedBodyKind === 'solid' &&
        !extrudeThinEnabled &&
        effectiveOperation === 'new-body' &&
        profileIndices === undefined
      ) {
        const occ = getOccSync() ?? await getOcc();
        if (occ) {
          try {
            const shapes = GeometryEngine.sketchToProfileShapesFlat(sketchForOp);
            const firstShape = shapes[0];
            if (firstShape) {
              const sketchProfile: SketchProfile = {
                outer: firstShape.getPoints(OCC_PROFILE_POINT_COUNT),
                holes: firstShape.holes
                  .map((h) => h.getPoints(OCC_PROFILE_POINT_COUNT))
                  .filter((pts) => pts.length >= 3),
              };
              const frame = createOccPlaneFrameFromSketch(sketchForOp);
              if (extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
                frame.origin.addScaledVector(frame.normal, extrudeStartOffset);
              }

              // Compute OCC extrude distance: symmetric needs full height (2 * per-side).
              let occDistance: number;
              let occSymmetric = false;
              let occTwoSideDist: number | undefined;
              if (finalDirection === 'negative') {
                occDistance = -absDistance;
              } else if (finalDirection === 'symmetric') {
                occDistance = extrudeSymmetricFullLength ? absDistance : absDistance * 2;
                occSymmetric = true;
              } else if (finalDirection === 'two-sides') {
                occDistance = absDistance;
                occTwoSideDist = absDistance2;
              } else {
                occDistance = absDistance;
              }

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
            console.warn(`[commitExtrude] OCC path failed (${errorMessage(err, 'unknown')}); using CSG fallback`);
          }
        }
      }

      // OCC join/cut/intersect path: boolean the extrude tool body against an existing OCC body.
      // Falls back silently to the CSG pipeline (ExtrudedBodies) when no OCC target is found.
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
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sketchForOp);
              const firstShape = shapes[0];
              if (firstShape) {
                const sketchProfile: SketchProfile = {
                  outer: firstShape.getPoints(96),
                  holes: firstShape.holes
                    .map((h) => h.getPoints(96))
                    .filter((pts) => pts.length >= 3),
                };
                const frame = createOccPlaneFrameFromSketch(sketchForOp);
                if (extrudeStartType === 'offset' && Math.abs(extrudeStartOffset) > 0.001) {
                  frame.origin.addScaledVector(frame.normal, extrudeStartOffset);
                }
                let occDistance: number;
                let occSymmetric = false;
                let occTwoSideDist: number | undefined;
                if (finalDirection === 'negative') {
                  occDistance = -absDistance;
                } else if (finalDirection === 'symmetric') {
                  occDistance = extrudeSymmetricFullLength ? absDistance : absDistance * 2;
                  occSymmetric = true;
                } else if (finalDirection === 'two-sides') {
                  occDistance = absDistance;
                  occTwoSideDist = absDistance2;
                } else {
                  occDistance = absDistance;
                }
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
              console.warn(`[commitExtrude] OCC ${effectiveOperation} path failed (${errorMessage(err, 'unknown')}); using CSG fallback`);
            }
          }
        }
      }

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
              // probe.geometry) when actually split. Dispose the parts list —
              // which covers probe.geometry in the singly-connected case — and
              // then dispose probe.geometry explicitly when it was NOT in parts,
              // otherwise it leaks on every multi-body extrude.
              for (const g of parts) g.dispose();
              if (parts.length !== 1 || parts[0] !== probe.geometry) {
                probe.geometry.dispose();
              }
            }
          } catch { /* ignore — fall back to single body */ }
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
      // Falls through to the CSG pipeline on no OCC target or any OCC failure.
      let occBoolTargetIdToSuppress: string | undefined;
      let occBooleanResolved = false;
      let csgBooleanFallbackResolved = false;
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
          console.warn('[commitExtrude] features changed during OCC boolean init – aborting stale commit');
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
              const shapes = GeometryEngine.sketchToProfileShapesFlat(sketchForOp);
              const firstShape = shapes[0];
              if (firstShape) {
                const sketchProfile: SketchProfile = {
                  outer: firstShape.getPoints(OCC_PROFILE_POINT_COUNT),
                  holes: firstShape.holes
                    .map((h) => h.getPoints(OCC_PROFILE_POINT_COUNT))
                    .filter((pts) => pts.length >= 3),
                };
                const frame = createOccPlaneFrameFromSketch(sketchForOp);

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

                let occDistance: number;
                let occSymmetric = false;
                let occTwoSideDist: number | undefined;
                if (booleanDirection === 'negative') {
                  occDistance = -absDistance;
                } else if (booleanDirection === 'symmetric') {
                  occDistance = extrudeSymmetricFullLength ? absDistance : absDistance * 2;
                  occSymmetric = true;
                } else if (booleanDirection === 'two-sides') {
                  occDistance = absDistance;
                  occTwoSideDist = absDistance2;
                } else {
                  occDistance = absDistance;
                }

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
                  console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')}); using CSG fallback`);
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
                } else if (boolOp === 'subtract') {
                  const fallbackMesh = await buildCsgCutFallbackMesh(
                    selected,
                    occTargetFeature.mesh as THREE.Mesh,
                    absDistance,
                    booleanDirection,
                    extrudeTaperAngle,
                    extrudeStartType === 'offset' ? extrudeStartOffset : 0,
                    absDistance2,
                    extrudeTaperAngle2,
                    featureId,
                  );
                  if (fallbackMesh) {
                    featureMesh = fallbackMesh;
                    needsStoredMesh = true;
                    committedDirection = booleanDirection;
                    occBoolTargetIdToSuppress = occTargetFeature.id;
                    bodyId = occTargetFeature.bodyId;
                    componentId = occTargetFeature.componentId;
                    if (bodyId) {
                      const cs = useComponentStore.getState();
                      cs.addFeatureToBody(bodyId, featureId);
                      cs.setBodyMesh(bodyId, featureMesh);
                    }
                    occBooleanResolved = true;
                    csgBooleanFallbackResolved = true;
                  }
                }
              }
            } catch (err) {
              console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')}); using CSG fallback`);
            }
          }
        }
      }

      if (requestedBoolean && !occBooleanResolved) {
        needsStoredMesh = false;
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
          ...(occBooleanResolved && !csgBooleanFallbackResolved ? { occBooleanVersion: OCC_BOOLEAN_VERSION } : {}),
          ...(csgBooleanFallbackResolved ? { csgBooleanFallbackVersion: CSG_BOOLEAN_FALLBACK_VERSION } : {}),
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
        // OCC extrude allocates a fresh MeshPhysicalMaterial per commit — dispose
        // it here since it has no userData.shared flag (not a shared singleton).
        const oldMat = editingOldMesh.material;
        const mats = Array.isArray(oldMat) ? oldMat : (oldMat ? [oldMat] : []);
        for (const m of mats) { if (m && !m.userData?.shared) m.dispose(); }
      }, 0);
    }
  },

  };
}

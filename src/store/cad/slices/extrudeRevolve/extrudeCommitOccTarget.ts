import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { disposeBRepBody, type BRepBody } from '../../../../engine/occ/brepBody';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { getOcc } from '../../../../engine/occ/loader';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { BREP_BODY_ID_KEY, BREP_TESS_KEY } from '../../../../engine/occ/picking';
import { occExtrudeWithInstance } from '../../../../engine/occ/ops/extrude';
import { performOccBooleanWithInstance } from '../../../../engine/occ/ops/booleanCore';
import { occFilletEdgeSetsWithInstance, type OccFilletEdgeSet } from '../../../../engine/occ/ops/fillet';
import { occChamferWithInstance } from '../../../../engine/occ/ops/chamfer';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { ensureFeatureOccBody } from '../../persistence';
import { parseOccEdgeSelection, storedEdgeIds } from '../../../../utils/occEdgeUtils';
import { buildOccNewBodyExtrudeMesh } from './extrudeCommitOccNewBody';
import {
  createOffsetOccFrame,
  makeSketchProfileFromShape,
  resolveOccExtrudeDistance,
  type ExtrudeDirection,
} from './extrudeCommitHelpers';
import type { ExtrudeOperation } from './extrudeCommitOperation';

export function resolveLatestOccSolidTarget(features: Feature[]): {
  feature?: Feature;
  body?: BRepBody;
  bodyId?: string;
} {
  for (let index = features.length - 1; index >= 0; index--) {
    const feature = features[index];
    if (
      !feature.suppressed &&
      feature.visible &&
      feature.bodyKind !== 'surface' &&
      feature.mesh instanceof THREE.Mesh
    ) {
      const bodyId = feature.mesh.userData['brepBodyId'] as string | undefined;
      const body = bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined;
      if (body) return { feature, body, bodyId };
    }
  }

  return {};
}

function copyOccMetadata(target: THREE.Mesh, source: THREE.Mesh, featureId: string): string | undefined {
  const bodyId = source.userData[BREP_BODY_ID_KEY] as string | undefined;
  if (!bodyId || !globalBRepBodyRegistry.get(bodyId)) return undefined;
  target.userData[BREP_BODY_ID_KEY] = bodyId;
  target.userData[BREP_TESS_KEY] = source.userData[BREP_TESS_KEY];
  target.userData.pickable = true;
  target.userData.featureId = featureId;
  return bodyId;
}

function extrudeOperation(feature: Feature): ExtrudeOperation {
  return (feature.params.operation as ExtrudeOperation | undefined) ?? 'new-body';
}

function operationToBoolean(operation: ExtrudeOperation): 'union' | 'subtract' | 'intersect' {
  if (operation === 'cut') return 'subtract';
  if (operation === 'intersect') return 'intersect';
  return 'union';
}

function replayParams(feature: Feature): {
  profileIndices?: number[];
  profileIndex?: number;
  direction: ExtrudeDirection;
  distance: number;
  distance2: number;
  startType: string;
  startOffset: number;
  taperAngle: number;
  taperAngle2?: number;
} {
  return {
    profileIndices: Array.isArray(feature.params.profileIndices)
      ? feature.params.profileIndices.filter((index): index is number => typeof index === 'number')
      : undefined,
    profileIndex: typeof feature.params.profileIndex === 'number' ? feature.params.profileIndex : undefined,
    direction: (feature.params.direction as ExtrudeDirection | undefined) ?? 'positive',
    distance: Math.abs(Number(feature.params.distance) || 0),
    distance2: Math.abs(Number(feature.params.distance2) || 0),
    startType: (feature.params.startType as string | undefined) ?? 'profile',
    startOffset: Number(feature.params.startOffset) || 0,
    taperAngle: Number(feature.params.taperAngle) || 0,
    taperAngle2: typeof feature.params.taperAngle2 === 'number' ? feature.params.taperAngle2 : undefined,
  };
}

async function replayOccNewBodyTarget(feature: Feature, sketches: Sketch[]): Promise<boolean> {
  if (feature.type !== 'extrude') return false;
  const operation = extrudeOperation(feature);
  if (operation !== 'new-body' && operation !== 'new-component') return false;

  const sourceSketch = sketches.find((sketch) => sketch.id === feature.sketchId);
  if (!sourceSketch) return false;
  const mesh = feature.mesh;
  if (!(mesh instanceof THREE.Mesh)) return false;

  const { profileIndices, profileIndex, direction, distance, distance2, startType, startOffset, taperAngle, taperAngle2 } = replayParams(feature);
  if (distance < 0.01) return false;

  const result = await buildOccNewBodyExtrudeMesh({
    resolvedBodyKind: feature.bodyKind === 'surface' ? 'surface' : 'solid',
    extrudeThinEnabled: feature.params.thin === true,
    effectiveOperation: operation,
    profileIndices,
    sourceSketch,
    sketchForOp: sourceSketch,
    profileIndex,
    featureId: feature.id,
    finalDirection: direction,
    absDistance: distance,
    absDistance2: distance2,
    extrudeSymmetricFullLength: false,
    extrudeStartType: startType,
    extrudeStartOffset: startOffset,
    extrudeTaperAngle: taperAngle,
    extrudeTaperAngle2: taperAngle2,
  });

  const replayMesh = result.featureMesh;
  if (!(replayMesh instanceof THREE.Mesh)) return false;
  if (!copyOccMetadata(mesh, replayMesh, feature.id)) {
    replayMesh.geometry.dispose();
    return false;
  }

  replayMesh.geometry.dispose();
  return true;
}

function findBooleanReplayTarget(feature: Feature, features: Feature[]): Feature | undefined {
  const explicitId =
    (feature.params.targetFeatureId as string | undefined) ??
    (feature.params.sourceFeatureId as string | undefined) ??
    feature.parentFeatureId;
  if (explicitId) return features.find((candidate) => candidate.id === explicitId);

  const featureIndex = features.findIndex((candidate) => candidate.id === feature.id);
  for (let index = featureIndex - 1; index >= 0; index--) {
    const candidate = features[index];
    if (
      candidate.type === 'extrude' &&
      candidate.bodyKind !== 'surface' &&
      candidate.bodyId &&
      candidate.bodyId === feature.bodyId
    ) {
      return candidate;
    }
  }

  for (let index = featureIndex - 1; index >= 0; index--) {
    const candidate = features[index];
    if (
      candidate.type !== 'sketch' &&
      candidate.bodyKind !== 'surface' &&
      candidate.mesh instanceof THREE.Mesh
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Replay a fillet or chamfer feature on top of its already-restored base body.
 * Called when STEP data is missing and the feature cannot be restored via the
 * standard paths — the base body must already be in globalBRepBodyRegistry
 * (restored via ensureOccBodyForFeature on the source feature first).
 *
 * Edge IDs are expected to be stable after replay because OCC's topology
 * builder is deterministic for identical geometry (same sketch → same IDs).
 */
async function replayEdgeModFeature(
  feature: Feature,
  features: Feature[],
  sketches: Sketch[],
  visited: Set<string>,
): Promise<boolean> {
  const mesh = feature.mesh;
  if (!(mesh instanceof THREE.Mesh)) return false;

  // Locate the source (base) feature that this edge mod was applied to.
  const sourceFeatureId =
    (feature.params.sourceFeatureId as string | undefined) ??
    (feature.params.parentFeatureId as string | undefined) ??
    feature.parentFeatureId;

  let sourceFeature = sourceFeatureId
    ? features.find((f) => f.id === sourceFeatureId)
    : undefined;

  // Fallback: walk backwards and pick the nearest non-sketch visible solid.
  if (!sourceFeature) {
    const idx = features.findIndex((f) => f.id === feature.id);
    for (let i = idx - 1; i >= 0; i--) {
      const f = features[i];
      if (f.type !== 'sketch' && !f.suppressed && f.visible && f.mesh instanceof THREE.Mesh) {
        sourceFeature = f;
        break;
      }
    }
  }
  if (!sourceFeature) return false;

  // Restore the source body recursively (extrude replay handles this).
  if (!(await ensureOccBodyForFeature(sourceFeature, features, sketches, visited))) return false;

  const sourceMesh = sourceFeature.mesh;
  if (!(sourceMesh instanceof THREE.Mesh)) return false;
  const sourceBodyId = sourceMesh.userData[BREP_BODY_ID_KEY] as string | undefined;
  const sourceBody = sourceBodyId ? globalBRepBodyRegistry.get(sourceBodyId) : undefined;
  if (!sourceBody) return false;

  // Parse stored edge IDs — these are "occ:<bodyId>:<edgeId>" strings.
  const rawEdgeIds = storedEdgeIds(feature.params.edgeIds);
  if (rawEdgeIds.length === 0) return false;
  const selection = parseOccEdgeSelection(rawEdgeIds);
  if (!selection) return false;

  // Filter to edges that actually exist on the restored source body.
  // After replay, OCC re-uses the same IDs for deterministic geometry.
  const numericEdgeIds = selection.edgeIds.filter((id) => sourceBody.edgeIds.has(id));
  if (numericEdgeIds.length === 0) {
    console.warn(
      `[replayEdgeModFeature] ${feature.type} ${feature.id}: ` +
      `none of the stored edge IDs (${selection.edgeIds.join(',')}) ` +
      `exist on replayed source body (${sourceBody.edgeIds.size} edges available)`,
    );
    return false;
  }

  const occ = await getOcc();
  let resultBody: BRepBody | null = null;

  if (feature.type === 'fillet') {
    const radius = (feature.params.radius as number | undefined) ?? 2;
    const edgeSets: OccFilletEdgeSet[] = [{ edgeIds: numericEdgeIds, radius }];
    resultBody = occFilletEdgeSetsWithInstance(occ.oc, sourceBody, edgeSets, {
      sourceFeatureId: feature.id,
    });
  } else if (feature.type === 'chamfer') {
    const distance = (feature.params.distance as number | undefined) ?? 1;
    const distance2 = feature.params.distance2 as number | undefined;
    const angle = feature.params.angle as number | undefined;
    resultBody = occChamferWithInstance(occ.oc, sourceBody, numericEdgeIds, distance, {
      distance2: angle === undefined && distance2 !== undefined && distance2 !== distance ? distance2 : undefined,
      angle,
      sourceFeatureId: feature.id,
    });
  }

  if (!resultBody) {
    console.warn(`[replayEdgeModFeature] ${feature.type} ${feature.id}: OCC operation returned null`);
    return false;
  }

  const replayMesh = createRegisteredOccMesh(
    occ.oc,
    resultBody,
    mesh.material as THREE.Material,
    feature.id,
  );
  const ok = !!copyOccMetadata(mesh, replayMesh, feature.id);
  replayMesh.geometry.dispose();
  return ok;
}

export async function ensureOccBodyForFeature(
  feature: Feature,
  features: Feature[],
  sketches: Sketch[],
  visited = new Set<string>(),
): Promise<boolean> {
  if (visited.has(feature.id)) return false;
  visited.add(feature.id);

  const mesh = feature.mesh;
  if (!(mesh instanceof THREE.Mesh)) return false;

  const liveBodyId = mesh.userData[BREP_BODY_ID_KEY] as string | undefined;
  const liveBody = liveBodyId ? globalBRepBodyRegistry.get(liveBodyId) : undefined;

  if (liveBody) return true;

  // Prefer replay over STEP restore for new-body extrudes: the replay path uses
  // the latest analytical arc/circle builders, producing clean OCC geometry that
  // fillets correctly. STEP restore would reproduce old polygon-approximated arcs.
  if (await replayOccNewBodyTarget(feature, sketches)) return true;
  if (await ensureFeatureOccBody(feature)) return true;

  // Fillet / chamfer replay: re-apply the edge modification on top of the
  // restored base body.  Handles the case where STEP data was not serialized
  // (e.g. shapeToStep failure on first session) — the source extrude can be
  // replayed from sketch data, and the fillet re-applied on top.
  if (feature.type === 'fillet' || feature.type === 'chamfer') {
    return replayEdgeModFeature(feature, features, sketches, visited);
  }

  if (feature.type !== 'extrude') return false;
  const operation = extrudeOperation(feature);
  if (operation !== 'join' && operation !== 'cut' && operation !== 'intersect') return false;

  const targetFeature = findBooleanReplayTarget(feature, features);
  if (!targetFeature || !(await ensureOccBodyForFeature(targetFeature, features, sketches, visited))) return false;

  const targetMesh = targetFeature.mesh;
  if (!(targetMesh instanceof THREE.Mesh)) return false;
  const targetBodyId = targetMesh.userData[BREP_BODY_ID_KEY] as string | undefined;
  const targetBody = targetBodyId ? globalBRepBodyRegistry.get(targetBodyId) : undefined;
  if (!targetBody) return false;

  const sourceSketch = sketches.find((sketch) => sketch.id === feature.sketchId);
  if (!sourceSketch) return false;

  const { profileIndices, profileIndex, direction, distance, distance2, startType, startOffset, taperAngle, taperAngle2 } = replayParams(feature);
  if (distance < 0.01) return false;

  const occ = await getOcc();
  const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
  const frame = createOffsetOccFrame(sourceSketch, startType, startOffset);
  const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(direction, distance, distance2, false);
  let toolBody: BRepBody | null = null;

  try {
    const indices = profileIndices ?? [profileIndex ?? 0];
    for (const index of indices) {
      const shape = shapes[index];
      if (!shape) continue;
      const profile = makeSketchProfileFromShape(shape);
      const profileBody = occExtrudeWithInstance(occ.oc, profile, occDistance, frame, {
        id: `${feature.id}_replay_tool_${index}`,
        sourceFeatureId: feature.id,
        symmetric: occSymmetric,
        twoSideDist: occTwoSideDist,
        taperAngle: Math.abs(taperAngle) > 0.001 ? taperAngle : undefined,
        taperAngle2: Math.abs(taperAngle2 ?? 0) > 0.001 ? taperAngle2 : undefined,
      });
      if (!profileBody) continue;
      if (!toolBody) {
        toolBody = profileBody;
      } else {
        const fused = performOccBooleanWithInstance(occ.oc, 'union', toolBody, profileBody, {
          id: `${feature.id}_replay_tool`,
          sourceFeatureId: feature.id,
        });
        disposeBRepBody(toolBody);
        disposeBRepBody(profileBody);
        toolBody = fused;
      }
    }

    if (!toolBody) return false;
    const resultBody = performOccBooleanWithInstance(occ.oc, operationToBoolean(operation), targetBody, toolBody, {
      id: feature.id,
      sourceFeatureId: feature.id,
    });
    if (!resultBody) return false;

    const replayMesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, feature.id);
    const ok = !!copyOccMetadata(mesh, replayMesh, feature.id);
    replayMesh.geometry.dispose();
    return ok;
  } finally {
    if (toolBody) disposeBRepBody(toolBody);
  }
}

export async function ensureLatestOccSolidTarget(features: Feature[], sketches: Sketch[] = []): Promise<{
  feature?: Feature;
  body?: BRepBody;
  bodyId?: string;
}> {
  const live = resolveLatestOccSolidTarget(features);
  if (live.body) return live;

  for (let index = features.length - 1; index >= 0; index--) {
    const feature = features[index];
    if (
      feature.suppressed ||
      !feature.visible ||
      feature.bodyKind === 'surface' ||
      !(feature.mesh instanceof THREE.Mesh)
    ) {
      continue;
    }

    if (!(await ensureOccBodyForFeature(feature, features, sketches))) continue;
    const bodyId = feature.mesh.userData['brepBodyId'] as string | undefined;
    const body = bodyId ? globalBRepBodyRegistry.get(bodyId) : undefined;
    if (body) return { feature, body, bodyId };
  }

  return {};
}

import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { getOcc, getOccSync } from '../../../../engine/occ/loader';
import { disposeBRepBody, type BRepBody } from '../../../../engine/occ/brepBody';
import { occExtrudeShapeWithInstance, occExtrudeWithInstance } from '../../../../engine/occ/ops/extrude';
import { performOccBooleanWithInstance, type OccBooleanOperation } from '../../../../engine/occ/ops/booleanCore';
import { globalBRepBodyRegistry } from '../../../../engine/occ/globalRegistry';
import { tessellateWithInstance, tessellationToGeometry } from '../../../../engine/occ/tessellate';
import { attachTessellationToMesh, detachTessellationFromMesh } from '../../../../engine/occ/picking';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import {
  createOffsetOccFrame,
  makeSketchProfileFromShape,
  makeCutOvertravelFrame,
  performRobustBooleanWithRawTool,
  resolveBooleanExtrudeDirection,
  resolveOccExtrudeDistance,
  type ExtrudeDirection,
  type SelectedExtrudeProfile,
  tryBuildExactCircleToolShape,
} from './extrudeCommitHelpers';
import type { ExtrudeOperation } from './extrudeCommitOperation';
import { ensureLatestOccSolidTarget, resolveLatestOccSolidTarget } from './extrudeCommitOccTarget';

export function operationToOccBoolean(operation: ExtrudeOperation): OccBooleanOperation {
  if (operation === 'cut') return 'subtract';
  if (operation === 'intersect') return 'intersect';
  return 'union';
}

function isRenderableOccMesh(mesh: THREE.Mesh): boolean {
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count < 3) return false;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return false;
  const size = box.getSize(new THREE.Vector3());
  return Number.isFinite(size.x) && Number.isFinite(size.y) && Number.isFinite(size.z) && size.lengthSq() > 1e-8;
}

function disposeRejectedOccMesh(mesh: THREE.Mesh): void {
  const bodyId = mesh.userData['brepBodyId'] as string | undefined;
  if (bodyId) globalBRepBodyRegistry.delete(bodyId);
  mesh.geometry.dispose();
  detachTessellationFromMesh(mesh);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (material && material !== BODY_MATERIAL && !material.userData?.['shared']) material.dispose();
  }
}

export function buildImmediateOccBooleanExtrudeMesh({
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
}: {
  resolvedBodyKind: 'solid' | 'surface';
  extrudeThinEnabled: boolean;
  effectiveOperation: ExtrudeOperation;
  profileIndices: number[] | undefined;
  extrudeExtentType: string;
  nextFeatures: Feature[];
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  profileIndex: number | undefined;
  featureId: string;
  finalDirection: ExtrudeDirection;
  absDistance: number;
  absDistance2: number;
  extrudeSymmetricFullLength: boolean;
  extrudeStartType: string;
  extrudeStartOffset: number;
  extrudeTaperAngle: number;
  extrudeTaperAngle2: number | undefined;
}): { featureMesh?: THREE.Mesh; needsStoredMesh: boolean; suppressedTargetId?: string; occFailureMessage: string | null } {
  const shouldRun =
    resolvedBodyKind === 'solid' &&
    !extrudeThinEnabled &&
    effectiveOperation === 'join' &&
    profileIndices === undefined &&
    extrudeExtentType !== 'all';
  if (!shouldRun) return { needsStoredMesh: false, occFailureMessage: null };

  const occ = getOccSync();
  if (!occ) return { needsStoredMesh: false, occFailureMessage: null };

  const { feature: occTarget, body: targetOccBody } = resolveLatestOccSolidTarget(nextFeatures);
  if (!occTarget || !targetOccBody) return { needsStoredMesh: false, occFailureMessage: null };

  try {
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
    const firstShape = profileIndex !== undefined ? shapes[profileIndex] : shapes[0];
    if (!firstShape) return { needsStoredMesh: false, occFailureMessage: null };

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
      const boolResult = performOccBooleanWithInstance(
        occ.oc,
        operationToOccBoolean(effectiveOperation),
        targetOccBody,
        toolBody,
        { id: featureId, sourceFeatureId: featureId },
      );
      if (!boolResult) return { needsStoredMesh: false, occFailureMessage: null };

      globalBRepBodyRegistry.add(boolResult);
      const tessellation = tessellateWithInstance(occ.oc, boolResult);
      const geometry = tessellationToGeometry(tessellation);
      const material = new THREE.MeshPhysicalMaterial({
        color: 0x8899aa,
        metalness: 0.3,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });
      const featureMesh = new THREE.Mesh(geometry, material);
      attachTessellationToMesh(featureMesh, tessellation, boolResult.id);
      featureMesh.userData['pickable'] = true;
      featureMesh.userData['featureId'] = featureId;
      featureMesh.castShadow = true;
      featureMesh.receiveShadow = true;
      if (!isRenderableOccMesh(featureMesh)) {
        disposeRejectedOccMesh(featureMesh);
        return { needsStoredMesh: false, occFailureMessage: 'OCC boolean returned an empty body' };
      }

      return {
        featureMesh,
        needsStoredMesh: true,
        suppressedTargetId: occTarget.id,
        occFailureMessage: null,
      };
    } finally {
      disposeBRepBody(toolBody);
    }
  } catch (err) {
    const occFailureMessage = errorMessage(err, 'unknown');
    console.warn(`[commitExtrude] OCC ${effectiveOperation} path failed (${occFailureMessage})`);
    return { needsStoredMesh: false, occFailureMessage };
  }
}

export async function buildSingleProfileOccBooleanExtrudeMesh({
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
  isStale,
}: {
  resolvedBodyKind: 'solid' | 'surface';
  extrudeThinEnabled: boolean;
  needsStoredMesh: boolean;
  effectiveOperation: ExtrudeOperation;
  profileIndices: number[] | undefined;
  nextFeatures: Feature[];
  sketches: Sketch[];
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  selected: SelectedExtrudeProfile;
  profileIndex: number | undefined;
  featureId: string;
  finalDirection: ExtrudeDirection;
  absDistance: number;
  absDistance2: number;
  extrudeSymmetricFullLength: boolean;
  extrudeStartType: string;
  extrudeStartOffset: number;
  extrudeTaperAngle: number;
  extrudeTaperAngle2: number | undefined;
  isStale: () => boolean;
}): Promise<{
  featureMesh?: THREE.Mesh;
  needsStoredMesh: boolean;
  committedDirection?: ExtrudeDirection;
  suppressedTargetId?: string;
  bodyId?: string;
  componentId?: string;
  occBooleanResolved: boolean;
  occFailureMessage: string | null;
  stale: boolean;
}> {
  const shouldRun =
    resolvedBodyKind === 'solid' &&
    !extrudeThinEnabled &&
    !needsStoredMesh &&
    (effectiveOperation === 'join' || effectiveOperation === 'cut' || effectiveOperation === 'intersect') &&
    profileIndices === undefined;
  if (!shouldRun) {
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
  }

  const occ = getOccSync() ?? await getOcc();
  if (isStale()) {
    console.warn('[commitExtrude] features changed during OCC boolean init - aborting stale commit');
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: true };
  }
  if (!occ) return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };

  const { feature: occTargetFeature, body: targetBRepBody } = await ensureLatestOccSolidTarget(nextFeatures, sketches);
  if (!targetBRepBody || !occTargetFeature) {
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
  }

  try {
    const shapes = GeometryEngine.sketchToProfileShapesFlat(sourceSketch);
    const firstShape = profileIndex !== undefined ? shapes[profileIndex] : shapes[0];
    if (!firstShape || firstShape.holes.length > 0) {
      return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
    }

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
      extrudeTaperAngle2 ?? 0,
    );
    const { occDistance, occSymmetric, occTwoSideDist } = resolveOccExtrudeDistance(
      booleanDirection,
      absDistance,
      absDistance2,
      extrudeSymmetricFullLength,
    );
    const boolOp = operationToOccBoolean(effectiveOperation);
    const toolExtrude = boolOp === 'subtract' && !occSymmetric && occTwoSideDist === undefined
      ? makeCutOvertravelFrame(frame, occDistance)
      : { frame, distance: occDistance };

    let resultBody = null;
    try {
      const exactCircleToolShape =
        boolOp === 'subtract' &&
        !occSymmetric &&
        occTwoSideDist === undefined &&
        Math.abs(extrudeTaperAngle) <= 0.001
          ? tryBuildExactCircleToolShape(occ.oc, sourceSketch, sketchProfile, toolExtrude.distance, toolExtrude.frame)
          : null;
      const toolShape = exactCircleToolShape ?? occExtrudeShapeWithInstance(
        occ.oc,
        sketchProfile,
        toolExtrude.distance,
        toolExtrude.frame,
        {
          symmetric: occSymmetric,
          twoSideDist: occTwoSideDist,
          taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
        },
      );

      try {
        resultBody = performRobustBooleanWithRawTool(
          occ.oc,
          boolOp,
          targetBRepBody,
          toolShape.shape,
          { id: featureId, sourceFeatureId: featureId },
        );
      } finally {
        toolShape.dispose();
      }
    } catch (err) {
      console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')})`);
    }

    if (!resultBody) return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
    const featureMesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, featureId);
    if (!isRenderableOccMesh(featureMesh)) {
      disposeRejectedOccMesh(featureMesh);
      return {
        needsStoredMesh,
        occBooleanResolved: false,
        occFailureMessage: 'OCC boolean returned an empty body',
        stale: false,
      };
    }

    return {
      featureMesh,
      needsStoredMesh: true,
      committedDirection: booleanDirection,
      suppressedTargetId: occTargetFeature.id,
      bodyId: occTargetFeature.bodyId,
      componentId: occTargetFeature.componentId,
      occBooleanResolved: true,
      occFailureMessage: null,
      stale: false,
    };
  } catch (err) {
    console.warn(`[commitExtrude] OCC boolean path failed (${errorMessage(err, 'unknown')})`);
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
  }
}

export async function buildMultiProfileOccBooleanExtrudeMesh({
  resolvedBodyKind,
  extrudeThinEnabled,
  needsStoredMesh,
  effectiveOperation,
  profileIndices,
  extrudeExtentType,
  nextFeatures,
  sketches,
  sourceSketch,
  sketchForOp,
  featureId,
  finalDirection,
  absDistance,
  absDistance2,
  extrudeSymmetricFullLength,
  extrudeTaperAngle,
  extrudeTaperAngle2,
  isStale,
}: {
  resolvedBodyKind: 'solid' | 'surface';
  extrudeThinEnabled: boolean;
  needsStoredMesh: boolean;
  effectiveOperation: ExtrudeOperation;
  profileIndices: number[] | undefined;
  extrudeExtentType: string;
  nextFeatures: Feature[];
  sketches: Sketch[];
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  featureId: string;
  finalDirection: ExtrudeDirection;
  absDistance: number;
  absDistance2: number;
  extrudeSymmetricFullLength: boolean;
  extrudeTaperAngle: number;
  extrudeTaperAngle2: number | undefined;
  isStale: () => boolean;
}): Promise<{
  featureMesh?: THREE.Mesh;
  needsStoredMesh: boolean;
  suppressedTargetId?: string;
  bodyId?: string;
  componentId?: string;
  occBooleanResolved: boolean;
  occFailureMessage: string | null;
  stale: boolean;
}> {
  const shouldRun =
    resolvedBodyKind === 'solid' &&
    !extrudeThinEnabled &&
    !needsStoredMesh &&
    (effectiveOperation === 'join' || effectiveOperation === 'cut' || effectiveOperation === 'intersect') &&
    profileIndices !== undefined &&
    profileIndices.length > 0 &&
    extrudeExtentType !== 'all';
  if (!shouldRun) {
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
  }

  const occ = getOccSync() ?? await getOcc();
  if (isStale()) {
    console.warn('[commitExtrude] features changed during multi-profile OCC boolean init - aborting stale commit');
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: true };
  }
  if (!occ) return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };

  const { feature: occTargetFeature, body: targetBRepBody } = await ensureLatestOccSolidTarget(nextFeatures, sketches);
  if (!targetBRepBody || !occTargetFeature) {
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
  }

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
      const sketchProfile = makeSketchProfileFromShape(shape);
      const profileBody = occExtrudeWithInstance(occ.oc, sketchProfile, occDistance, frame, {
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

    if (!toolBody) return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };

    try {
      const resultBody = performOccBooleanWithInstance(
        occ.oc,
        operationToOccBoolean(effectiveOperation),
        targetBRepBody,
        toolBody,
        { id: featureId, sourceFeatureId: featureId },
      );
      if (!resultBody) return { needsStoredMesh, occBooleanResolved: false, occFailureMessage: null, stale: false };
      const featureMesh = createRegisteredOccMesh(occ.oc, resultBody, BODY_MATERIAL, featureId);
      if (!isRenderableOccMesh(featureMesh)) {
        disposeRejectedOccMesh(featureMesh);
        return {
          needsStoredMesh,
          occBooleanResolved: false,
          occFailureMessage: 'OCC boolean returned an empty body',
          stale: false,
        };
      }

      return {
        featureMesh,
        needsStoredMesh: true,
        suppressedTargetId: occTargetFeature.id,
        bodyId: occTargetFeature.bodyId,
        componentId: occTargetFeature.componentId,
        occBooleanResolved: true,
        occFailureMessage: null,
        stale: false,
      };
    } finally {
      disposeBRepBody(toolBody);
    }
  } catch (err) {
    const occFailureMessage = errorMessage(err, 'unknown');
    console.warn(`[commitExtrude] OCC multi-profile boolean path failed (${occFailureMessage})`);
    return { needsStoredMesh, occBooleanResolved: false, occFailureMessage, stale: false };
  }
}

import type { Mesh } from 'three';
import type { Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { getOcc, getOccSync } from '../../../../engine/occ/loader';
import { disposeBRepBody, type BRepBody } from '../../../../engine/occ/brepBody';
import { occExtrudeWithInstance } from '../../../../engine/occ/ops/extrude';
import { performOccBooleanWithInstance } from '../../../../engine/occ/ops/booleanCore';
import { createRegisteredOccMesh } from '../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../components/viewport/scene/bodyMaterial';
import { errorMessage } from '../../../../utils/errorHandling';
import {
  createOffsetOccFrame,
  makeSketchProfileFromShape,
  resolveOccExtrudeDistance,
  tryBuildAnalyticalExtrudeBody,
  type ExtrudeDirection,
} from './extrudeCommitHelpers';
import type { ExtrudeOperation } from './extrudeCommitOperation';

export async function buildOccNewBodyExtrudeMesh({
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
}: {
  resolvedBodyKind: 'solid' | 'surface';
  extrudeThinEnabled: boolean;
  effectiveOperation: ExtrudeOperation;
  profileIndices: number[] | undefined;
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
}): Promise<{ featureMesh?: Mesh; needsStoredMesh: boolean; occFailureMessage: string | null }> {
  const isOccNewBody =
    resolvedBodyKind === 'solid' &&
    !extrudeThinEnabled &&
    (effectiveOperation === 'new-body' || effectiveOperation === 'new-component');
  if (!isOccNewBody) return { needsStoredMesh: false, occFailureMessage: null };

  const occ = getOccSync() ?? await getOcc();
  if (!occ) return { needsStoredMesh: false, occFailureMessage: null };

  if (profileIndices !== undefined && profileIndices.length > 0) {
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
        const sketchProfile = makeSketchProfileFromShape(shape);
        const profileBody = occExtrudeWithInstance(occ.oc, sketchProfile, occDistance, frame, {
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

      if (!accBody) return { needsStoredMesh: false, occFailureMessage: null };
      return {
        featureMesh: createRegisteredOccMesh(occ.oc, accBody, BODY_MATERIAL, featureId),
        needsStoredMesh: true,
        occFailureMessage: null,
      };
    } catch (err) {
      const occFailureMessage = errorMessage(err, 'unknown');
      console.warn(`[commitExtrude] OCC multi-profile path failed (${occFailureMessage})`);
      return { needsStoredMesh: false, occFailureMessage };
    }
  }

  if (profileIndices !== undefined) return { needsStoredMesh: false, occFailureMessage: null };

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
    const extrudeOptions = {
      id: featureId,
      sourceFeatureId: featureId,
      symmetric: occSymmetric,
      twoSideDist: occTwoSideDist,
      taperAngle: Math.abs(extrudeTaperAngle) > 0.001 ? extrudeTaperAngle : undefined,
      taperAngle2: Math.abs(extrudeTaperAngle2 ?? 0) > 0.001 ? extrudeTaperAngle2 : undefined,
    };
    // Try analytical path first: builds exact GC_MakeCircle_2 edges for circular holes
    // so the body has ~16 edges (not ~726 polygon segments) and fillets correctly.
    // Falls back to polygon path if any hole is not a detectable circle.
    const occBody =
      tryBuildAnalyticalExtrudeBody(occ.oc, sourceSketch, firstShape, occDistance, frame, extrudeOptions)
      ?? occExtrudeWithInstance(occ.oc, sketchProfile, occDistance, frame, extrudeOptions);

    return {
      featureMesh: createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId),
      needsStoredMesh: true,
      occFailureMessage: null,
    };
  } catch (err) {
    const occFailureMessage = errorMessage(err, 'unknown');
    console.error(`[commitExtrude] OCC path failed (${occFailureMessage})`, err);
    return { needsStoredMesh: false, occFailureMessage };
  }
}

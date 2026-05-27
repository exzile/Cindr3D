import * as THREE from 'three';
import type { Feature, Sketch } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { boxesHaveJoinableContact } from '../../../../utils/geometry/boundsContact';
import {
  buildExtrudeMeshForProfileSelectionAsync,
  type ExtrudeDirection,
  type SelectedExtrudeProfile,
} from './extrudeCommitHelpers';

export type ExtrudeOperation = 'new-body' | 'new-component' | 'join' | 'cut' | 'intersect';

const proposedBox = new THREE.Box3();
const existingFeatureBox = new THREE.Box3();

export async function resolveEffectiveExtrudeOperation({
  finalOperation,
  profilesToCommitCount,
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
}: {
  finalOperation: ExtrudeOperation;
  profilesToCommitCount: number;
  createdCount: number;
  resolvedBodyKind: 'solid' | 'surface';
  extrudeThinEnabled: boolean;
  nextFeatures: Feature[];
  selected: SelectedExtrudeProfile;
  absDistance: number;
  finalDirection: ExtrudeDirection;
  extrudeTaperAngle: number;
  extrudeStartOffset: number;
  extrudeStartType: string;
  absDistance2: number;
  extrudeTaperAngle2: number;
  sketches: Sketch[];
}): Promise<ExtrudeOperation> {
  let effectiveOperation = finalOperation;

  const isMultiProfileSubsequent =
    finalOperation === 'new-body' &&
    profilesToCommitCount > 1 &&
    createdCount > 0 &&
    resolvedBodyKind === 'solid' &&
    !extrudeThinEnabled;
  if (isMultiProfileSubsequent) effectiveOperation = 'join';

  if (effectiveOperation !== 'join' || resolvedBodyKind !== 'solid' || extrudeThinEnabled) {
    return effectiveOperation;
  }

  const existingSolids = nextFeatures.filter(
    (feature) =>
      feature.type === 'extrude' &&
      !feature.suppressed &&
      feature.visible &&
      feature.bodyKind !== 'surface' &&
      (feature.params.operation === 'new-body' || feature.params.operation === 'join'),
  );
  if (existingSolids.length === 0) return 'new-body';

  const proposedMesh = await buildExtrudeMeshForProfileSelectionAsync(
    selected,
    absDistance,
    finalDirection,
    extrudeTaperAngle,
    extrudeStartType === 'offset' ? extrudeStartOffset : 0,
    absDistance2,
    extrudeTaperAngle2,
  );
  if (!proposedMesh) return effectiveOperation;

  try {
    proposedMesh.updateMatrixWorld(true);
    proposedBox.setFromObject(proposedMesh);

    for (const existingFeature of existingSolids) {
      const existingSketch = sketches.find((sketch) => sketch.id === existingFeature.sketchId);
      if (!existingSketch) continue;
      const profileIndex = existingFeature.params.profileIndex as number | undefined;
      const existingSketchForOp = profileIndex !== undefined
        ? GeometryEngine.createProfileSketch(existingSketch, profileIndex)
        : existingSketch;
      if (!existingSketchForOp) continue;
      const existingMesh = GeometryEngine.buildExtrudeFeatureMesh(
        existingSketchForOp,
        (existingFeature.params.distance as number) ?? 10,
        ((existingFeature.params.direction as string) || 'positive') as ExtrudeDirection,
        (existingFeature.params.taperAngle as number) ?? 0,
        (existingFeature.params.startType as string) === 'offset'
          ? ((existingFeature.params.startOffset as number) ?? 0)
          : 0,
        (existingFeature.params.distance2 as number) ?? (existingFeature.params.distance as number) ?? 10,
      );
      if (!existingMesh) continue;
      try {
        existingMesh.updateMatrixWorld(true);
        existingFeatureBox.setFromObject(existingMesh);
        if (boxesHaveJoinableContact(proposedBox, existingFeatureBox)) return effectiveOperation;
      } finally {
        existingMesh.geometry.dispose();
      }
    }
    return 'new-body';
  } finally {
    proposedMesh.geometry.dispose();
  }
}

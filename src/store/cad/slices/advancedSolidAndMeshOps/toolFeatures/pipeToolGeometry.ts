import * as THREE from 'three';
import type { Sketch } from '../../../../../types/cad/sketch';
import type { OcctInstance } from '../../../../../engine/occ/types';
import { createOccPlaneFrameFromSketch } from '../../../../../engine/occ/plane';
import { occSweepFromPathWireWithInstance } from '../../../../../engine/occ/ops/sweep';
import type { SketchProfile } from '../../../../../engine/occ/ops/sketchToWire';
import { sketchEntitiesToWire } from '../../../../../engine/occ/sketchEntityToWire';
import { createRegisteredOccMesh } from '../../../../../engine/occ/registeredMesh';
import { BODY_MATERIAL } from '../../../../../components/viewport/scene/bodyMaterial';
import { OCC_PROFILE_POINT_COUNT } from '../../../../../utils/occConstants';

export function makeCircleProfile(outerRadius: number, innerRadius: number, hollow: boolean): SketchProfile {
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < OCC_PROFILE_POINT_COUNT; i++) {
    const a = (2 * Math.PI * i) / OCC_PROFILE_POINT_COUNT;
    outer.push(new THREE.Vector2(Math.cos(a) * outerRadius, Math.sin(a) * outerRadius));
  }

  const holes: THREE.Vector2[][] = [];
  if (hollow && innerRadius > 0.001 && innerRadius < outerRadius) {
    const inner: THREE.Vector2[] = [];
    for (let i = 0; i < OCC_PROFILE_POINT_COUNT; i++) {
      const a = (2 * Math.PI * i) / OCC_PROFILE_POINT_COUNT;
      inner.push(new THREE.Vector2(Math.cos(a) * innerRadius, Math.sin(a) * innerRadius));
    }
    inner.reverse();
    holes.push(inner);
  }

  return { outer, holes };
}

export function collectPipePathPoints(sketch: Sketch | undefined): THREE.Vector3[] {
  const pathPoints: THREE.Vector3[] = [];
  if (!sketch) return pathPoints;

  for (const entity of sketch.entities) {
    if (entity.type === 'centerline' || entity.type === 'construction-line' || entity.isConstruction) {
      continue;
    }
    for (const point of entity.points) {
      pathPoints.push(new THREE.Vector3(point.x, point.y, point.z));
    }
  }
  return pathPoints;
}

export function buildOccPipeMeshFromSketch(
  occ: OcctInstance,
  sketch: Sketch,
  outerDiameter: number,
  hollow: boolean,
  wallThickness: number,
  featureId: string,
): THREE.Mesh | null {
  const pathFrame = createOccPlaneFrameFromSketch(sketch);
  const pathWire = sketchEntitiesToWire(occ.oc, sketch.entities, pathFrame);
  if (!pathWire) return null;

  try {
    const outerRadius = outerDiameter / 2;
    const innerRadius = hollow ? Math.max(0, outerRadius - wallThickness) : 0;
    const sketchProfile = makeCircleProfile(outerRadius, innerRadius, hollow);
    const profileFrame = createOccPlaneFrameFromSketch(sketch);
    const occBody = occSweepFromPathWireWithInstance(occ.oc, sketchProfile, profileFrame, pathWire, {
      id: featureId,
      sourceFeatureId: featureId,
    });
    return occBody ? createRegisteredOccMesh(occ.oc, occBody, BODY_MATERIAL, featureId) : null;
  } finally {
    pathWire.delete();
  }
}

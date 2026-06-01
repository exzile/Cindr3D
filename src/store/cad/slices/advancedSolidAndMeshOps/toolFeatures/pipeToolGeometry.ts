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

export type PipeSectionType = 'circular' | 'square' | 'triangular';

/** Ring of `segments` points on a regular polygon of `radius` (circumradius),
 *  starting at angle `phase`. `segments` large ⇒ circle approximation. */
function regularRing(radius: number, segments: number, phase: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = phase + (2 * Math.PI * i) / segments;
    pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return pts;
}

/** Section geometry per type. circumradius = radius so all sections inscribe the
 *  same outer diameter, matching the mesh-fallback `buildSectionProfile` in
 *  engine/geometryEngine/core/solid/pipe.ts. */
function ringForSection(radius: number, sectionType: PipeSectionType): THREE.Vector2[] {
  if (sectionType === 'square') return regularRing(radius, 4, Math.PI / 4);
  if (sectionType === 'triangular') return regularRing(radius, 3, -Math.PI / 2);
  return regularRing(radius, OCC_PROFILE_POINT_COUNT, 0);
}

export function makeSectionProfile(
  outerRadius: number,
  innerRadius: number,
  hollow: boolean,
  sectionType: PipeSectionType = 'circular',
): SketchProfile {
  const outer = ringForSection(outerRadius, sectionType);

  const holes: THREE.Vector2[][] = [];
  if (hollow && innerRadius > 0.001 && innerRadius < outerRadius) {
    const inner = ringForSection(innerRadius, sectionType);
    inner.reverse();
    holes.push(inner);
  }

  return { outer, holes };
}

/** @deprecated use makeSectionProfile — kept for the circular call sites. */
export function makeCircleProfile(outerRadius: number, innerRadius: number, hollow: boolean): SketchProfile {
  return makeSectionProfile(outerRadius, innerRadius, hollow, 'circular');
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
  sectionType: PipeSectionType = 'circular',
): THREE.Mesh | null {
  const pathFrame = createOccPlaneFrameFromSketch(sketch);
  const pathWire = sketchEntitiesToWire(occ.oc, sketch.entities, pathFrame);
  if (!pathWire) return null;

  try {
    const outerRadius = outerDiameter / 2;
    const innerRadius = hollow ? Math.max(0, outerRadius - wallThickness) : 0;
    const sketchProfile = makeSectionProfile(outerRadius, innerRadius, hollow, sectionType);
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

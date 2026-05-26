import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sketch, SketchEntity } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { createOccPlaneFrameFromSketch } from '../../../../engine/occ/plane';
import { occExtrudeFaceShapeWithInstance } from '../../../../engine/occ/ops/extrude';
import {
  performOccBooleanWithRawTool,
  performOccBooleanWithInstance,
  type OccBooleanOptions,
  type OccBooleanOperation,
} from '../../../../engine/occ/ops/booleanCore';
import type { SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
import { sketchEntitiesToWire, wiresToFace } from '../../../../engine/occ/sketchEntityToWire';
import { OCC_PROFILE_POINT_COUNT } from '../../../../utils/occConstants';

const OCC_CUT_OVERTRAVEL_MM = 0.05;

export type SelectedExtrudeProfile = {
  sourceSketch: Sketch;
  sketchForOp: Sketch;
  selectionId: string;
  profileIndex: number | undefined;
  profileIndices?: number[];
};

export type ExtrudeDirection = 'positive' | 'negative' | 'symmetric' | 'two-sides';

export function makeSketchProfileFromShape(
  shape: THREE.Shape,
  includeHoles = true,
): SketchProfile {
  return {
    outer: shape.getPoints(OCC_PROFILE_POINT_COUNT),
    holes: includeHoles
      ? shape.holes.map((hole) => hole.getPoints(OCC_PROFILE_POINT_COUNT))
      : [],
  };
}

export function createOffsetOccFrame(
  sketch: Sketch,
  startType: string,
  startOffset: number,
) {
  const frame = createOccPlaneFrameFromSketch(sketch);
  if (startType === 'offset' && Math.abs(startOffset) > 0.001) {
    frame.origin.addScaledVector(frame.normal, startOffset);
  }
  return frame;
}

export function resolveOccExtrudeDistance(
  direction: ExtrudeDirection,
  absDistance: number,
  absDistance2: number,
  symmetricFullLength: boolean,
): {
  occDistance: number;
  occSymmetric: boolean;
  occTwoSideDist: number | undefined;
} {
  if (direction === 'negative') {
    return { occDistance: -absDistance, occSymmetric: false, occTwoSideDist: undefined };
  }
  if (direction === 'symmetric') {
    return {
      occDistance: symmetricFullLength ? absDistance : absDistance * 2,
      occSymmetric: true,
      occTwoSideDist: undefined,
    };
  }
  if (direction === 'two-sides') {
    return { occDistance: absDistance, occSymmetric: false, occTwoSideDist: absDistance2 };
  }
  return { occDistance: absDistance, occSymmetric: false, occTwoSideDist: undefined };
}

export function resolveSelectedExtrudeProfiles(
  selectedSketchIds: readonly string[],
  sketches: readonly Sketch[],
): SelectedExtrudeProfile[] {
  return selectedSketchIds
    .map((id) => {
      const [sketchId, rawIndex] = id.split('::');
      const sourceSketch = sketches.find((s) => s.id === sketchId);
      if (!sourceSketch) return null;
      if (rawIndex === undefined) {
        return {
          sourceSketch,
          sketchForOp: sourceSketch,
          selectionId: id,
          profileIndex: undefined,
        };
      }
      const parsed = Number(rawIndex);
      if (!Number.isFinite(parsed)) return null;
      const profileSketch = GeometryEngine.createProfileSketch(sourceSketch, parsed);
      if (!profileSketch) return null;
      return {
        sourceSketch,
        sketchForOp: profileSketch,
        selectionId: id,
        profileIndex: parsed,
      };
    })
    .filter(Boolean) as SelectedExtrudeProfile[];
}

export function collapseSameSketchProfilesForNewBody(
  selectedProfiles: readonly SelectedExtrudeProfile[],
  requestedBooleanOperation: boolean,
): SelectedExtrudeProfile[] {
  const firstProfile = selectedProfiles[0];
  const shouldCollapseSameSketchProfiles =
    !!firstProfile &&
    !requestedBooleanOperation &&
    selectedProfiles.length > 1 &&
    selectedProfiles.every(
      (profile) =>
        profile.sourceSketch.id === firstProfile.sourceSketch.id &&
        profile.profileIndex !== undefined,
    );

  return shouldCollapseSameSketchProfiles
    ? [{
        sourceSketch: firstProfile.sourceSketch,
        sketchForOp: firstProfile.sourceSketch,
        selectionId: firstProfile.sourceSketch.id,
        profileIndex: undefined,
        profileIndices: selectedProfiles.map((profile) => profile.profileIndex as number),
      }]
    : [...selectedProfiles];
}

export function computeToObjectDistance(
  profileSketch: Sketch,
  fallbackDistance: number,
  faceCentroid: readonly [number, number, number] | null | undefined,
  faceNormal: readonly [number, number, number] | null | undefined,
  startFaceCentroid: readonly [number, number, number] | null | undefined,
  flipDirection: boolean,
): number {
  if (!faceCentroid) return Math.abs(fallbackDistance);
  const target = new THREE.Vector3(...faceCentroid);
  const origin = profileSketch.planeOrigin.clone();
  if (startFaceCentroid) origin.set(...startFaceCentroid);
  const normal = faceNormal
    ? new THREE.Vector3(...faceNormal)
    : profileSketch.planeNormal.clone().normalize();
  const raw = target.clone().sub(origin).dot(normal);
  const distance = flipDirection ? -raw : raw;
  return Math.max(0.01, Math.abs(distance));
}

export async function buildExtrudeMeshForProfileSelectionAsync(
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

export function boxesOverlapVolume(a: THREE.Box3, b: THREE.Box3): boolean {
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

export async function resolveBooleanExtrudeDirection(
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

export function makeCutOvertravelFrame(
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

export function tryBuildExactCircleToolShape(
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

export function performRobustBooleanWithRawTool(
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

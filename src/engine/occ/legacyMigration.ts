/**
 * OCC-9.2 — Legacy feature migration.
 *
 * When a .exzile file was saved before the OCC pipeline was wired, extrude
 * features have no stored mesh (feature.mesh === undefined).  ExtrudedBodies.tsx
 * renders those via its CSG rebuild pipeline.  This module provides a one-shot
 * async pass that runs immediately after file load: for each legacy extrude
 * feature that is missing a mesh we attempt to build an OCC BRep body, tessellate
 * it, and attach it as feature.mesh so the CSG path is never reached.
 *
 * Scope (intentionally narrow to minimise risk):
 *   - Only `type === 'extrude'` features with no existing mesh.
 *   - Only `operation === 'new-body'` on the first pass (independent of other features).
 *   - join/cut/intersect legacy features are attempted only when their target's OCC
 *     body is available in the registry (i.e. it was either saved as a v2 snapshot
 *     or was itself migrated in this pass).
 *   - On any OCC failure the feature is returned unchanged (CSG pipeline handles it).
 *
 * Called from deserializeExzileFile immediately after features + bodies are loaded.
 */

import * as THREE from 'three';
import type { Feature, Sketch, SketchEntity } from '../../types/cad';
import { GeometryEngine } from '../GeometryEngine';
import { getOccSync } from './loader';
import { createOccPlaneFrameFromSketch } from './plane';
import { globalBRepBodyRegistry } from './globalRegistry';
import {
  occExtrudeShapeWithInstance,
  occExtrudeWithInstance,
  occExtrudeFaceShapeWithInstance,
} from './ops/extrude';
import { sketchEntitiesToWire, wiresToFace } from './sketchEntityToWire';
import {
  performOccBooleanWithRawTool,
  performOccBooleanWithInstance,
  type OccBooleanOperation,
} from './ops/booleanCore';
import { tessellateEdgesOnly, tessellateWithInstance, tessellationToGeometry } from './tessellate';
import { attachTessellationToMesh } from './picking';
import type { SketchProfile } from './ops/sketchToWire';
import type { BRepBody } from './brepBody';
import type { OcctInstance } from './types';
import { OCC_PROFILE_POINT_COUNT, OCC_BOOLEAN_VERSION } from '../../utils/occConstants';

function pushMigrationDebug(entry: unknown): void {
  void entry;
}

/**
 * Quick WASM health probe — creates and destroys a trivial gp_Pnt to verify
 * the OCC WASM heap is not corrupted.  Returns false if the heap is bad.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isOccWasmHealthy(oc: any): boolean {
  try {
    const pt = new oc.gp_Pnt_3(0, 0, 0);
    pt.delete();
    return true;
  } catch {
    return false;
  }
}

/** Shared material for migrated feature meshes (same style as new-commit OCC path). */
const MIGRATED_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});
MIGRATED_MATERIAL.userData.shared = true;
const OCC_CUT_OVERTRAVEL_MM = 0.05;

function readNumberParam(
  feature: Feature,
  keys: string[],
  fallback: number,
): number {
  for (const key of keys) {
    const value = feature.params[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return fallback;
}

function readStringParam<T extends string>(
  feature: Feature,
  keys: string[],
  fallback: T,
): T {
  for (const key of keys) {
    const value = feature.params[key];
    if (typeof value === 'string') return value as T;
  }
  return fallback;
}

function readBooleanParam(
  feature: Feature,
  keys: string[],
  fallback: boolean,
): boolean {
  for (const key of keys) {
    const value = feature.params[key];
    if (typeof value === 'boolean') return value;
  }
  return fallback;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    MIGRATED_MATERIAL.dispose();
  });
}

function hasLiveOccBody(feature: Feature): boolean {
  const operation =
    (feature.params.operation as string | undefined) ??
    (feature.params.extrudeOperation as string | undefined);
  if (
    (operation === 'join' || operation === 'cut' || operation === 'intersect') &&
    feature.params.occBooleanVersion !== OCC_BOOLEAN_VERSION
  ) {
    const mesh = feature.mesh as THREE.Mesh | undefined;
    const bodyId = mesh?.isMesh ? (mesh.userData['brepBodyId'] as string | undefined) : undefined;
    return !!bodyId && !!globalBRepBodyRegistry.get(bodyId);
  }
  const mesh = feature.mesh as THREE.Mesh | undefined;
  const bodyId = mesh?.isMesh ? (mesh.userData['brepBodyId'] as string | undefined) : undefined;
  return (!!bodyId && !!globalBRepBodyRegistry.get(bodyId)) ||
    globalBRepBodyRegistry.getByFeature(feature.id).some((body) => !!body._tessellation);
}

function featureHasRegisteredOccBody(feature: Feature | undefined): boolean {
  const mesh = feature?.mesh as THREE.Mesh | undefined;
  const bodyId = mesh?.isMesh ? (mesh.userData['brepBodyId'] as string | undefined) : undefined;
  return (!!bodyId && !!globalBRepBodyRegistry.get(bodyId)) ||
    (!!feature && globalBRepBodyRegistry.getByFeature(feature.id).length > 0);
}

function isBooleanExtrudeOperation(feature: Feature): boolean {
  const operation =
    (feature.params.operation as string | undefined) ??
    (feature.params.extrudeOperation as string | undefined);
  return operation === 'join' || operation === 'cut' || operation === 'intersect';
}

function stripMigrationDebug(feature: Feature): Feature {
  if (!Object.prototype.hasOwnProperty.call(feature.params, 'migrationDebug')) return feature;
  const params = { ...feature.params };
  delete params.migrationDebug;
  return { ...feature, params };
}

function buildSketchProfile(sketch: Sketch, pointCount = OCC_PROFILE_POINT_COUNT): SketchProfile | null {
  const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
  const first = shapes[0];
  if (!first || first.holes.length > 0) return null;
  return shapeToSketchProfile(first, pointCount);
}

function pathPoints(path: THREE.Path, pointCount: number): THREE.Vector2[] {
  return path.getSpacedPoints(Math.max(8, pointCount));
}

function shapeToSketchProfile(shape: THREE.Shape, pointCount = OCC_PROFILE_POINT_COUNT): SketchProfile {
  return {
    outer: pathPoints(shape, pointCount),
    holes: shape.holes
      .map((h) => pathPoints(h, pointCount))
      .filter((pts) => pts.length >= 3),
  };
}



function buildLargestRawSketchProfile(sketch: Sketch): SketchProfile | null {
  const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
  const rawLimit = Math.max(1, sketch.entities.length);
  let best: THREE.Shape | null = null;
  let bestArea = -Infinity;
  for (const shape of shapes.slice(0, rawLimit)) {
    const points = shape.getPoints(OCC_PROFILE_POINT_COUNT);
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    const absArea = Math.abs(area) * 0.5;
    if (absArea > bestArea) {
      best = shape;
      bestArea = absArea;
    }
  }
  return best ? shapeToSketchProfile(best) : null;
}

function shapeArea(points: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

function shapeCentroid(points: THREE.Vector2[]): THREE.Vector2 {
  const center = new THREE.Vector2();
  for (const point of points) center.add(point);
  return points.length > 0 ? center.divideScalar(points.length) : center;
}

function normalizeCircleLikeProfile(profile: SketchProfile): SketchProfile {
  if (profile.holes.length > 0 || profile.outer.length < 8) return profile;
  const xs = profile.outer.map((point) => point.x);
  const ys = profile.outer.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const aspect = Math.max(width, height) / Math.max(Math.min(width, height), 1e-6);
  pushMigrationDebug({ phase: 'circle-profile-bounds', points: profile.outer.length, width, height, aspect });
  if (!Number.isFinite(aspect) || aspect > 1.35) return profile;
  const center = new THREE.Vector2((minX + maxX) / 2, (minY + maxY) / 2);
  const radius = (width + height) / 4;
  if (!Number.isFinite(radius) || radius <= 1e-6) return profile;
  pushMigrationDebug({ phase: 'circle-profile-normalized', points: profile.outer.length, radius, aspect });
  const segmentCount = Math.max(32, Math.min(64, profile.outer.length * 2));
  const outer = Array.from({ length: segmentCount }, (_, index) => {
    const angle = index / segmentCount * Math.PI * 2;
    return new THREE.Vector2(
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
    );
  });
  return { outer, holes: [] };
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

function buildEnclosingRawProfileForAtomicIndex(sketch: Sketch, profileIndex: number): SketchProfile | null {
  const shapes = GeometryEngine.sketchToProfileShapesFlat(sketch);
  const selected = shapes[profileIndex];
  if (!selected) return null;

  const rawLimit = Math.max(1, sketch.entities.length);
  if (profileIndex < rawLimit) return null;

  const selectedPoints = selected.getPoints(64);
  const selectedCenter = shapeCentroid(selectedPoints);
  const selectedArea = shapeArea(selectedPoints);
  let enclosing: { shape: THREE.Shape; points: THREE.Vector2[]; area: number; index: number } | null = null;

  for (let index = 0; index < Math.min(rawLimit, shapes.length); index += 1) {
    const shape = shapes[index];
    const points = shape.getPoints(64);
    const area = shapeArea(points);
    if (area + 1e-6 < selectedArea) continue;
    if (!pointInPolygon(selectedCenter, points)) continue;
    if (!enclosing || area < enclosing.area) {
      enclosing = { shape, points, area, index };
    }
  }

  if (!enclosing) return null;
  const holes: THREE.Vector2[][] = [];
  for (let index = 0; index < Math.min(rawLimit, shapes.length); index += 1) {
    if (index === enclosing.index) continue;
    const shape = shapes[index];
    const points = pathPoints(shape, 32);
    if (shapeArea(points) >= enclosing.area) continue;
    if (pointInPolygon(shapeCentroid(points), enclosing.points)) {
      holes.push(points);
    }
  }

  return {
    outer: pathPoints(enclosing.shape, 32),
    holes: holes.filter((pts) => pts.length >= 3),
  };
}

function buildProfileSketchProfileFromIndex(sketch: Sketch, profileIndex: number): SketchProfile | null {
  const enclosingProfile = buildEnclosingRawProfileForAtomicIndex(sketch, profileIndex);
  if (enclosingProfile) return enclosingProfile;

  const profileSketch = GeometryEngine.createProfileSketch(sketch, profileIndex);
  if (profileSketch) {
    const profile = buildSketchProfile(profileSketch, 32);
    if (profile) return profile;
  }
  const shape = GeometryEngine.sketchToProfileShapesFlat(sketch)[profileIndex];
  // Profiles with holes crash BRepBuilderAPI_MakeEdge_3 in WASM; skip OCC for them.
  if (!shape || shape.holes.length > 0) return null;
  return shapeToSketchProfile(shape, 32);
}

function buildAtomicSketchProfileFromIndex(sketch: Sketch, profileIndex: number): SketchProfile | null {
  const profileSketch = GeometryEngine.createProfileSketch(sketch, profileIndex);
  if (profileSketch) {
    const profile = buildSketchProfile(profileSketch, 32);
    if (profile) return normalizeCircleLikeProfile(profile);
  }
  const shape = GeometryEngine.sketchToProfileShapesFlat(sketch)[profileIndex];
  if (!shape || shape.holes.length > 0) return null;
  return normalizeCircleLikeProfile(shapeToSketchProfile(shape, 32));
}

function buildBooleanToolProfiles(feature: Feature, sketch: Sketch): SketchProfile[] {
  const profileIndices = feature.params.profileIndices;
  if (Array.isArray(profileIndices) && profileIndices.length > 0) {
    pushMigrationDebug({ phase: 'tool-profile-indices', featureId: feature.id, profileIndices });
    return (profileIndices as number[])
      .map((idx) => buildAtomicSketchProfileFromIndex(sketch, idx))
      .filter((profile): profile is SketchProfile => !!profile);
  }
  const profileIndex = feature.params.profileIndex;
  if (typeof profileIndex === 'number' && Number.isFinite(profileIndex)) {
    pushMigrationDebug({
      phase: 'tool-profile-index',
      featureId: feature.id,
      profileIndex,
      params: feature.params,
      entityTypes: sketch.entities.map((entity) => entity.type),
    });
    const profile = buildAtomicSketchProfileFromIndex(sketch, profileIndex);
    return profile ? [profile] : [];
  }
  pushMigrationDebug({ phase: 'tool-profile-default', featureId: feature.id });
  const profile = buildFeatureSketchProfile(feature, sketch);
  return profile ? [profile] : [];
}

function buildFeatureSketchProfile(
  feature: Feature,
  sketch: Sketch,
  options: { preferRawBaseProfile?: boolean } = {},
): SketchProfile | null {
  // Explicit sketch-region selections must win over raw sketch fallback. A
  // rectangle profile with inner circles stores the circle voids on the
  // selected profile; rebuilding from the raw base sketch would fill them in.
  const profileIndices = feature.params.profileIndices;
  if (Array.isArray(profileIndices) && profileIndices.length > 0) {
    const idx = profileIndices[0] as number;
    return buildProfileSketchProfileFromIndex(sketch, idx);
  }
  const profileIndex = feature.params.profileIndex;
  if (typeof profileIndex === 'number' && Number.isFinite(profileIndex)) {
    return buildProfileSketchProfileFromIndex(sketch, profileIndex);
  }
  if (options.preferRawBaseProfile) {
    const rawProfile = buildLargestRawSketchProfile(sketch);
    if (rawProfile) return rawProfile;
  }
  return buildSketchProfile(sketch);
}

function featureSketchForProfile(feature: Feature, sketch: Sketch): Sketch | null {
  const profileIndex = feature.params.profileIndex;
  if (typeof profileIndex === 'number' && Number.isFinite(profileIndex)) {
    return GeometryEngine.createProfileSketch(sketch, profileIndex);
  }
  return sketch;
}

function boxesOverlapVolume(a: THREE.Box3, b: THREE.Box3): boolean {
  const x = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const y = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const z = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  const scale = Math.max(a.min.distanceTo(a.max), b.min.distanceTo(b.max), 1);
  const tolerance = scale * 1e-5;
  return x > tolerance && y > tolerance && z > tolerance;
}

function buildProbeBox(
  sketch: Sketch,
  distance: number,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  taperAngle: number,
  startOffset: number,
  distance2: number,
): THREE.Box3 | null {
  const mesh = GeometryEngine.buildExtrudeFeatureMesh(
    sketch,
    distance,
    direction,
    taperAngle,
    startOffset,
    distance2,
  );
  if (!mesh) return null;
  try {
    mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh);
  } finally {
    mesh.geometry.dispose();
  }
}

function resolveBooleanDirection(
  feature: Feature,
  sketch: Sketch,
  targetMesh: THREE.Mesh,
  direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
  distance: number,
  distance2: number,
  taperAngle: number,
): 'positive' | 'negative' | 'symmetric' | 'two-sides' {
  if (direction !== 'positive' && direction !== 'negative') return direction;

  targetMesh.updateMatrixWorld(true);
  const targetBox = new THREE.Box3().setFromObject(targetMesh);
  const startOffset = (feature.params.startType as string | undefined) === 'offset'
    ? ((feature.params.startOffset as number | undefined) ?? 0)
    : 0;
  const forwardBox = buildProbeBox(sketch, distance, direction, taperAngle, startOffset, distance2);
  if (forwardBox && boxesOverlapVolume(forwardBox, targetBox)) return direction;
  const reverseDirection = direction === 'positive' ? 'negative' : 'positive';
  const reverseBox = buildProbeBox(sketch, distance, reverseDirection, taperAngle, startOffset, distance2);
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

/**
 * Attempt to build an OCC mesh for one legacy extrude feature.
 * Returns the updated feature (with mesh set) on success, or the original on failure.
 */
function migrateNewBodyExtrude(
  feature: Feature,
  sketch: Sketch,
  occInstance?: OcctInstance,
): Feature {
  const occ = occInstance ?? getOccSync();
  if (!occ) {
    return feature;
  }

  let occBody: BRepBody | null = null;
  let registered = false;
  try {
    const frame = createOccPlaneFrameFromSketch(sketch);

    const distance = readNumberParam(feature, ['distance', 'extrudeDistance'], 10);
    const direction = readStringParam<'positive' | 'negative' | 'symmetric' | 'two-sides'>(
      feature,
      ['direction', 'extrudeDirection'],
      'positive',
    );
    const taperAngle = readNumberParam(feature, ['taperAngle', 'extrudeTaperAngle'], 0);
    const taperAngle2 = readNumberParam(feature, ['taperAngle2', 'extrudeTaperAngle2'], 0);
    const symmetricFull = readBooleanParam(feature, ['symmetricFullLength', 'extrudeSymmetricFullLength'], false);
    const distance2 = readNumberParam(feature, ['distance2', 'extrudeDistance2'], 0);
    const startType = readStringParam(feature, ['startType', 'extrudeStartType'], 'profile');
    const startOffset = readNumberParam(feature, ['startOffset', 'extrudeStartOffset'], 0);
    if (startType === 'offset' && Math.abs(startOffset) > 0.001) {
      frame.origin.addScaledVector(frame.normal, startOffset);
    }
    const absDistance = Math.max(0.001, Math.abs(distance));
    const absDist2 = Math.max(0.001, Math.abs(distance2));

    let occDistance: number;
    let occSymmetric = false;
    let occTwoSideDist: number | undefined;

    if (direction === 'negative') {
      occDistance = -absDistance;
    } else if (direction === 'symmetric') {
      occDistance = symmetricFull ? absDistance : absDistance * 2;
      occSymmetric = true;
    } else if (direction === 'two-sides') {
      occDistance = absDistance;
      occTwoSideDist = absDist2;
    } else {
      occDistance = absDistance;
    }

    const extrudeOpts = {
      id: feature.id,
      sourceFeatureId: feature.id,
      symmetric: occSymmetric,
      twoSideDist: occTwoSideDist,
      taperAngle: Math.abs(taperAngle) > 0.001 ? taperAngle : undefined,
      taperAngle2: Math.abs(taperAngle2) > 0.001 ? taperAngle2 : undefined,
    };

    // Multi-profile selection: extrude each region separately and union.
    const profileIndices = feature.params.profileIndices;
    if (Array.isArray(profileIndices) && profileIndices.length > 1) {
      const bodies: BRepBody[] = [];
      try {
        for (const idx of profileIndices as number[]) {
          const profile = buildProfileSketchProfileFromIndex(sketch, idx);
          if (!profile) continue;
          bodies.push(occExtrudeWithInstance(occ.oc, profile, occDistance, frame, extrudeOpts));
        }
        if (bodies.length === 0) return feature;
        occBody = bodies[0];
        for (let i = 1; i < bodies.length; i++) {
          const fused = performOccBooleanWithInstance(occ.oc, 'union', occBody, bodies[i], {
            id: feature.id, sourceFeatureId: feature.id,
          });
          occBody.dispose();
          bodies[i].dispose();
          if (!fused) return feature;
          occBody = fused;
        }
      } catch (err) {
        for (const b of bodies) try { b.dispose(); } catch { /* ignore */ }
        throw err;
      }
    } else {
      const profile = buildFeatureSketchProfile(feature, sketch, { preferRawBaseProfile: true });
      if (!profile) return feature;
      occBody = occExtrudeWithInstance(occ.oc, profile, occDistance, frame, extrudeOpts);
    }
    let tess;
    try {
      tess = tessellateWithInstance(occ.oc, occBody);
    } catch (error) {
      void error;
      tessellateEdgesOnly(occ.oc, occBody);
      globalBRepBodyRegistry.add(occBody);
      registered = true;
      return { ...feature };
    }
    const geo = tessellationToGeometry(tess);
    const mesh = new THREE.Mesh(geo, MIGRATED_MATERIAL);
    attachTessellationToMesh(mesh, tess, occBody.id);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.featureId = feature.id;
    mesh.userData.pickable = true;

    globalBRepBodyRegistry.add(occBody);
    registered = true;
    return { ...feature, mesh };
  } catch (err) {
    if (occBody && !registered) occBody.dispose();
    pushMigrationDebug({ phase: 'new-body', featureId: feature.id, error: String(err instanceof Error ? err.message : err) });
    console.warn('[legacyMigration] OCC new-body extrude failed for feature', feature.id, err);
    return feature;
  }
}

// ── Exact-circle tool-shape helpers (avoids polygon-approx WASM crash) ──────────

function polygonArea2DMigration(points: readonly { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function profileCentroid2D(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  const n = points.length || 1;
  return { x: cx / n, y: cy / n };
}

function findCircleEntityForProfile(
  sketch: Sketch,
  profile: SketchProfile,
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): SketchEntity | null {
  if (profile.holes.length > 0 || profile.outer.length < 8) return null;
  const profileArea = polygonArea2DMigration(profile.outer);
  const { x: cx, y: cy } = profileCentroid2D(profile.outer);
  const center = { x: cx, y: cy };
  let best: { entity: SketchEntity; score: number } | null = null;

  for (const entity of sketch.entities) {
    if (entity.type !== 'circle' || typeof entity.radius !== 'number' || entity.radius <= 0) continue;
    const firstPt = entity.points[0];
    if (!firstPt) continue;
    const expectedArea = Math.PI * entity.radius * entity.radius;
    const areaError = Math.abs(profileArea - expectedArea) / Math.max(expectedArea, 1e-6);
    if (areaError > 0.08) continue;
    const d3 = new THREE.Vector3(firstPt.x, firstPt.y, firstPt.z).sub(frame.origin);
    const pu = d3.dot(frame.uDir), pv = d3.dot(frame.vDir);
    const dist = Math.sqrt((pu - center.x) ** 2 + (pv - center.y) ** 2);
    const centerError = dist / Math.max(entity.radius, 1);
    if (centerError > 0.08) continue;
    const score = areaError + centerError;
    if (!best || score < best.score) best = { entity, score };
  }

  return best?.entity ?? null;
}

/** Try to build an exact OCC circle tool shape — avoids polygon-approximation
 *  crash in pointLoopToWire (BRepBuilderAPI_MakeEdge_3 / WASM memory issue).
 *  Returns null if the profile isn't a recognisable circle. */
function tryExactCircleToolShapeForMigration(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oc: any,
  sketch: Sketch,
  profile: SketchProfile,
  distance: number,
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
) {
  const circle = findCircleEntityForProfile(sketch, profile, frame);
  if (!circle) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wire = sketchEntitiesToWire(oc as any, [circle], frame);
  if (!wire) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const face = wiresToFace(oc as any, wire, []);
  if (!face) {
    (wire as { delete?: () => void }).delete?.();
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return occExtrudeFaceShapeWithInstance(oc as any, face, distance, frame, {}, [wire]);
}

/**
 * Attempt to apply an OCC boolean for a legacy join/cut/intersect extrude.
 * The target must already have an OCC body in the registry (either loaded from
 * a v2 snapshot or migrated in the new-body pass above).
 */
function migrateJoinCutExtrude(
  feature: Feature,
  sketch: Sketch,
  targetFeature: Feature,
  occInstance?: OcctInstance,
): Feature {
  const occ = occInstance ?? getOccSync();
  if (!occ) return feature;

  const targetMesh = targetFeature.mesh as THREE.Mesh | undefined;
  const targetBodyId = targetMesh?.isMesh ? (targetMesh.userData['brepBodyId'] as string | undefined) : undefined;
  const targetBody =
    (targetBodyId ? globalBRepBodyRegistry.get(targetBodyId) : undefined) ??
    globalBRepBodyRegistry.getByFeature(targetFeature.id)[0];
  if (!targetBody) return feature;

  let resultBody: BRepBody | null = null;
  let registered = false;
  try {
    const sketchForOp = featureSketchForProfile(feature, sketch);
    if (!sketchForOp) return feature;
    const toolProfiles = buildBooleanToolProfiles(feature, sketch);
    if (toolProfiles.length === 0) return feature;
    const frame = createOccPlaneFrameFromSketch(sketch);

    const distance = readNumberParam(feature, ['distance', 'extrudeDistance'], 10);
    const direction = readStringParam<'positive' | 'negative' | 'symmetric' | 'two-sides'>(
      feature,
      ['direction', 'extrudeDirection'],
      'positive',
    );
    const distance2 = readNumberParam(feature, ['distance2', 'extrudeDistance2'], distance);
    const taperAngle = readNumberParam(feature, ['taperAngle', 'extrudeTaperAngle'], 0);
    const taperAngle2 = readNumberParam(feature, ['taperAngle2', 'extrudeTaperAngle2'], 0);
    const symmetricFull = readBooleanParam(feature, ['symmetricFullLength', 'extrudeSymmetricFullLength'], false);
    const absDistance = Math.max(0.001, Math.abs(distance));
    const startType = readStringParam(feature, ['startType', 'extrudeStartType'], 'profile');
    const startOffset = readNumberParam(feature, ['startOffset', 'extrudeStartOffset'], 0);
    if (startType === 'offset' && Math.abs(startOffset) > 0.001) {
      frame.origin.addScaledVector(frame.normal, startOffset);
    }
    const operation =
      (feature.params.operation as string | undefined) ??
      (feature.params.extrudeOperation as string | undefined);
    const occOp: OccBooleanOperation =
      operation === 'cut' ? 'subtract'
      : operation === 'intersect' ? 'intersect'
      : 'union';

    // Build tool body (new-body shape; distance direction already encodes sign)
    let targetProbeMesh = targetMesh?.isMesh ? targetMesh : null;
    let temporaryTargetGeometry: THREE.BufferGeometry | null = null;
    if (!targetProbeMesh) {
      try {
        const tess = tessellateWithInstance(occ.oc, targetBody);
        temporaryTargetGeometry = tessellationToGeometry(tess);
        targetProbeMesh = new THREE.Mesh(temporaryTargetGeometry);
      } catch {
        targetProbeMesh = null;
      }
    }

    const booleanDirection = targetProbeMesh
      ? resolveBooleanDirection(
          feature,
          sketchForOp,
          targetProbeMesh,
          direction,
          absDistance,
          Math.max(0.001, Math.abs(distance2)),
          taperAngle,
        )
      : direction;
    temporaryTargetGeometry?.dispose();

    let occDistance = absDistance;
    if (booleanDirection === 'negative') occDistance = -absDistance;
    let occSymmetric = false;
    let occTwoSideDist: number | undefined;
    if (booleanDirection === 'symmetric') {
      occDistance = symmetricFull ? absDistance : absDistance * 2;
      occSymmetric = true;
    } else if (booleanDirection === 'two-sides') {
      occTwoSideDist = Math.max(0.001, Math.abs(distance2));
    }

    const toolExtrude = occOp === 'subtract' && !occSymmetric && occTwoSideDist === undefined
      ? makeCutOvertravelFrame(frame, occDistance)
      : { frame, distance: occDistance };

    pushMigrationDebug({ phase: 'boolean-start', featureId: feature.id, operation: occOp, toolCount: toolProfiles.length });
    let workingBody = targetBody;
    let ownsWorkingBody = false;
    for (const profile of toolProfiles) {
      pushMigrationDebug({ phase: 'tool-profile-start', featureId: feature.id, pointCount: profile.outer.length });
      const exactCircleToolShape = occOp === 'subtract' && !occSymmetric && occTwoSideDist === undefined && Math.abs(taperAngle) <= 0.001
        ? tryExactCircleToolShapeForMigration(occ.oc, sketch, profile, toolExtrude.distance, toolExtrude.frame)
        : null;
      pushMigrationDebug({ phase: exactCircleToolShape ? 'exact-circle-tool' : 'profile-tool', featureId: feature.id });
      const toolShape = exactCircleToolShape ?? occExtrudeShapeWithInstance(occ.oc, profile, toolExtrude.distance, toolExtrude.frame, {
        sourceFeatureId: feature.id,
        symmetric: occSymmetric,
        twoSideDist: occTwoSideDist,
        taperAngle: Math.abs(taperAngle) > 0.001 ? taperAngle : undefined,
        taperAngle2: Math.abs(taperAngle2) > 0.001 ? taperAngle2 : undefined,
      });
      pushMigrationDebug({ phase: 'tool-shape-done', featureId: feature.id });
      try {
        const nextBody = performOccBooleanWithRawTool(occ.oc, occOp, workingBody, toolShape.shape, {
          id: feature.id,
          sourceFeatureId: feature.id,
          fuzzyValue: 1e-5,
        });
        if (!nextBody) {
          pushMigrationDebug({ phase: 'boolean-null', featureId: feature.id, operation: occOp });
          if (ownsWorkingBody) workingBody.dispose();
          return feature;
        }
        if (ownsWorkingBody) workingBody.dispose();
        workingBody = nextBody;
        ownsWorkingBody = true;
      } finally {
        toolShape.dispose();
      }
    }
    resultBody = ownsWorkingBody ? workingBody : null;
    if (!resultBody) {
      pushMigrationDebug({ phase: 'boolean-null', featureId: feature.id, operation: occOp });
      return feature; // OCC boolean returned null — CSG pipeline handles it
    }

    const tess = tessellateWithInstance(occ.oc, resultBody);
    const geo = tessellationToGeometry(tess);
    const mesh = new THREE.Mesh(geo, MIGRATED_MATERIAL);
    attachTessellationToMesh(mesh, tess, resultBody.id);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.featureId = feature.id;
    mesh.userData.pickable = true;

    globalBRepBodyRegistry.add(resultBody);
    registered = true;
    return {
      ...feature,
      mesh,
      params: {
        ...Object.fromEntries(
          Object.entries(feature.params).filter(([key]) => key !== 'csgBooleanFallbackVersion'),
        ),
        direction: booleanDirection,
        occBooleanVersion: OCC_BOOLEAN_VERSION,
      },
    };
  } catch (err) {
    if (resultBody && !registered) resultBody.dispose();
    pushMigrationDebug({ phase: 'boolean-error', featureId: feature.id, error: String(err instanceof Error ? err.message : err) });
    console.warn('[legacyMigration] OCC join/cut extrude failed for feature', feature.id, err);
    return feature;
  }
}

/**
 * Main entry point.  Run once after file load for any extrude feature that
 * has no stored mesh.  Works through features in timestamp order so join/cut
 * operations can find their already-migrated target.
 *
 * Returns a new features array (same references unless a feature was migrated).
 */
export function migrateLegacyExtrudeFeatures(
  features: Feature[],
  sketches: Sketch[],
  occInstance?: OcctInstance,
): Feature[] {
  const occ = occInstance ?? getOccSync();
  if (!occ) {
    pushMigrationDebug({ phase: 'skip-no-occ', featureCount: features.length });
    return features; // OCC not yet loaded — skip; ExtrudedBodies CSG handles it
  }
  // Check if there are any legacy features to migrate. A rehydrated persisted
  // mesh can have geometry but no live OCC body registry entry, which is still
  // legacy for OCC-only edge picking.
  const hasLegacy = features.some(
    (f) => f.type === 'extrude' && !f.suppressed && !hasLiveOccBody(f),
  );
  pushMigrationDebug({
    phase: 'start',
    featureCount: features.length,
    hasLegacy,
    extrudes: features
      .filter((f) => f.type === 'extrude')
      .map((f) => ({
        id: f.id,
        operation: f.params.operation ?? f.params.extrudeOperation,
        hasMesh: !!f.mesh,
        hasLiveOccBody: hasLiveOccBody(f),
      })),
  });
  if (!hasLegacy) {
    return features; // Nothing to do
  }

  // Process in timestamp order so join/cut can find their target's OCC body.
  const sorted = features.map(stripMigrationDebug).sort((a, b) => a.timestamp - b.timestamp);
  const migratedById = new Map<string, Feature>();

  const findRecentOccTarget = (
    participantBodyIds: string[],
    options: { includeHidden: boolean },
  ): Feature | undefined => {
    const sortedMigrated = Array.from(migratedById.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = sortedMigrated.length - 1; i >= 0; i--) {
      const candidate = sortedMigrated[i];
      if (!candidate.mesh) continue;
      if (!options.includeHidden && (candidate.suppressed || !candidate.visible)) continue;
      if (!featureHasRegisteredOccBody(candidate)) continue;
      if (
        participantBodyIds.length === 0 ||
        (candidate.bodyId && participantBodyIds.includes(candidate.bodyId))
      ) {
        return candidate;
      }
    }
    return undefined;
  };

  const rebuildRecentSuppressedTarget = (
    currentFeature: Feature,
    participantBodyIds: string[],
  ): Feature | undefined => {
    const sortedMigrated = Array.from(migratedById.values())
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = sortedMigrated.length - 1; i >= 0; i--) {
      const candidate = sortedMigrated[i];
      if (candidate.timestamp >= currentFeature.timestamp) continue;
      if (candidate.type !== 'extrude' || !candidate.suppressed) continue;
      if (isBooleanExtrudeOperation(candidate)) continue;
      if (
        participantBodyIds.length > 0 &&
        (!candidate.bodyId || !participantBodyIds.includes(candidate.bodyId))
      ) {
        continue;
      }

      if (featureHasRegisteredOccBody(candidate)) return candidate;
      const sketch = sketches.find((s) => s.id === candidate.sketchId);
      if (!sketch) continue;

      const rebuilt = migrateNewBodyExtrude(candidate, sketch, occ);
      migratedById.set(candidate.id, rebuilt);
      if (featureHasRegisteredOccBody(rebuilt)) return rebuilt;
    }
    return undefined;
  };

  for (const feature of sorted) {
    if (feature.type !== 'extrude' || feature.suppressed || hasLiveOccBody(feature)) {
      // Track features that already have meshes (their bodies may be migration targets).
      migratedById.set(feature.id, feature);
      continue;
    }

    const sketch = sketches.find((s) => s.id === feature.sketchId);
    if (!sketch) {
      migratedById.set(feature.id, feature);
      continue;
    }

    const operation =
      (feature.params.operation as string | undefined) ??
      (feature.params.extrudeOperation as string | undefined) ??
      'new-body';

    // Defence in depth: verify the WASM heap is still healthy before each
    // migration step.  If a previous step silently corrupted the heap, bail
    // out early instead of cascading crashes.
    if (!isOccWasmHealthy(occ.oc)) {
      console.warn('[legacyMigration] WASM heap corrupted — aborting remaining migrations');
      migratedById.set(feature.id, feature);
      continue;
    }

    if (operation === 'new-body') {
      const migrated = migrateNewBodyExtrude(feature, sketch, occ);
      migratedById.set(feature.id, migrated);
    } else if (operation === 'join' || operation === 'cut' || operation === 'intersect') {
      // Find the most recent OCC-backed feature that could be the target.
      // This mirrors the runtime logic in extrudeCommitActions.ts.
      const participantBodyIds = Array.isArray(feature.params.participantBodyIds)
        ? (feature.params.participantBodyIds as string[])
        : [];

      const targetFeature =
        findRecentOccTarget(participantBodyIds, { includeHidden: false }) ??
        rebuildRecentSuppressedTarget(feature, participantBodyIds) ??
        findRecentOccTarget(participantBodyIds, { includeHidden: true });

      if (targetFeature) {
        const migrated = migrateJoinCutExtrude(feature, sketch, targetFeature, occ);
        if (migrated !== feature) {
          // Suppress the target in our migration map (matches commit-time behaviour).
          const prev = migratedById.get(targetFeature.id);
          if (prev) {
            migratedById.set(targetFeature.id, {
              ...prev,
              suppressed: true,
              visible: false,
            });
          }
        }
        migratedById.set(feature.id, migrated);
      } else {
        // No OCC target available — leave for CSG pipeline.
        migratedById.set(feature.id, feature);
      }
    } else {
      migratedById.set(feature.id, feature);
    }
  }

  // Rebuild the output array in ORIGINAL order, substituting migrated features.
  return features.map((f) => migratedById.get(f.id) ?? f);
}

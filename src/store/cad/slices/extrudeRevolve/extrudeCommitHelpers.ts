import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sketch, SketchEntity } from '../../../../types/cad';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { createOccPlaneFrameFromSketch, type OccPlaneFrame } from '../../../../engine/occ/plane';
import { occExtrudeFaceShapeWithInstance, type OccExtrudeOptions } from '../../../../engine/occ/ops/extrude';
import { makeBRepBodyFromOccShape, type BRepBody } from '../../../../engine/occ/brepBody';
import {
  performOccBooleanWithRawTool,
  performOccBooleanWithInstance,
  type OccBooleanOptions,
  type OccBooleanOperation,
} from '../../../../engine/occ/ops/booleanCore';
import { pointLoopToWire, takeOccOwnedResources, wireToFace, type SketchProfile } from '../../../../engine/occ/ops/sketchToWire';
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

/**
 * Extract profile points from a THREE.Shape or THREE.Path for the OCC pipeline.
 *
 * For shapes produced by computeAtomicRegions (all-LineCurve paths built from
 * simplifyRing output), extract the actual control-point corners directly from
 * shape.curves instead of re-sampling with getPoints(96). Re-sampling a
 * 4-corner rectangle to 97 points produces 97 collinear edges on the straight
 * sides; BRepPrimAPI_MakePrism_1 then sweeps each into a separate coplanar face,
 * which can confuse BRepMesh_IncrementalMesh_2 and produce null triangulations
 * (silently skipped in tessellate.ts → visually missing faces). Using the raw
 * corners (4 for a rectangle, ~64 for a Clipper2-sampled circle) gives a clean
 * minimal-edge wire and proper rectangular lateral faces.
 *
 * Falls back to getPoints(OCC_PROFILE_POINT_COUNT) for shapes with arc/spline
 * curves that need parametric sampling.
 */
function getShapeProfilePoints(shape: THREE.Shape | THREE.Path): THREE.Vector2[] {
  if (
    shape.curves.length > 0 &&
    shape.curves.every((c) => c.type === 'LineCurve')
  ) {
    const points: THREE.Vector2[] = [];
    for (const curve of shape.curves) {
      const lc = curve as unknown as { v1: THREE.Vector2; v2: THREE.Vector2 };
      points.push(lc.v1.clone());
    }
    // The closing segment is implicit in THREE.Shape/Path. If the last LineCurve's
    // endpoint doesn't coincide with the first point, add it as the final vertex.
    const lastCurve = shape.curves[shape.curves.length - 1] as unknown as { v2: THREE.Vector2 };
    if (lastCurve.v2.distanceTo(points[0]) > 1e-10) {
      points.push(lastCurve.v2.clone());
    }
    return points;
  }
  return shape.getPoints(OCC_PROFILE_POINT_COUNT);
}

export function makeSketchProfileFromShape(
  shape: THREE.Shape,
  includeHoles = true,
): SketchProfile {
  return {
    outer: getShapeProfilePoints(shape),
    holes: includeHoles
      ? shape.holes.map((hole) => getShapeProfilePoints(hole))
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

/**
 * Find the source-sketch circle entity that matches a single closed polygonal
 * loop (outer of a THREE.Shape or one of its holes).  Score = (area error) +
 * (center error), normalised to expected radius; both must be within 8 %.
 *
 * The polygonal loop is the result of getShapeProfilePoints — for circles it is
 * a ~64-point regular polygon; for rectangles only 4 points.  The 8-point lower
 * bound filters out non-circle loops.
 */
function findMatchingCircleEntityForLoop(
  sourceSketch: Sketch,
  loop: readonly THREE.Vector2[],
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): SketchEntity | null {
  if (loop.length < 8) return null;
  const area = polygonArea2D(loop);
  const center = new THREE.Vector2();
  for (const point of loop) center.add(point);
  if (loop.length > 0) center.multiplyScalar(1 / loop.length);

  let best: { entity: SketchEntity; score: number } | null = null;
  let nearest: { areaError: number; centerError: number; radius: number } | null = null;
  for (const entity of sourceSketch.entities) {
    if (entity.type !== 'circle' || typeof entity.radius !== 'number' || entity.radius <= 0 || !entity.points[0]) continue;
    const expectedArea = Math.PI * entity.radius * entity.radius;
    const areaError = Math.abs(area - expectedArea) / Math.max(expectedArea, 1e-6);
    const circleCenter = projectSketchPointToFrame(entity.points[0], frame);
    const centerError = circleCenter.distanceTo(center) / Math.max(entity.radius, 1);
    if (!nearest || areaError + centerError < nearest.areaError + nearest.centerError) {
      nearest = { areaError, centerError, radius: entity.radius };
    }
    if (areaError > 0.08) continue;
    if (centerError > 0.08) continue;
    const score = areaError + centerError;
    if (!best || score < best.score) best = { entity, score };
  }
  return best?.entity ?? null;
}

/**
 * Find a rectangle entity whose bounding box matches the tessellated loop.
 * Used to replace polygon outer loops with clean 4-edge rectangle wires so
 * rect-with-hole profiles produce analytically correct BRep bodies.
 */
function findMatchingRectangleEntityForLoop(
  sourceSketch: Sketch,
  loop: readonly THREE.Vector2[],
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): SketchEntity | null {
  if (loop.length < 3) return null;

  // Compute bounding box AND area of loop points in UV space.
  // Area check is critical: a D-shape (arc + line) has the same bounding box as
  // its enclosing rectangle but a different area, so we guard against false matches.
  let loopMinX = Infinity, loopMaxX = -Infinity, loopMinY = Infinity, loopMaxY = -Infinity;
  for (const p of loop) {
    if (p.x < loopMinX) loopMinX = p.x;
    if (p.x > loopMaxX) loopMaxX = p.x;
    if (p.y < loopMinY) loopMinY = p.y;
    if (p.y > loopMaxY) loopMaxY = p.y;
  }
  const loopW = loopMaxX - loopMinX;
  const loopH = loopMaxY - loopMinY;
  if (loopW < 1e-10 || loopH < 1e-10) return null;
  const loopCx = loopMinX + loopW / 2;
  const loopCy = loopMinY + loopH / 2;
  const loopArea = polygonArea2D(loop);

  for (const entity of sourceSketch.entities) {
    // Rectangles are stored as 2 diagonal corners; 4-corner storage is also accepted.
    if (entity.isConstruction || entity.type !== 'rectangle' || entity.points.length < 2) continue;
    let entMinX = Infinity, entMaxX = -Infinity, entMinY = Infinity, entMaxY = -Infinity;
    for (const pt of entity.points) {
      const uv = projectSketchPointToFrame(pt, frame);
      if (uv.x < entMinX) entMinX = uv.x;
      if (uv.x > entMaxX) entMaxX = uv.x;
      if (uv.y < entMinY) entMinY = uv.y;
      if (uv.y > entMaxY) entMaxY = uv.y;
    }
    const entW = entMaxX - entMinX;
    const entH = entMaxY - entMinY;
    if (entW < 1e-10 || entH < 1e-10) continue;
    const entCx = entMinX + entW / 2;
    const entCy = entMinY + entH / 2;
    const entArea = entW * entH;

    const wErr = Math.abs(entW - loopW) / loopW;
    const hErr = Math.abs(entH - loopH) / loopH;
    const cxErr = Math.abs(entCx - loopCx) / loopW;
    const cyErr = Math.abs(entCy - loopCy) / loopH;
    // Area check: a true rectangle has loopArea ≈ entW*entH.
    // Non-rectangular loops (D-shapes, slot outlines, etc.) have different areas
    // even when their bounding boxes coincide with the rectangle entity.
    const areaErr = Math.abs(loopArea - entArea) / Math.max(entArea, 1e-6);

    if (wErr < 0.08 && hErr < 0.08 && cxErr < 0.08 && cyErr < 0.08 && areaErr < 0.08) {
      return entity;
    }
  }
  return null;
}

function findMatchingCircularProfileEntity(
  sourceSketch: Sketch,
  profile: SketchProfile,
  frame: ReturnType<typeof createOccPlaneFrameFromSketch>,
): SketchEntity | null {
  if (profile.holes.length > 0) return null;
  return findMatchingCircleEntityForLoop(sourceSketch, profile.outer, frame);
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

/**
 * Build an analytical extrude body where any loop matching a circle entity in
 * the source sketch uses an exact `GC_MakeCircle_2` edge instead of an N-segment
 * polygon approximation.
 *
 * Polygon-approximated circles cause ~726 BRep edges on a box-with-holes,
 * making BRepFilletAPI_MakeFillet.IsDone()=false and producing visual iso-lines
 * on the resulting cylindrical surfaces.  Using `Geom_Circle` edges produces a
 * clean 3-edges-per-cylindrical-face body (top ring, bottom ring, seam).
 *
 * Both the outer profile AND each hole are tested independently:
 *   - circle entity found → analytical edge via sketchEntitiesToWire
 *   - no circle entity     → polygonal pointLoopToWire as before
 *
 * Returns null if NO loop matched a circle and the polygonal path would have
 * produced an identical result — the caller falls back to occExtrudeWithInstance.
 */
export function tryBuildAnalyticalExtrudeBody(
  oc: unknown,
  sourceSketch: Sketch,
  shape: THREE.Shape,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions,
): BRepBody | null {
  const toWorld = (uv: THREE.Vector2): THREE.Vector3 =>
    frame.origin.clone()
      .addScaledVector(frame.uDir, uv.x)
      .addScaledVector(frame.vDir, uv.y);

  const outerPoints = getShapeProfilePoints(shape);
  if (outerPoints.length < 3) return null;

  // Track analytical wires separately from polygonal wires for owned-resource
  // bookkeeping: pointLoopToWire stores its polygonMaker via OCC_OWNED_RESOURCES,
  // while sketchEntitiesToWire's wires have no such carrier and must be deleted
  // explicitly via the resources list passed to the extrude builder.
  const analyticalWires: unknown[] = [];
  let analyticalCount = 0;

  // ── Outer wire ──────────────────────────────────────────────────────────────
  const outerCircleEntity = findMatchingCircleEntityForLoop(sourceSketch, outerPoints, frame);
  const outerRectEntity = !outerCircleEntity
    ? findMatchingRectangleEntityForLoop(sourceSketch, outerPoints, frame)
    : null;
  let outerWire: unknown;
  if (outerCircleEntity) {
    outerWire = sketchEntitiesToWire(oc as never, [outerCircleEntity], frame);
    if (!outerWire) return null;
    analyticalWires.push(outerWire);
    analyticalCount += 1;
  } else if (outerRectEntity) {
    outerWire = sketchEntitiesToWire(oc as never, [outerRectEntity], frame);
    if (!outerWire) return null;
    analyticalWires.push(outerWire);
    analyticalCount += 1;
  } else {
    outerWire = pointLoopToWire(oc as never, outerPoints.map(toWorld));
    if (!outerWire) return null;
  }

  // ── Hole wires ──────────────────────────────────────────────────────────────
  const holeWires: unknown[] = [];
  for (const hole of shape.holes) {
    const holePoints = getShapeProfilePoints(hole);
    const holeCircleEntity = findMatchingCircleEntityForLoop(sourceSketch, holePoints, frame);
    if (holeCircleEntity) {
      const holeWire = sketchEntitiesToWire(oc as never, [holeCircleEntity], frame);
      if (!holeWire) { console.log('[analyticalCircle] bail: hole sketchEntitiesToWire returned null (circle matched but wire build failed)'); return null; }
      holeWires.push(holeWire);
      analyticalWires.push(holeWire);
      analyticalCount += 1;
    } else {
      const holeWire = pointLoopToWire(oc as never, holePoints.map(toWorld));
      if (!holeWire) { console.log('[analyticalCircle] bail: polygon hole wire build returned null'); return null; }
      holeWires.push(holeWire);
    }
  }

  // No loops became analytical — the polygonal path would produce the same
  // result.  Bail so the caller's standard path runs (avoids duplicate work).
  if (analyticalCount === 0) return null;

  try {
    const face = wireToFace(oc as never, outerWire, holeWires, frame);
    if (!face) { console.log('[analyticalCircle] bail: wireToFace returned null (mixed polygon-outer + analytic-hole face build failed)'); return null; }

    // takeOccOwnedResources transfers each polygonal wire's polygonMaker (set
    // via OCC_OWNED_RESOURCES inside pointLoopToWire) into profileResources.
    // Analytical wires have no carrier and must be deleted explicitly after
    // the prism is built — add them here.
    const profileResources = [
      ...takeOccOwnedResources(face),
      ...(analyticalWires as Array<{ delete?: () => void }>),
    ];

    const extruded = occExtrudeFaceShapeWithInstance(oc as never, face, distance, frame, options, profileResources);
    let consumed = false;
    try {
      const body = makeBRepBodyFromOccShape(oc as never, extruded.shape, {
        id: options.id,
        sourceFeatureId: options.sourceFeatureId,
        ownedResources: extruded.ownedResources,
      });
      consumed = true;
      return body;
    } finally {
      if (!consumed) extruded.dispose();
    }
  } catch {
    return null;
  }
}

/**
 * Build an exact OCC extrude from profile sketch entities that include arc curves.
 *
 * When a closed profile contains arc entities (e.g. half-circle = arc + closing line),
 * `sketchEntitiesToWire` produces exact GC_MakeArcOfCircle_4 edges — one OCC edge
 * per arc. The polygon path (`pointLoopToWire`) produces N tiny straight edges for
 * the same arc, which appear as separate selectable edges in the fillet picker and
 * cause `BRepFilletAPI_MakeFillet.Build()` to corrupt topology for any other fillet
 * features on the body.
 *
 * Only used for profiles without holes. Returns null on any failure so the caller
 * falls back to the existing circle-detection or polygon path.
 */
export function tryBuildAnalyticalExtrudeBodyFromEntities(
  oc: unknown,
  entities: SketchEntity[],
  hasHoles: boolean,
  distance: number,
  frame: OccPlaneFrame,
  options: OccExtrudeOptions,
): BRepBody | null {
  // Hole support requires entity-to-loop classification — not yet implemented.
  if (hasHoles) { console.log('[analyticalArc] bail: hasHoles (hole support not implemented)'); return null; }
  const nonConstruction = entities.filter((e) => !e.isConstruction);
  // Only activate when at least one arc is present; other entity types are handled
  // correctly by the polygon path or the circle-detection path.
  if (!nonConstruction.some((e) => e.type === 'arc')) { console.log('[analyticalArc] bail: no arc entity in profile'); return null; }

  let outerWire: unknown;
  try {
    outerWire = sketchEntitiesToWire(oc as never, nonConstruction, frame);
  } catch (e) {
    console.log(`[analyticalArc] bail: sketchEntitiesToWire threw (${nonConstruction.length} entities) —`, e);
    return null;
  }
  if (!outerWire) { console.log(`[analyticalArc] bail: sketchEntitiesToWire returned null (${nonConstruction.length} entities, likely not one closed loop)`); return null; }

  // Follow the same pattern as tryBuildAnalyticalExtrudeBody:
  //   wireToFace → takeOccOwnedResources (gets faceMaker) → add outerWire explicitly
  //   → occExtrudeFaceShapeWithInstance with combined profileResources.
  try {
    const face = wireToFace(oc as never, outerWire, [], frame);
    if (!face) {
      console.log('[analyticalArc] bail: wireToFace returned null (wire not a valid face boundary)');
      (outerWire as { delete?: () => void }).delete?.();
      return null;
    }
    const profileResources: Array<{ delete?: () => void }> = [
      ...takeOccOwnedResources(face),              // faceMaker (and any polygon makers — none here)
      outerWire as { delete?: () => void },         // analytical wire has no OCC_OWNED_RESOURCES carrier
    ];
    const extruded = occExtrudeFaceShapeWithInstance(oc as never, face, distance, frame, options, profileResources);
    let consumed = false;
    try {
      const body = makeBRepBodyFromOccShape(oc as never, extruded.shape, {
        id: options.id,
        sourceFeatureId: options.sourceFeatureId,
        ownedResources: extruded.ownedResources,
      });
      consumed = true;
      return body;
    } finally {
      if (!consumed) extruded.dispose();
    }
  } catch (e) {
    console.log('[analyticalArc] bail: extrude/face build threw —', e);
    return null;
  }
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

import * as THREE from 'three';
import { getOcc } from '../../../occ/loader';
import { createOccPlaneFrame } from '../../../occ/plane';
import { occSweepFromPathWireWithInstance } from '../../../occ/ops/sweep';
import { performOccBooleanWithInstance } from '../../../occ/ops/booleanCore';
import { tessellateWithInstance, tessellationToGeometry } from '../../../occ/tessellate';
import type { SketchProfile } from '../../../occ/ops/sketchToWire';

/**
 * Build an open (non-closing) TopoDS_Wire polyline from 3-D world-space points.
 * Mirrors the logic in pointLoopToWire (sketchToWire.ts) but omits the
 * wrap-around closing edge so the wire represents an open path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOpenPolylineWire(oc: any, points: THREE.Vector3[]): any | null {
  if (points.length < 2) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wireMaker: any = new oc.BRepBuilderAPI_MakeWire_1();
  let edgeCount = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.distanceToSquared(b) < 1e-12) continue;

    const pa = new oc.gp_Pnt_3(a.x, a.y, a.z);
    const pb = new oc.gp_Pnt_3(b.x, b.y, b.z);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeMaker = new (oc as any).BRepBuilderAPI_MakeEdge_3(pa, pb);
    pa.delete();
    pb.delete();

    if (!edgeMaker.IsDone()) { edgeMaker.delete(); continue; }
    wireMaker.Add_1(edgeMaker.Edge());
    edgeMaker.delete();
    edgeCount += 1;
  }

  if (edgeCount < 1 || !wireMaker.IsDone()) {
    wireMaker.delete();
    return null;
  }

  const wire = wireMaker.Wire();
  wireMaker.delete();
  return wire;
}

/** Approximate a circle of `radius` as an N-sided polygon (2-D UV coords, CCW). */
function circleProfile(radius: number, segments: number): SketchProfile {
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    outer.push(new THREE.Vector2(Math.cos(theta) * radius, Math.sin(theta) * radius));
  }
  return { outer, holes: [] };
}

/** Square profile: circumradius = half of outerDiameter. */
function squareProfile(radius: number): SketchProfile {
  const s = radius; // half-side diagonal = radius when corner-to-corner = diameter
  const h = s * Math.SQRT1_2; // half-side length: h = r / sqrt(2) → edge = r*sqrt(2)
  return {
    outer: [
      new THREE.Vector2(-h, -h),
      new THREE.Vector2(h, -h),
      new THREE.Vector2(h, h),
      new THREE.Vector2(-h, h),
    ],
    holes: [],
  };
}

/** Equilateral triangle profile: circumradius = radius. */
function triangleProfile(radius: number): SketchProfile {
  const outer: THREE.Vector2[] = [];
  for (let i = 0; i < 3; i++) {
    const theta = (i / 3) * Math.PI * 2 - Math.PI / 2;
    outer.push(new THREE.Vector2(Math.cos(theta) * radius, Math.sin(theta) * radius));
  }
  return { outer, holes: [] };
}

function buildSectionProfile(outerRadius: number, sectionType: 'circular' | 'square' | 'triangular'): SketchProfile {
  if (sectionType === 'square') return squareProfile(outerRadius);
  if (sectionType === 'triangular') return triangleProfile(outerRadius);
  return circleProfile(outerRadius, 32);
}

/** Remove consecutive path points closer than 1 µm. */
function dedupePath(points: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [points[0].clone()];
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceTo(out[out.length - 1]) > 1e-3) out.push(points[i].clone());
  }
  return out;
}

/** Tessellate a BRepBody to BufferGeometry and dispose it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tessToGeo(oc: any, body: any): THREE.BufferGeometry {
  const tess = tessellateWithInstance(oc, body);
  const geo = tessellationToGeometry(tess);
  body.dispose();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a solid (or hollow) pipe by sweeping a circular cross-section along a
 * CatmullRom-smoothed polyline path via BRepOffsetAPI_MakePipe.
 *
 * Path: the world-space `points` array is deduplicated, then a CatmullRomCurve3
 * is sampled at the same resolution the old TubeGeometry used
 * (max(48, nPts×12) segments) so curved paths remain smooth.
 *
 * Hollow bore: a slightly-extended inner tube (0.5 mm past each end face) is
 * OCC-subtracted from the outer solid so both caps open cleanly — same geometry
 * as the old csgSubtractWithTopology approach without any three-bvh-csg dependency.
 *
 * The returned BufferGeometry is in world space; the commit action wraps it in a
 * mesh and stores it on the feature so ExtrudedBodies renders it via stored-mesh path.
 */
export async function pipeGeometry(
  points: THREE.Vector3[],
  outerDiameter: number,
  hollow: boolean,
  wallThickness: number,
  sectionType: 'circular' | 'square' | 'triangular' = 'circular',
): Promise<THREE.BufferGeometry> {
  const { oc } = await getOcc();

  const outerRadius = Math.max(0.05, outerDiameter / 2);
  const rawPath = points.length >= 2
    ? points
    : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 50, 0)];

  const deduped = dedupePath(rawPath);
  if (deduped.length < 2) {
    deduped.push(deduped[0].clone().add(new THREE.Vector3(0, 10, 0)));
  }

  // Sample CatmullRom at the same resolution the old TubeGeometry used.
  const curve = new THREE.CatmullRomCurve3(deduped, false, 'centripetal');
  const tubularSegments = Math.max(48, deduped.length * 12);
  const sampled = curve.getPoints(tubularSegments); // tubularSegments+1 points

  const startTangent = sampled[1].clone().sub(sampled[0]).normalize();
  const endTangent   = sampled[sampled.length - 1].clone()
    .sub(sampled[sampled.length - 2]).normalize();

  // ── Outer pipe ─────────────────────────────────────────────────────────────
  const outerPathWire = buildOpenPolylineWire(oc, sampled);
  if (!outerPathWire) throw new Error('[pipeGeometry] failed to build OCC path wire');

  // Profile frame: origin at path start, normal = start tangent (sweep direction).
  // createOccPlaneFrame auto-picks a perpendicular uDir when no uHint is given.
  const outerFrame = createOccPlaneFrame(sampled[0], startTangent);
  const outerProfile = buildSectionProfile(outerRadius, sectionType);

  const outerBody = occSweepFromPathWireWithInstance(oc, outerProfile, outerFrame, outerPathWire);
  outerPathWire.delete();

  if (!hollow) {
    return tessToGeo(oc, outerBody);
  }

  // ── Hollow bore ────────────────────────────────────────────────────────────
  const innerRadius = outerRadius - Math.max(0.01, wallThickness);
  if (innerRadius <= 1e-3) {
    // Wall too thick to bore — return solid outer.
    return tessToGeo(oc, outerBody);
  }

  // Extend the inner bore 0.5 mm past each end face so the OCC subtract opens
  // both caps cleanly (avoids coplanar-face artifacts).
  const innerSampled = sampled.map((p) => p.clone());
  innerSampled[0].addScaledVector(startTangent, -0.5);
  innerSampled[innerSampled.length - 1].addScaledVector(endTangent, 0.5);

  const innerPathWire = buildOpenPolylineWire(oc, innerSampled);
  if (!innerPathWire) {
    // Degenerate inner path — return solid outer as fallback.
    return tessToGeo(oc, outerBody);
  }

  const innerStartTangent = innerSampled[1].clone().sub(innerSampled[0]).normalize();
  const innerFrame = createOccPlaneFrame(innerSampled[0], innerStartTangent);
  const innerProfile = circleProfile(innerRadius, 32);

  const innerBody = occSweepFromPathWireWithInstance(oc, innerProfile, innerFrame, innerPathWire);
  innerPathWire.delete();

  const boredBody = performOccBooleanWithInstance(oc, 'subtract', outerBody, innerBody);
  innerBody.dispose();
  outerBody.dispose();

  if (!boredBody) throw new Error('[pipeGeometry] OCC bore subtract failed');

  return tessToGeo(oc, boredBody);
}

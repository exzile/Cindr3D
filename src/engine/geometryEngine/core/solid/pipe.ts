import * as THREE from 'three';
import { csgSubtract } from './csg';

/**
 * Builds a solid pipe by sweeping a circular profile of `radius` along a path
 * polyline (a `CatmullRomCurve3` through the supplied points). The tube is
 * capped at both ends so the result is a closed solid (CSG-ready). When fewer
 * than two distinct points are supplied the caller is expected to pass a
 * straight fallback segment.
 *
 * The returned geometry is a plain `THREE.BufferGeometry` in world space — the
 * commit action wraps it in a mesh and stores it on the feature, which
 * `ExtrudedBodies` renders via its stored-mesh path.
 */
function buildSolidTube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  // Dedupe coincident path points (mirrors sweepSketchInternal) so the
  // CatmullRom curve doesn't blow up on repeated vertices.
  const deduped: THREE.Vector3[] = [points[0].clone()];
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceTo(deduped[deduped.length - 1]) > 1e-3) deduped.push(points[i].clone());
  }
  if (deduped.length < 2) {
    // Degenerate path — extend straight up so we still produce a real solid.
    deduped.push(deduped[0].clone().add(new THREE.Vector3(0, 10, 0)));
  }

  const curve = new THREE.CatmullRomCurve3(deduped, false, 'centripetal');
  const tubularSegments = Math.max(48, deduped.length * 12);
  const radialSegments = 32;
  const tube = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);

  // TubeGeometry is an open shell; weld the wall, then add triangle-fan caps
  // at the first and last rings so the body is a watertight solid.
  const wall = tube.toNonIndexed();
  tube.dispose();
  const pos = wall.getAttribute('position') as THREE.BufferAttribute;
  const positions: number[] = Array.from(pos.array as Float32Array);

  const startCenter = curve.getPointAt(0);
  const endCenter = curve.getPointAt(1);
  const startRing: THREE.Vector3[] = [];
  const endRing: THREE.Vector3[] = [];
  // Sample the cap ring positions from the curve's end frames so the caps
  // line up exactly with TubeGeometry's swept wall (same parametrisation).
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * Math.PI * 2;
    const sin = Math.sin(v);
    const cos = -Math.cos(v);
    const n0 = frames.normals[0];
    const b0 = frames.binormals[0];
    startRing.push(new THREE.Vector3(
      startCenter.x + radius * (cos * n0.x + sin * b0.x),
      startCenter.y + radius * (cos * n0.y + sin * b0.y),
      startCenter.z + radius * (cos * n0.z + sin * b0.z),
    ));
    const nE = frames.normals[frames.normals.length - 1];
    const bE = frames.binormals[frames.binormals.length - 1];
    endRing.push(new THREE.Vector3(
      endCenter.x + radius * (cos * nE.x + sin * bE.x),
      endCenter.y + radius * (cos * nE.y + sin * bE.y),
      endCenter.z + radius * (cos * nE.z + sin * bE.z),
    ));
  }
  // Start cap (fan toward start centre, wound inward).
  for (let j = 0; j < radialSegments; j++) {
    positions.push(startCenter.x, startCenter.y, startCenter.z);
    positions.push(startRing[j + 1].x, startRing[j + 1].y, startRing[j + 1].z);
    positions.push(startRing[j].x, startRing[j].y, startRing[j].z);
  }
  // End cap (opposite winding).
  for (let j = 0; j < radialSegments; j++) {
    positions.push(endCenter.x, endCenter.y, endCenter.z);
    positions.push(endRing[j].x, endRing[j].y, endRing[j].z);
    positions.push(endRing[j + 1].x, endRing[j + 1].y, endRing[j + 1].z);
  }
  wall.dispose();

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Pipe solid: sweeps an outer circular profile along `points`. When `hollow`
 * is set an inner tube of radius `outerRadius - wallThickness` is subtracted
 * (CSG) so the result is a true hollow pipe with a bore. Falls back to a
 * straight vertical pipe when the path has too few points.
 */
export function pipeGeometry(
  points: THREE.Vector3[],
  outerDiameter: number,
  hollow: boolean,
  wallThickness: number,
): THREE.BufferGeometry {
  const outerRadius = Math.max(0.05, outerDiameter / 2);
  const path = points.length >= 2
    ? points
    : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 50, 0)];

  const outer = buildSolidTube(path, outerRadius);
  if (!hollow) return outer;

  const innerRadius = outerRadius - Math.max(0.01, wallThickness);
  if (innerRadius <= 1e-3) return outer; // wall too thick to bore — keep solid

  // Slightly overshoot the bore beyond the ends so CSG cleanly opens both
  // faces instead of leaving razor-thin coplanar slivers.
  const dir = path[1].clone().sub(path[0]).normalize();
  const extended = path.map((p) => p.clone());
  extended[0].addScaledVector(dir, -0.5);
  extended[extended.length - 1].addScaledVector(dir, 0.5);
  const inner = buildSolidTube(extended, innerRadius);

  const bored = csgSubtract(outer, inner);
  outer.dispose();
  inner.dispose();
  return bored;
}

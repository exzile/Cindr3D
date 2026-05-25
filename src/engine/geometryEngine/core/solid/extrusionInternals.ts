import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { circleSegments } from '../sketch/sketchProfiles';

/**
 * Walk a Shape's underlying curves (outer ring + hole rings) and return
 * the curveSegments value that keeps every arc/ellipse within a small
 * chord-arc tolerance. THREE.ExtrudeGeometry defaults to `curveSegments:
 * 12` which renders a 50 mm hole as a dodecagon — the visible facets
 * the user complained about. By probing each `EllipseCurve` and using
 * `circleSegments(maxRadius)` we get true round circles in the slicer
 * mesh + downstream toolpath preview. Falls back to 64 for non-arc
 * shapes (rectangles, polygons, splines) which already have explicit
 * vertices.
 */
export function adaptiveCurveSegments(shape: THREE.Shape): number {
  let maxR = 0;
  const probe = (path: THREE.Path) => {
    for (const curve of path.curves) {
      // EllipseCurve covers both circles (xRadius == yRadius) and
      // proper ellipses. Use the larger axis for the worst-case arc.
      if (curve instanceof THREE.EllipseCurve) {
        const r = Math.max(curve.xRadius, curve.yRadius);
        if (r > maxR) maxR = r;
      }
    }
  };
  probe(shape);
  for (const hole of shape.holes) probe(hole);
  return maxR > 0 ? circleSegments(maxR) : 64;
}

function removeDegenerateTriangles(
  geometry: THREE.BufferGeometry,
  relAreaThreshold = 0.01,
): THREE.BufferGeometry {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const areas: number[] = [];
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    areas.push(cross.length() * 0.5);
  }

  const sorted = [...areas].sort((lhs, rhs) => lhs - rhs);
  const medianArea = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const areaCutoff = medianArea * relAreaThreshold;

  const nextPositions: number[] = [];
  for (let i = 0; i < count; i += 3) {
    if (areas[i / 3] < areaCutoff) continue;
    for (let k = 0; k < 3; k++) {
      a.fromBufferAttribute(pos, i + k);
      nextPositions.push(a.x, a.y, a.z);
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3));
  result.computeVertexNormals();
  return result;
}

function toNonIndexedGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.index ? geometry.toNonIndexed() : geometry.clone();
}

export function buildExtrudeGeomHolesAware(
  shapes: THREE.Shape[],
  extrudeSettings: THREE.ExtrudeGeometryOptions,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  for (const shape of shapes) {
    // ExtrudeGeometry's default curveSegments=12 makes circles look
    // polygonal in the slice. Override per-shape to keep arcs round.
    const shapeSettings: THREE.ExtrudeGeometryOptions = {
      curveSegments: adaptiveCurveSegments(shape),
      ...extrudeSettings,
    };

    if (shape.holes.length === 0) {
      const geometry = new THREE.ExtrudeGeometry(shape, shapeSettings);
      const nonIndexed = toNonIndexedGeometry(geometry);
      geometry.dispose();
      parts.push(removeDegenerateTriangles(nonIndexed));
      nonIndexed.dispose();
      continue;
    }

    // Resample the outer ring at adaptive density and attach holes as
    // THREE.Paths so ExtrudeGeometry triangulates them natively — no CSG needed.
    const outerSegs = adaptiveCurveSegments(shape);
    const outerShape = new THREE.Shape(shape.getPoints(outerSegs));

    for (const holePath of shape.holes) {
      // Adaptive arc density per hole — keeps circular holes round.
      let holeMaxR = 0;
      for (const c of holePath.curves) {
        if (c instanceof THREE.EllipseCurve) {
          const r = Math.max(c.xRadius, c.yRadius);
          if (r > holeMaxR) holeMaxR = r;
        }
      }
      const holeSegs = holeMaxR > 0 ? circleSegments(holeMaxR) : 64;
      outerShape.holes.push(new THREE.Path(holePath.getPoints(holeSegs)));
    }

    const outerRaw = new THREE.ExtrudeGeometry(outerShape, shapeSettings);
    const outerNonIndexed = toNonIndexedGeometry(outerRaw);
    outerRaw.dispose();
    const solid = removeDegenerateTriangles(outerNonIndexed);
    outerNonIndexed.dispose();
    parts.push(solid);
  }

  if (parts.length === 1) {
    const merged = mergeVertices(parts[0], 1e-4);
    parts[0].dispose();
    return toCreasedNormals(merged, Math.PI / 6);
  }

  // Multi-part case (sketch with several disconnected outer profiles):
  // concatenate triangle soup, weld, recompute creases.
  const totalCount = parts.reduce((sum, geometry) => sum + geometry.attributes.position.count, 0);
  const mergedPositions = new Float32Array(totalCount * 3);
  let offset = 0;
  for (const geometry of parts) {
    const arr = (geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    mergedPositions.set(arr, offset);
    offset += arr.length;
    geometry.dispose();
  }
  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));
  const merged = mergeVertices(combined, 1e-4);
  combined.dispose();
  return toCreasedNormals(merged, Math.PI / 6);
}

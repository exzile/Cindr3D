import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { csgSubtract } from './csg';
import { circleSegments } from '../sketch/sketchProfiles';
import { getManifoldModule } from './manifoldWasm';

/**
 * Manifold-native extrude — converts a single THREE.Shape (outer + holes) to a
 * Manifold body via `Manifold.extrude(polygons, height)`.  The result mesh is
 * GUARANTEED manifold and carries `_manifoldData` so subsequent CSG operations
 * (fillet, chamfer, shell, boolean) hit the fast path back into Manifold and
 * stay in the exact-arithmetic kernel end-to-end — no figure-8 bridging
 * artefacts, no BVH sliver spikes.
 *
 * Replaces `new THREE.ExtrudeGeometry(shape, {...})` which produces non-
 * manifold output (bridging vertex at holes, T-junctions on side faces)
 * that fails Manifold validation and forces every downstream CSG onto BVH.
 *
 * Returns null when Manifold WASM isn't yet loaded or the cross-section is
 * degenerate so the caller falls back to the THREE.ExtrudeGeometry path.
 */
function buildShapeManifold(
  shape: THREE.Shape,
  depth: number,
  outerSegments: number,
): THREE.BufferGeometry | null {
  const wasm = getManifoldModule();
  if (!wasm) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ManifoldCtor = (wasm as any).Manifold;
  if (!ManifoldCtor) return null;

  // Outer ring at the adaptive segment density used by the legacy path.
  const outerPts = shape.getPoints(outerSegments);
  if (outerPts.length < 3) return null;
  const outerPoly: [number, number][] = outerPts.map((p) => [p.x, p.y]);

  // Each hole at its own adaptive density based on hole radius.
  const holePolys: [number, number][][] = [];
  for (const hole of shape.holes) {
    let holeMaxR = 0;
    for (const c of hole.curves) {
      if (c instanceof THREE.EllipseCurve) {
        const r = Math.max(c.xRadius, c.yRadius);
        if (r > holeMaxR) holeMaxR = r;
      }
    }
    const holeSegs = holeMaxR > 0 ? circleSegments(holeMaxR) : 64;
    const holePts = hole.getPoints(holeSegs);
    if (holePts.length < 3) continue;
    holePolys.push(holePts.map((p) => [p.x, p.y]));
  }

  // Manifold expects polygons as [outer, hole1, hole2, ...] with EvenOdd
  // fill-rule resolving outer-vs-hole regardless of winding.  Pre-built
  // explicitly so we don't depend on THREE.Path's winding convention.
  const polygons: [number, number][][] = [outerPoly, ...holePolys];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let m: any = null;
  try {
    m = ManifoldCtor.extrude(polygons, depth);
    // Manifold.extrude returns an empty manifold when the cross-section is
    // self-intersecting or degenerate; bail so caller can fall back.
    if (typeof m.isEmpty === 'function' && m.isEmpty()) {
      if (typeof m.delete === 'function') m.delete();
      return null;
    }
    return _fromManifoldExtrude(m); // also deletes m
  } catch (err) {
    console.warn('[extrude] Manifold-native extrude failed, falling back:', err);
    try { if (m && typeof m.delete === 'function') m.delete(); } catch {}
    return null;
  }
}

/**
 * Convert a Manifold extrude result to a Three.js BufferGeometry with the
 * `_manifoldData` cache attached so the next CSG roundtrip skips mergeVertices.
 *
 * Mirrors `_fromManifold` in csg.ts but kept here to avoid an import cycle —
 * csg.ts already imports from this module via the existing extrude pipeline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _fromManifoldExtrude(result: any): THREE.BufferGeometry {
  const mesh = result.getMesh() as { vertProperties: Float32Array; triVerts: Uint32Array };
  const vpCopy = new Float32Array(mesh.vertProperties);
  const tvCopy = new Uint32Array(mesh.triVerts);

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vpCopy), 3));
  indexed.setIndex(new THREE.BufferAttribute(new Uint32Array(tvCopy), 1));
  const nonIndexed = indexed.toNonIndexed();
  nonIndexed.computeVertexNormals();
  indexed.dispose();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nonIndexed.userData as any)._manifoldData = { vertProperties: vpCopy, triVerts: tvCopy };
  if (typeof result.delete === 'function') result.delete();
  return nonIndexed;
}

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

  // Reject the Manifold-native path for extrude settings it can't model —
  // taper (scaleTop), twist, custom step counts mid-extrude, beveling, and
  // extrudePath all need the THREE.ExtrudeGeometry pipeline.  Plain
  // straight extrudes (the overwhelmingly common case) take the native path.
  const settingsAreNativeCompatible =
    !extrudeSettings.bevelEnabled &&
    !extrudeSettings.extrudePath &&
    (extrudeSettings.steps == null || extrudeSettings.steps === 1) &&
    typeof extrudeSettings.depth === 'number' &&
    extrudeSettings.depth > 0;

  for (const shape of shapes) {
    // ExtrudeGeometry's default curveSegments=12 makes circles look
    // polygonal in the slice. Override per-shape to keep arcs round.
    const shapeSettings: THREE.ExtrudeGeometryOptions = {
      curveSegments: adaptiveCurveSegments(shape),
      ...extrudeSettings,
    };

    // Manifold-native fast path — guaranteed-manifold output, no figure-8
    // bridging, no T-junctions, _manifoldData baked in for downstream CSG.
    if (settingsAreNativeCompatible) {
      const outerSegs = adaptiveCurveSegments(shape);
      const native = buildShapeManifold(shape, extrudeSettings.depth as number, outerSegs);
      if (native) {
        parts.push(native);
        continue;
      }
      // Fall through to the legacy THREE.ExtrudeGeometry path on any failure.
    }

    if (shape.holes.length === 0) {
      const geometry = new THREE.ExtrudeGeometry(shape, shapeSettings);
      const nonIndexed = toNonIndexedGeometry(geometry);
      geometry.dispose();
      parts.push(removeDegenerateTriangles(nonIndexed));
      nonIndexed.dispose();
      continue;
    }

    // Resample the outer ring (with its arcs) at the same adaptive
    // density as the original — keeps holes-aware extrudes (circles
    // with circular holes) looking round.
    const outerSegs = adaptiveCurveSegments(shape);
    const outerShape = new THREE.Shape(shape.getPoints(outerSegs));
    const outerRaw = new THREE.ExtrudeGeometry(outerShape, shapeSettings);
    const outerNonIndexed = toNonIndexedGeometry(outerRaw);
    outerRaw.dispose();
    let solid = removeDegenerateTriangles(outerNonIndexed);
    outerNonIndexed.dispose();

    for (const holePath of shape.holes) {
      // Sample each hole's curves at an adaptive density driven by the
      // largest arc in that hole — circular holes stay round.
      let holeMaxR = 0;
      for (const c of holePath.curves) {
        if (c instanceof THREE.EllipseCurve) {
          const r = Math.max(c.xRadius, c.yRadius);
          if (r > holeMaxR) holeMaxR = r;
        }
      }
      const holeSegs = holeMaxR > 0 ? circleSegments(holeMaxR) : 64;
      const holeShape = new THREE.Shape(holePath.getPoints(holeSegs));
      const holeSettings: THREE.ExtrudeGeometryOptions = {
        ...extrudeSettings,
        depth: (extrudeSettings.depth ?? 1) + 0.002,
        curveSegments: holeSegs,
      };
      const holeRaw = new THREE.ExtrudeGeometry(holeShape, holeSettings);
      const holeNonIndexed = toNonIndexedGeometry(holeRaw);
      holeRaw.dispose();
      const holeGeom = removeDegenerateTriangles(holeNonIndexed);
      holeNonIndexed.dispose();
      holeGeom.translate(0, 0, -0.001);
      const subtracted = csgSubtract(solid, holeGeom);
      solid.dispose();
      holeGeom.dispose();
      solid = subtracted;
    }

    parts.push(solid);
  }

  // Single-part case: short-circuit so we don't run mergeVertices on a
  // Manifold-native geometry — that would re-merge co-positional vertices
  // and break the `_manifoldData` cache invariant, kicking downstream CSG
  // back onto the BVH path that produces the spike artefacts we just fixed.
  if (parts.length === 1) {
    const only = parts[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((only.userData as any)?._manifoldData) {
      // Already manifold + welded by Manifold; compute creased normals for
      // smooth shading on curved sides, then RE-ATTACH _manifoldData so
      // downstream CSG (fillet / chamfer) uses the Manifold fast-path.
      // toCreasedNormals only changes normals (splits vertices at crease
      // edges for rendering) — positions are unchanged, so _manifoldData
      // remains valid for Manifold re-import.  Without this re-attach the
      // body fails _toManifoldWithRepair (874-vert non-indexed mesh) and
      // every fillet falls back to BVH, producing the spike artefacts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manifoldData = (only.userData as any)._manifoldData;
      const creased = toCreasedNormals(only, Math.PI / 6);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (creased.userData as any)._manifoldData = manifoldData;
      return creased;
    }
    const merged = mergeVertices(only, 1e-4);
    only.dispose();
    return toCreasedNormals(merged, Math.PI / 6);
  }

  // Multi-part case (sketch with several disconnected outer profiles):
  // concatenate triangle soup, weld, recompute creases.  This loses any
  // per-part `_manifoldData` — downstream CSG will rebuild the manifold
  // representation via `_toManifoldWithRepair`.  Acceptable because
  // multi-profile sketches are uncommon and Manifold can repair welded
  // multi-shell input without the figure-8 artefact (no holes involved).
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

import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import type { Sketch, SketchEntity, SketchPoint, SketchPlane } from '../types/cad';
import { BODY_MATERIAL, SURFACE_MATERIAL } from '../components/viewport/scene/bodyMaterial';

// Single shared CSG evaluator — constructing one is cheap but reusing is free
const _csgEvaluator = new Evaluator();
_csgEvaluator.useGroups = false;

// Shared materials — created once, never duplicated per-entity
/**
 * Tag a module-level singleton material or geometry so disposal logic in stores
 * can recognise it and SKIP `.dispose()` — disposing a singleton turns every
 * other feature using it into a black/broken material or missing geometry.
 *
 * Materials: sets `userData.shared = true` (checked in cadStore dispose helpers).
 * Geometries: sets `_sharedResource = true` (AUDIT-19 extension).
 */
export function tagShared<T extends THREE.Material | THREE.BufferGeometry>(obj: T): T {
  (obj as { _sharedResource?: boolean })._sharedResource = true;
  if (obj instanceof THREE.Material) {
    obj.userData.shared = true;
  }
  return obj;
}

const SKETCH_MATERIAL = tagShared(new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 }));
// Construction lines: orange, short dash — reference geometry, not part of profile
const CONSTRUCTION_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
}));
// Centerlines: dark green/teal, long dash + small gap — used for symmetry/revolve axes
const CENTERLINE_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
}));
// S4: Isoparametric curves: magenta, medium dash — UV-parameter construction line on a surface
const ISOPARAMETRIC_MATERIAL = tagShared(new THREE.LineDashedMaterial({
  color: 0xcc44ff, linewidth: 1, dashSize: 0.5, gapSize: 0.25,
}));
const EXTRUDE_MATERIAL = tagShared(new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
}));

export class GeometryEngine {
  /**
   * Returns the two in-plane tangent vectors for the given sketch plane.
   * These define the 2-D coordinate system used for circles, rectangles, etc.
   *
   *   XY  (horizontal, Y-normal)  → draws in X–Z world plane
   *   XZ  (vertical front, Z-normal) → draws in X–Y world plane
   *   YZ  (vertical side, X-normal)  → draws in Y–Z world plane
   */
  static getPlaneAxes(plane: SketchPlane): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    switch (plane) {
      case 'XY': return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 0, 1) };
      case 'YZ': return { t1: new THREE.Vector3(0, 1, 0), t2: new THREE.Vector3(0, 0, 1) };
      case 'XZ': // fall-through to default
      default:   return { t1: new THREE.Vector3(1, 0, 0), t2: new THREE.Vector3(0, 1, 0) };
    }
  }

  /**
   * Compute two orthonormal in-plane tangent vectors (t1, t2) for an arbitrary
   * plane normal. Picks a temporary "up" vector that is least aligned with the
   * normal to avoid degenerate cross products.
   */
  static computePlaneAxesFromNormal(normal: THREE.Vector3): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    const n = normal.clone().normalize();
    // Pick a temp up that's least aligned with n
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const tempUp = ay <= ax && ay <= az
      ? new THREE.Vector3(0, 1, 0)
      : (ax <= az ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
    const t1 = new THREE.Vector3().crossVectors(tempUp, n).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    return { t1, t2 };
  }

  /**
   * Press-Pull boundary detection: given a hit triangle on a mesh, find every
   * coplanar triangle (same world normal + same plane offset within tolerance),
   * walk the outer edge loop, and return the boundary as ordered world points.
   *
   * Returns null if no clean closed loop can be formed (curved surfaces, faces
   * with holes, degenerate hits, etc.).
   */
  static computeCoplanarFaceBoundary(
    mesh: THREE.Mesh,
    faceIndex: number,
    tol = 1e-3,
  ): { boundary: THREE.Vector3[]; normal: THREE.Vector3; centroid: THREE.Vector3 } | null {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;

    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);

    // Read all triangles as triples of world-space vertex indices.
    // Use the index buffer if present, otherwise treat positions as flat triangles.
    const idxAttr = geom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const getTriIndices = (i: number): [number, number, number] => {
      if (idxAttr) {
        return [idxAttr.getX(i * 3), idxAttr.getX(i * 3 + 1), idxAttr.getX(i * 3 + 2)];
      }
      return [i * 3, i * 3 + 1, i * 3 + 2];
    };

    if (faceIndex < 0 || faceIndex >= triCount) return null;

    // World-space vertex cache (we'll only fill what we touch)
    const worldVerts = new Map<number, THREE.Vector3>();
    const getWorldVert = (vi: number): THREE.Vector3 => {
      let v = worldVerts.get(vi);
      if (!v) {
        v = new THREE.Vector3().fromBufferAttribute(posAttr, vi).applyMatrix4(m);
        worldVerts.set(vi, v);
      }
      return v;
    };

    // Compute the world-space normal + plane offset for the hit triangle
    const triNormal = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 => {
      const ab = b.clone().sub(a);
      const ac = c.clone().sub(a);
      return ab.cross(ac).normalize();
    };

    const [hi0, hi1, hi2] = getTriIndices(faceIndex);
    const hv0 = getWorldVert(hi0), hv1 = getWorldVert(hi1), hv2 = getWorldVert(hi2);
    const hitNormal = triNormal(hv0, hv1, hv2);
    if (hitNormal.lengthSq() < 0.5) return null; // degenerate
    const hitOffset = hitNormal.dot(hv0); // plane equation: n·p = offset

    // Bounding radius for plane-distance tolerance scaling.
    // CSG boolean results can have slight floating-point drift between triangles
    // that should be coplanar, so we use generous tolerances.
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const radius = geom.boundingSphere?.radius ?? 1;
    const planeTol = Math.max(0.01, tol * radius);

    // Find every coplanar triangle (same orientation + same plane).
    // Store triangles as triples of world-space vertex POSITIONS (not indices)
    // so geometries that duplicate verts at face boundaries still get their
    // shared edges detected correctly via position hashing below.
    const coplanarTris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
    for (let t = 0; t < triCount; t++) {
      const [a, b, c] = getTriIndices(t);
      const va = getWorldVert(a), vb = getWorldVert(b), vc = getWorldVert(c);
      const n = triNormal(va, vb, vc);
      if (n.lengthSq() < 0.5) continue;
      // Normal tolerance: cos(~10°) ≈ 0.985 — generous enough for CSG output
      if (n.dot(hitNormal) < 0.985) continue;
      const off = n.dot(va);
      if (Math.abs(off - hitOffset) > planeTol) continue;
      coplanarTris.push([va, vb, vc]);
    }
    if (coplanarTris.length === 0) return null;

    // Merge vertices at the same world position so CSG seam duplicates are
    // treated as the same vertex. Uses spatial hashing with a merge radius
    // that handles rounding-boundary ambiguity by checking distance to the
    // first vertex encountered at each grid cell.
    const MERGE_RADIUS = 0.05;
    const CELL = MERGE_RADIUS * 2;
    // Map: canonical key → position. A vertex matches an existing one if it's
    // within MERGE_RADIUS of any previously seen vertex in its cell or 26 neighbors.
    const canonicalPos = new Map<string, THREE.Vector3>();

    const keyFor = (v: THREE.Vector3): string => {
      // Check current cell + neighbors for a close-enough existing vertex
      const cx = Math.round(v.x / CELL), cy = Math.round(v.y / CELL), cz = Math.round(v.z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const nk = `${cx + dx}|${cy + dy}|${cz + dz}`;
            const existing = canonicalPos.get(nk);
            if (existing && existing.distanceTo(v) <= MERGE_RADIUS) {
              return nk;
            }
          }
        }
      }
      // New vertex — register at its cell
      const k = `${cx}|${cy}|${cz}`;
      canonicalPos.set(k, v.clone());
      return k;
    };

    // ── Fix T-junctions ──
    // CSG results can have T-junctions where a long edge A→B from one triangle
    // group passes through a vertex C used by an adjacent triangle group but
    // the edge isn't split at C. This prevents proper edge-sharing detection.
    // Solution: for each triangle edge, check if any coplanar vertex lies ON
    // the edge segment and split it. We rebuild coplanarTris with split edges.
    const allCoplanarKeys = new Set<string>();
    const keyToPos = new Map<string, THREE.Vector3>();
    for (const [va, vb, vc] of coplanarTris) {
      for (const v of [va, vb, vc]) {
        const k = keyFor(v);
        allCoplanarKeys.add(k);
        if (!keyToPos.has(k)) keyToPos.set(k, canonicalPos.get(k) ?? v.clone());
      }
    }

    // For a triangle [A, B, C], split any edge that has an intermediate coplanar
    // vertex, producing sub-triangles. We do this by replacing each triangle
    // with a fan of sub-triangles if needed.
    const splitTris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
    const EDGE_TOL = 0.06; // slightly larger than MERGE_RADIUS

    const pointOnSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): boolean => {
      const ab = b.clone().sub(a);
      const ap = p.clone().sub(a);
      const lenSq = ab.lengthSq();
      if (lenSq < 1e-8) return false;
      const t = ap.dot(ab) / lenSq;
      if (t <= EDGE_TOL / Math.sqrt(lenSq) || t >= 1 - EDGE_TOL / Math.sqrt(lenSq)) return false;
      const proj = a.clone().add(ab.multiplyScalar(t));
      return proj.distanceTo(p) < EDGE_TOL;
    };

    for (const tri of coplanarTris) {
      // Check each edge for intermediate vertices
      const triKeys = [keyFor(tri[0]), keyFor(tri[1]), keyFor(tri[2])];
      let needsSplit = false;
      const edgeMidpoints: Map<string, THREE.Vector3[]> = new Map();

      for (let ei = 0; ei < 3; ei++) {
        const a = tri[ei], b = tri[(ei + 1) % 3];
        const eKey = `${ei}`;
        const mids: THREE.Vector3[] = [];
        for (const [k, pos] of keyToPos) {
          if (triKeys.includes(k)) continue;
          if (pointOnSegment(pos, a, b)) {
            mids.push(pos);
          }
        }
        if (mids.length > 0) {
          needsSplit = true;
          // Sort midpoints along the edge
          const ab = b.clone().sub(a);
          mids.sort((m1, m2) => m1.clone().sub(a).dot(ab) - m2.clone().sub(a).dot(ab));
          edgeMidpoints.set(eKey, mids);
        }
      }

      if (!needsSplit) {
        splitTris.push(tri);
        continue;
      }

      // Fan triangulate: for each edge with midpoints, create sub-triangles
      // using the opposite vertex as the fan center
      // Collect all edge vertices in order around the triangle
      const perimeterPts: THREE.Vector3[] = [];
      for (let ei = 0; ei < 3; ei++) {
        perimeterPts.push(tri[ei]);
        const mids = edgeMidpoints.get(`${ei}`);
        if (mids) perimeterPts.push(...mids);
      }
      // Fan from first vertex (simple triangulation)
      for (let pi = 1; pi < perimeterPts.length - 1; pi++) {
        splitTris.push([perimeterPts[0], perimeterPts[pi], perimeterPts[pi + 1]]);
      }
    }

    // Build undirected edge counts from the split triangles
    const undirectedKey = (a: string, b: string) => (a < b ? `${a}#${b}` : `${b}#${a}`);
    const edgeCount = new Map<string, number>();
    for (const [va, vb, vc] of splitTris) {
      const ka = keyFor(va), kb = keyFor(vb), kc = keyFor(vc);
      for (const [e0, e1] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
        const k = undirectedKey(e0, e1);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }

    // Directed adjacency for boundary edges (preserves CCW around each triangle)
    const adjacency = new Map<string, string[]>();
    for (const [va, vb, vc] of splitTris) {
      const ka = keyFor(va), kb = keyFor(vb), kc = keyFor(vc);
      for (const [e0, e1] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
        if (edgeCount.get(undirectedKey(e0, e1)) === 1) {
          if (!adjacency.has(e0)) adjacency.set(e0, []);
          adjacency.get(e0)!.push(e1);
        }
      }
    }
    if (adjacency.size < 3) return null;

    // Walk every closed loop in the directed boundary, return the LARGEST
    // (the outer face boundary; smaller loops are holes). For typical extrude
    // bodies there's a single loop.
    const visitedEdges = new Set<string>();
    const loops: string[][] = [];
    for (const [startKey, _] of adjacency.entries()) {
      void _;
      // Try to start a loop at any unvisited outgoing edge from this vertex
      const outEdges = adjacency.get(startKey) ?? [];
      for (const firstNext of outEdges) {
        const firstEdgeKey = `${startKey}->${firstNext}`;
        if (visitedEdges.has(firstEdgeKey)) continue;
        const loop: string[] = [startKey];
        visitedEdges.add(firstEdgeKey);
        let cur: string = firstNext;
        const safety = adjacency.size + 2;
        let closed = false;
        for (let i = 0; i < safety; i++) {
          loop.push(cur);
          if (cur === startKey) { closed = true; break; }
          const next = (adjacency.get(cur) ?? []).find((n) => !visitedEdges.has(`${cur}->${n}`));
          if (next === undefined) break;
          visitedEdges.add(`${cur}->${next}`);
          cur = next;
        }
        if (closed && loop.length >= 4) {
          // loop ends with a duplicate of the start — drop it
          loop.pop();
          loops.push(loop);
        }
      }
    }
    if (loops.length === 0) return null;

    // Pick the longest loop (outer boundary). Holes would be shorter.
    loops.sort((a, b) => b.length - a.length);
    const outer = loops[0];
    if (outer.length < 3) return null;

    const boundary: THREE.Vector3[] = outer.map((k) => canonicalPos.get(k)!.clone());

    // Centroid: mean of boundary points
    const centroid = new THREE.Vector3();
    for (const p of boundary) centroid.add(p);
    centroid.multiplyScalar(1 / boundary.length);

    // Re-orient the normal using the normalMatrix to be consistent with how
    // R3F's onClick reports face.normal (although we already used worldspace
    // vertices, this guards against negative-scale meshes).
    const finalNormal = hitNormal.clone();
    void normalMatrix; // noted but the world-space cross product already handles this

    return { boundary, normal: finalNormal, centroid };
  }

  /**
   * Returns the in-plane tangent vectors for any sketch — uses named-plane
   * axes for XY/XZ/YZ and computes from the stored normal for 'custom'.
   * Prefer this over getPlaneAxes when you have access to the full Sketch.
   */
  static getSketchAxes(sketch: Sketch): { t1: THREE.Vector3; t2: THREE.Vector3 } {
    if (sketch.plane === 'custom') {
      return this.computePlaneAxesFromNormal(sketch.planeNormal);
    }
    return this.getPlaneAxes(sketch.plane);
  }

  /**
   * Mesh rotation applied by extrudeSketch for named planes. Use this when
   * building any geometry (e.g. flat profile mesh) that must align with the
   * extruded body for the same sketch.
   */
  static getPlaneRotation(plane: 'XY' | 'XZ' | 'YZ'): [number, number, number] {
    switch (plane) {
      case 'XZ': return [-Math.PI / 2, 0, 0];
      case 'YZ': return [0, Math.PI / 2, 0];
      default:   return [0, 0, 0];
    }
  }

  /**
   * World direction the extrusion grows along. This is the sketch plane's
   * normal — ExtrudeGeometry depth maps to local Z, which `extrudeSketch`
   * aligns to `planeNormal` via `makeBasis(t1, t2, normal)`.
   */
  static getSketchExtrudeNormal(sketch: Sketch): THREE.Vector3 {
    return sketch.planeNormal.clone().normalize();
  }

  /**
   * World-space centroid of the sketch's profile shape, computed from its 2D
   * bounding-box center. Returns null for empty sketches. Handles both named
   * and custom (face-based) planes.
   */
  static getSketchProfileCentroid(sketch: Sketch, profileIndex?: number): THREE.Vector3 | null {
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const allShapes = this.entitiesToShapes(sketch.entities, (p) => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    });
    const shapes = profileIndex === undefined
      ? allShapes
      : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
    if (shapes.length === 0) return null;
    const box = new THREE.Box2();
    for (const s of shapes) {
      for (const p of s.getPoints(32)) box.expandByPoint(p);
    }
    if (box.isEmpty()) return null;
    const c2 = box.getCenter(new THREE.Vector2());
    return origin.clone().addScaledVector(t1, c2.x).addScaledVector(t2, c2.y);
  }

  /**
   * Builds a flat (un-extruded) mesh for the sketch's profile, positioned and
   * oriented in world space to match the extruded body. Caller owns disposal
   * of the geometry. Used for hit-testing/picking.
   */
  static createSketchProfileMesh(sketch: Sketch, material: THREE.Material, profileIndex?: number): THREE.Mesh | null {
    // Build in plane-local UV, then place back in world with the sketch basis.
    // This keeps profile faces aligned with sketch wire geometry for ALL planes,
    // including redefined named planes with non-zero planeOrigin.
    const { t1, t2 } = this.getSketchAxes(sketch);
    const normal = sketch.planeNormal.clone().normalize();
    const origin = sketch.planeOrigin;
    const allShapes = this.entitiesToShapes(sketch.entities, (p) => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    });
    const shapes = profileIndex === undefined
      ? allShapes
      : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
    if (shapes.length === 0) return null;
    const geom = new THREE.ShapeGeometry(shapes);
    const mesh = new THREE.Mesh(geom, material);
    const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.copy(origin);
    return mesh;
  }

  static createProfileSketch(sketch: Sketch, profileIndex: number): Sketch | null {
    const shapes = this.sketchToShapes(sketch);
    const shape = shapes[profileIndex];
    if (!shape) return null;

    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const raw = shape.getPoints(64);
    if (raw.length < 3) return null;

    const points2d = [...raw];
    const first = points2d[0];
    const last = points2d[points2d.length - 1];
    // `Shape.getPoints()` may or may not repeat the first point at the end,
    // even for closed shapes. Remove only a duplicated closing point.
    if (last.distanceTo(first) <= 1e-5) points2d.pop();
    if (points2d.length < 3) return null;

    const pts3d = points2d.map((p) => ({
      id: crypto.randomUUID(),
      x: origin.x + t1.x * p.x + t2.x * p.y,
      y: origin.y + t1.y * p.x + t2.y * p.y,
      z: origin.z + t1.z * p.x + t2.z * p.y,
    }));

    const entities: SketchEntity[] = [];
    for (let i = 0; i < pts3d.length; i++) {
      const next = (i + 1) % pts3d.length;
      entities.push({
        id: crypto.randomUUID(),
        type: 'line',
        points: [pts3d[i], pts3d[next]],
      });
    }

    return {
      ...sketch,
      id: `${sketch.id}::profile-${profileIndex}`,
      name: `${sketch.name} • Profile ${profileIndex + 1}`,
      entities,
      constraints: [],
      dimensions: [],
      fullyConstrained: false,
    };
  }

  static sketchToShapes(sketch: Sketch): THREE.Shape[] {
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    return this.entitiesToShapes(sketch.entities, (p) => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    });
  }

  /**
   * Build a THREE.Shape from sketch entities using a custom (x,y) projection.
   * Used by both named-plane sketchToShape and custom-plane variants.
   */
  /** Entity types that contribute to extrudable profiles. */
  private static readonly BOUNDARY_TYPES = new Set([
    'line', 'arc', 'spline', 'ellipse', 'elliptical-arc', 'polygon',
  ]);

  /** Entity types that are inherently closed and get their own shape. */
  private static readonly CLOSED_PRIMITIVE_TYPES = new Set([
    'rectangle', 'circle', 'ellipse', 'polygon',
  ]);

  private static entitiesToShape(
    entities: SketchEntity[],
    proj: (p: SketchPoint) => { u: number; v: number },
  ): THREE.Shape | null {
    const shape = new THREE.Shape();
    let hasContent = false;
    for (const entity of entities) {
      switch (entity.type) {
        case 'line': {
          if (entity.points.length >= 2) {
            const a = proj(entity.points[0]);
            const b = proj(entity.points[1]);
            if (!hasContent) { shape.moveTo(a.u, a.v); hasContent = true; }
            shape.lineTo(b.u, b.v);
          }
          break;
        }
        case 'rectangle': {
          if (entity.points.length >= 2) {
            const p1 = proj(entity.points[0]);
            const p2 = proj(entity.points[1]);
            shape.moveTo(p1.u, p1.v);
            shape.lineTo(p2.u, p1.v);
            shape.lineTo(p2.u, p2.v);
            shape.lineTo(p1.u, p2.v);
            shape.lineTo(p1.u, p1.v);
            hasContent = true;
          }
          break;
        }
        case 'circle': {
          if (entity.points.length >= 1 && entity.radius) {
            const c = proj(entity.points[0]);
            const path = new THREE.Path();
            path.absarc(c.u, c.v, entity.radius, 0, Math.PI * 2, false);
            shape.setFromPoints(path.getPoints(64));
            hasContent = true;
          }
          break;
        }
        case 'arc': {
          if (entity.points.length >= 1 && entity.radius) {
            const c = proj(entity.points[0]);
            if (!hasContent) {
              const sa = entity.startAngle || 0;
              shape.moveTo(c.u + Math.cos(sa) * entity.radius, c.v + Math.sin(sa) * entity.radius);
              hasContent = true;
            }
            shape.absarc(c.u, c.v, entity.radius, entity.startAngle || 0, entity.endAngle || Math.PI, false);
          }
          break;
        }
        case 'spline': {
          // Polyline-approximate: just connect the control/fit points
          if (entity.points.length >= 2) {
            const first = proj(entity.points[0]);
            if (!hasContent) { shape.moveTo(first.u, first.v); hasContent = true; }
            for (let i = 1; i < entity.points.length; i++) {
              const p = proj(entity.points[i]);
              shape.lineTo(p.u, p.v);
            }
          }
          break;
        }
        case 'ellipse': {
          if (entity.points.length >= 1 && entity.majorRadius && entity.minorRadius) {
            const c = proj(entity.points[0]);
            const rot = entity.rotation ?? 0;
            const pts = new THREE.Path();
            pts.absellipse(c.u, c.v, entity.majorRadius, entity.minorRadius, 0, Math.PI * 2, false, rot);
            shape.setFromPoints(pts.getPoints(64));
            hasContent = true;
          }
          break;
        }
        case 'elliptical-arc': {
          if (entity.points.length >= 1 && entity.majorRadius && entity.minorRadius) {
            const c = proj(entity.points[0]);
            const rot = entity.rotation ?? 0;
            const sa = entity.startAngle ?? 0;
            const ea = entity.endAngle ?? Math.PI;
            if (!hasContent) {
              const cos = Math.cos(rot), sin = Math.sin(rot);
              const sx = entity.majorRadius * Math.cos(sa);
              const sy = entity.minorRadius * Math.sin(sa);
              shape.moveTo(c.u + cos * sx - sin * sy, c.v + sin * sx + cos * sy);
              hasContent = true;
            }
            shape.absellipse(c.u, c.v, entity.majorRadius, entity.minorRadius, sa, ea, false, rot);
          }
          break;
        }
        case 'polygon': {
          const sides = entity.sides ?? 6;
          if (entity.points.length >= 2 && sides >= 3) {
            const center = proj(entity.points[0]);
            const edge = proj(entity.points[1]);
            const r = Math.hypot(edge.u - center.u, edge.v - center.v);
            for (let i = 0; i <= sides; i++) {
              const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
              const pu = center.u + r * Math.cos(angle);
              const pv = center.v + r * Math.sin(angle);
              if (i === 0) shape.moveTo(pu, pv);
              else shape.lineTo(pu, pv);
            }
            hasContent = true;
          }
          break;
        }
      }
    }
    return hasContent ? shape : null;
  }

  /**
   * Build one or more closed shapes from sketch entities.
   *
   * - Inherently closed primitives (rectangle, circle, ellipse, polygon) each
   *   produce an independent shape.
   * - Non-boundary entities (construction-line, centerline, point, slot) are
   *   excluded — they don't contribute to extrudable profiles.
   * - Open-chain boundary entities (line, arc, spline, elliptical-arc) are
   *   grouped into connected chains by endpoint proximity, and only closed
   *   chains produce shapes. This supports multiple disjoint loops in one sketch.
   */
  private static entitiesToShapes(
    entities: SketchEntity[],
    proj: (p: SketchPoint) => { u: number; v: number },
  ): THREE.Shape[] {
    const shapes: THREE.Shape[] = [];
    const TOL = 1e-3;

    const getEntityEndpoints = (entity: SketchEntity): [{ u: number; v: number }, { u: number; v: number }] | null => {
      if (entity.type === 'line' || entity.type === 'spline') {
        if (entity.points.length < 2) return null;
        return [proj(entity.points[0]), proj(entity.points[entity.points.length - 1])];
      }
      if (entity.type === 'arc') {
        if (entity.points.length < 1 || !entity.radius) return null;
        const c = proj(entity.points[0]);
        const sa = entity.startAngle ?? 0;
        const ea = entity.endAngle ?? Math.PI;
        return [
          { u: c.u + Math.cos(sa) * entity.radius, v: c.v + Math.sin(sa) * entity.radius },
          { u: c.u + Math.cos(ea) * entity.radius, v: c.v + Math.sin(ea) * entity.radius },
        ];
      }
      if (entity.type === 'elliptical-arc') {
        if (entity.points.length < 1 || !entity.majorRadius || !entity.minorRadius) return null;
        const c = proj(entity.points[0]);
        const rot = entity.rotation ?? 0;
        const sa = entity.startAngle ?? 0;
        const ea = entity.endAngle ?? Math.PI;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const startPt = () => {
          const sx = entity.majorRadius! * Math.cos(sa);
          const sy = entity.minorRadius! * Math.sin(sa);
          return { u: c.u + cos * sx - sin * sy, v: c.v + sin * sx + cos * sy };
        };
        const endPt = () => {
          const ex = entity.majorRadius! * Math.cos(ea);
          const ey = entity.minorRadius! * Math.sin(ea);
          return { u: c.u + cos * ex - sin * ey, v: c.v + sin * ex + cos * ey };
        };
        return [startPt(), endPt()];
      }
      return null;
    };

    // 1. Closed primitives → individual shapes
    // 2. Boundary chain entities → grouped into connected loops
    const chainable: { entity: SketchEntity; endpoints: [{ u: number; v: number }, { u: number; v: number }] }[] = [];

    for (const entity of entities) {
      if (this.CLOSED_PRIMITIVE_TYPES.has(entity.type)) {
        const s = this.entitiesToShape([entity], proj);
        if (s) shapes.push(s);
      } else if (this.BOUNDARY_TYPES.has(entity.type)) {
        const ep = getEntityEndpoints(entity);
        if (ep) chainable.push({ entity, endpoints: ep });
      }
      // Non-boundary types (construction-line, centerline, point, slot) are skipped
    }

    // Group chainable entities into connected chains by endpoint proximity
    const used = new Set<number>();
    const ptClose = (a: { u: number; v: number }, b: { u: number; v: number }) =>
      Math.hypot(a.u - b.u, a.v - b.v) <= TOL;

    for (let seed = 0; seed < chainable.length; seed++) {
      if (used.has(seed)) continue;
      const chain: SketchEntity[] = [chainable[seed].entity];
      let chainStart = chainable[seed].endpoints[0];
      let chainEnd = chainable[seed].endpoints[1];
      used.add(seed);

      // Greedily extend the chain by finding an unused entity whose start
      // connects to our chain's end (forward) or whose end connects to our
      // chain's start (backward).
      let extended = true;
      while (extended) {
        extended = false;
        for (let i = 0; i < chainable.length; i++) {
          if (used.has(i)) continue;
          const ep = chainable[i].endpoints;
          if (ptClose(chainEnd, ep[0])) {
            chain.push(chainable[i].entity);
            chainEnd = ep[1];
            used.add(i);
            extended = true;
          } else if (ptClose(chainStart, ep[1])) {
            chain.unshift(chainable[i].entity);
            chainStart = ep[0];
            used.add(i);
            extended = true;
          }
        }
      }

      // Only emit a shape if the chain forms a closed loop
      if (chain.length > 0 && ptClose(chainStart, chainEnd)) {
        const s = this.entitiesToShape(chain, proj);
        if (s) shapes.push(s);
      }
    }

    return shapes;
  }

  static createSketchGeometry(sketch: Sketch): THREE.Group {
    const group = new THREE.Group();
    group.name = sketch.name;
    const axes = this.getSketchAxes(sketch);
    for (const entity of sketch.entities) {
      const obj = this.createEntityGeometry(entity, sketch.plane, axes);
      if (obj) group.add(obj);
    }
    return group;
  }

  static createEntityGeometry(
    entity: SketchEntity,
    plane: SketchPlane = 'XZ',
    axes?: { t1: THREE.Vector3; t2: THREE.Vector3 },
  ): THREE.Object3D | null {
    const material = SKETCH_MATERIAL;
    const planeAxes = axes ?? this.getPlaneAxes(plane);
    switch (entity.type) {
      case 'line':              return this.createLine(entity.points, material);
      case 'construction-line': return this.createDashedLine(entity.points, CONSTRUCTION_MATERIAL);
      case 'centerline':        return this.createDashedLine(entity.points, CENTERLINE_MATERIAL);
      case 'circle':            return this.createCircle(entity, material, planeAxes);
      case 'rectangle':         return this.createRectangle(entity.points, material, planeAxes);
      case 'arc':               return this.createArc(entity, material, planeAxes);
      case 'point':             return this.createPointMarker(entity.points[0], planeAxes);
      case 'spline':            return this.createLine(entity.points, material);
      case 'ellipse':           return this.createEllipse(entity, material, planeAxes);
      case 'elliptical-arc':    return this.createEllipticalArc(entity, material, planeAxes);
      case 'isoparametric':     return this.createDashedLine(entity.points, ISOPARAMETRIC_MATERIAL);
      default: return null;
    }
  }

  /**
   * Render a sketch point as a small 2-line cross lying in the sketch plane.
   * Uses t1/t2 so it stays visually aligned regardless of plane orientation.
   */
  private static createPointMarker(
    point: SketchPoint | undefined,
    axes: { t1: THREE.Vector3; t2: THREE.Vector3 },
  ): THREE.Object3D | null {
    if (!point) return null;
    const size = 0.4;
    const { t1, t2 } = axes;
    const cx = point.x, cy = point.y, cz = point.z;
    const positions = new Float32Array([
      cx - t1.x * size, cy - t1.y * size, cz - t1.z * size,
      cx + t1.x * size, cy + t1.y * size, cz + t1.z * size,
      cx - t2.x * size, cy - t2.y * size, cz - t2.z * size,
      cx + t2.x * size, cy + t2.y * size, cz + t2.z * size,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.LineSegments(geom, SKETCH_MATERIAL);
  }

  private static createLine(points: SketchPoint[], material: THREE.LineBasicMaterial): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(geometry, material);
  }

  private static createDashedLine(points: SketchPoint[], material: THREE.LineDashedMaterial): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(p => [p.x, p.y, p.z]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const line = new THREE.Line(geometry, material);
    // Required for LineDashedMaterial — computes per-vertex distances along the line
    line.computeLineDistances();
    return line;
  }

  private static createCircle(entity: SketchEntity, material: THREE.LineBasicMaterial, axes: { t1: THREE.Vector3; t2: THREE.Vector3 }): THREE.Line {
    const c = entity.points[0];
    const radius = entity.radius || 1;
    const segments = 64;
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const { t1, t2 } = axes;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        center.clone()
          .addScaledVector(t1, Math.cos(angle) * radius)
          .addScaledVector(t2, Math.sin(angle) * radius)
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  private static createRectangle(points: SketchPoint[], material: THREE.LineBasicMaterial, axes: { t1: THREE.Vector3; t2: THREE.Vector3 }): THREE.Line {
    if (points.length < 2) return new THREE.Line(new THREE.BufferGeometry(), material);
    const v1 = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    const v2 = new THREE.Vector3(points[1].x, points[1].y, points[1].z);
    const { t1, t2 } = axes;
    const delta = v2.clone().sub(v1);
    // Project delta onto each plane axis to get the two edge vectors
    const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
    const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
    const corners = [
      v1.clone(),
      v1.clone().add(dt1),
      v1.clone().add(dt1).add(dt2),
      v1.clone().add(dt2),
      v1.clone(), // close
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    return new THREE.Line(geometry, material);
  }

  private static createArc(entity: SketchEntity, material: THREE.LineBasicMaterial, axes: { t1: THREE.Vector3; t2: THREE.Vector3 }): THREE.Line {
    const c = entity.points[0];
    const radius = entity.radius || 1;
    const startAngle = entity.startAngle || 0;
    const endAngle = entity.endAngle || Math.PI;
    const segments = 32;
    const center = new THREE.Vector3(c.x, c.y, c.z);
    const { t1, t2 } = axes;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * (endAngle - startAngle);
      points.push(
        center.clone()
          .addScaledVector(t1, Math.cos(angle) * radius)
          .addScaledVector(t2, Math.sin(angle) * radius)
      );
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  /**
   * S5: Render a proper analytic ellipse entity.
   * cx/cy are in sketch-plane coordinates (along t1/t2 from origin).
   * rotation is the angle of the major axis from t1 (radians).
   */
  private static createEllipse(entity: SketchEntity, material: THREE.LineBasicMaterial, axes: { t1: THREE.Vector3; t2: THREE.Vector3 }): THREE.Line {
    const { t1, t2 } = axes;
    const cx = entity.cx ?? entity.points[0]?.x ?? 0;
    const cy = entity.cy ?? entity.points[0]?.y ?? 0;
    const cz = entity.points[0]?.z ?? 0;
    const a = entity.majorRadius ?? 1;
    const b = entity.minorRadius ?? 0.5;
    const rot = entity.rotation ?? 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const segments = 64;
    const points: THREE.Vector3[] = [];
    const center = new THREE.Vector3(cx, cy, cz);
    // Map from sketch-plane (u,v) to 3-D world using t1/t2
    // But cx/cy are already in world coords projected from the sketch origin —
    // so we need to recover the 3-D center by offsetting along t1/t2 from the origin.
    // Since points[0] stores the 3-D center directly, use it.
    const center3 = entity.points.length > 0
      ? new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z)
      : center;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      // Parametric ellipse in local (u,v) rotated by rot
      const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
      const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
      points.push(center3.clone().addScaledVector(t1, u).addScaledVector(t2, v));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  /**
   * S6: Render a proper analytic elliptical-arc entity.
   * Sweeps from startAngle to endAngle around the ellipse equation.
   * Angles are measured from the major axis (rotated by entity.rotation).
   */
  private static createEllipticalArc(entity: SketchEntity, material: THREE.LineBasicMaterial, axes: { t1: THREE.Vector3; t2: THREE.Vector3 }): THREE.Line {
    const { t1, t2 } = axes;
    const a = entity.majorRadius ?? 1;
    const b = entity.minorRadius ?? 0.5;
    const rot = entity.rotation ?? 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const sa = entity.startAngle ?? 0;
    const ea = entity.endAngle ?? Math.PI;
    const segments = 64;
    const points: THREE.Vector3[] = [];
    const center3 = entity.points.length > 0
      ? new THREE.Vector3(entity.points[0].x, entity.points[0].y, entity.points[0].z)
      : new THREE.Vector3(0, 0, 0);
    for (let i = 0; i <= segments; i++) {
      const t = sa + (i / segments) * (ea - sa);
      const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
      const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
      points.push(center3.clone().addScaledVector(t1, u).addScaledVector(t2, v));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  }

  /**
   * D66: Thin Extrude — creates a hollow wall by offsetting the profile and extruding
   * the resulting closed band. Works for both open and closed profiles.
   */
  static extrudeThinSketch(
    sketch: Sketch,
    distance: number,
    thickness: number,
    side: 'inside' | 'outside' | 'center',
  ): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;
    // Plane-aware projection works for ALL planes (XY/XZ/YZ/custom) — the prior
    // `(p.x, p.y)` shortcut for named planes only worked for XY because XZ/YZ
    // sketch points have one of x/y always zero in world space.
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const projFn = (p: SketchPoint) => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    // Collect outline 2D points from entities
    const outline: THREE.Vector2[] = [];
    for (const e of sketch.entities) {
      if (e.type === 'line' && e.points.length >= 2) {
        const { u, v } = projFn(e.points[0]);
        if (outline.length === 0) outline.push(new THREE.Vector2(u, v));
        const { u: u2, v: v2 } = projFn(e.points[1]);
        outline.push(new THREE.Vector2(u2, v2));
      }
    }
    if (outline.length < 2) {
      // Fallback: use regular extrude shape
      return this.extrudeSketch(sketch, distance);
    }

    // Build offset outlines
    const offsetPts = (pts: THREE.Vector2[], d: number): THREE.Vector2[] => {
      const n = pts.length;
      const result: THREE.Vector2[] = [];
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const next = pts[(i + 1) % n];
        // Segment normals (pointing outward = left of travel direction)
        const seg1 = new THREE.Vector2(curr.x - prev.x, curr.y - prev.y).normalize();
        const seg2 = new THREE.Vector2(next.x - curr.x, next.y - curr.y).normalize();
        const n1 = new THREE.Vector2(-seg1.y, seg1.x);
        const n2 = new THREE.Vector2(-seg2.y, seg2.x);
        const avg = n1.clone().add(n2).normalize();
        const dot = n1.dot(avg);
        const scale = dot > 0.01 ? 1 / dot : 1;
        result.push(new THREE.Vector2(curr.x + avg.x * d * scale, curr.y + avg.y * d * scale));
      }
      return result;
    };

    let outerOff = 0, innerOff = 0;
    if (side === 'outside') { outerOff = thickness; innerOff = 0; }
    else if (side === 'inside') { outerOff = 0; innerOff = -thickness; }
    else { outerOff = thickness / 2; innerOff = -thickness / 2; } // center

    const outer = offsetPts(outline, outerOff);
    const inner = offsetPts(outline, innerOff);

    // Build closed band shape: outer forward + inner reversed
    const bandPts = [...outer, ...inner.slice().reverse()];
    const shape = new THREE.Shape(bandPts);

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: distance, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const normal = sketch.planeNormal.clone().normalize();
      const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(sketch.planeOrigin);
    } else {
      const rot = this.getPlaneRotation(sketch.plane);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
    }
    return mesh;
  }

  /**
   * Extrude with a taper angle (D69). Falls back to extrudeSketch when taperAngleDeg ≈ 0.
   * Positive taper = walls lean outward (wider at the top).
   * Negative taper = walls lean inward (narrower at the top).
   */
  static extrudeSketchWithTaper(sketch: Sketch, distance: number, taperAngleDeg: number): THREE.Mesh | null {
    if (Math.abs(taperAngleDeg) < 0.01) return this.extrudeSketch(sketch, distance);
    if (sketch.entities.length === 0) return null;

    // Get 2D profile points in local sketch coords
    const getPts2D = (): { u: number; v: number }[] => {
      if (sketch.plane === 'custom') {
        const { t1, t2 } = this.getSketchAxes(sketch);
        const origin = sketch.planeOrigin;
        const pts: { u: number; v: number }[] = [];
        for (const e of sketch.entities) {
          for (const p of e.points) {
            const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
            pts.push({ u: d.dot(t1), v: d.dot(t2) });
          }
        }
        return pts;
      }
      const shape = this.sketchToShape(sketch);
      if (!shape) return [];
      return shape.getPoints(64).map((p) => ({ u: p.x, v: p.y }));
    };

    const shape = sketch.plane === 'custom' ? null : this.sketchToShape(sketch);
    const rawPts = sketch.plane === 'custom' ? getPts2D() : (shape ? shape.getPoints(64).map((p) => ({ u: p.x, v: p.y })) : []);
    if (rawPts.length < 3) return this.extrudeSketch(sketch, distance);

    const cx = rawPts.reduce((s, p) => s + p.u, 0) / rawPts.length;
    const cy = rawPts.reduce((s, p) => s + p.v, 0) / rawPts.length;
    const taperRad = taperAngleDeg * Math.PI / 180;

    // N_STEPS cross-sections evenly spaced from z=0 to z=distance
    const N_STEPS = Math.max(3, Math.min(20, Math.ceil(Math.abs(distance) / 2) + 2));
    const nPts = rawPts.length;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < N_STEPS; i++) {
      const z = distance * i / (N_STEPS - 1);
      const scaleFactor = 1.0 + Math.tan(taperRad) * (i / (N_STEPS - 1));
      for (const p of rawPts) {
        positions.push(cx + (p.u - cx) * scaleFactor, cy + (p.v - cy) * scaleFactor, z);
      }
    }

    // Side quad strips
    for (let ring = 0; ring < N_STEPS - 1; ring++) {
      const base0 = ring * nPts;
      const base1 = (ring + 1) * nPts;
      for (let j = 0; j < nPts; j++) {
        const jn = (j + 1) % nPts;
        indices.push(base0 + j, base1 + j, base0 + jn);
        indices.push(base0 + jn, base1 + j, base1 + jn);
      }
    }

    // Bottom cap (z=0) — fan from centroid
    const bottomCenter = positions.length / 3;
    positions.push(cx, cy, 0);
    for (let j = 0; j < nPts; j++) {
      indices.push(bottomCenter, (j + 1) % nPts, j);
    }

    // Top cap (z=distance)
    const topRingBase = (N_STEPS - 1) * nPts;
    const topScale = 1.0 + Math.tan(taperRad);
    const topCenterU = cx; const topCenterV = cy;
    const topCenter = positions.length / 3;
    positions.push(topCenterU, topCenterV, distance);
    for (let j = 0; j < nPts; j++) {
      indices.push(topCenter, topRingBase + j, topRingBase + (j + 1) % nPts);
    }
    void topScale; // scale already applied per-ring above

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    // Pad zero UVs so three-bvh-csg can process this geometry without error
    const uvCount = positions.length / 3;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount * 2), 2));

    const mesh = new THREE.Mesh(geom, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const normal = sketch.planeNormal.clone().normalize();
      const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(sketch.planeOrigin);
    } else {
      const rot = this.getPlaneRotation(sketch.plane);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
    }
    return mesh;
  }

  static extrudeSketch(sketch: Sketch, distance: number, profileIndex?: number): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    // Keep custom-plane path explicit for clarity and to preserve face-based behavior.
    if (sketch.plane === 'custom') {
      return this.extrudeCustomPlaneSketch(sketch, distance, profileIndex);
    }

    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const normal = sketch.planeNormal.clone().normalize();
    const proj = (p: SketchPoint): { u: number; v: number } => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const allShapes = this.entitiesToShapes(sketch.entities, proj);
    const shapes = profileIndex === undefined
      ? allShapes
      : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
    if (shapes.length === 0) return null;

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: distance,
      bevelEnabled: false,
    };

    const geometry = new THREE.ExtrudeGeometry(shapes, extrudeSettings);
    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.copy(origin);

    return mesh;
  }

  /**
   * Extrude a sketch defined on a custom (face-based) plane.
   * Projects entity points to plane-local 2D (u, v) coordinates using the
   * sketch's tangent axes, builds a 2D shape, extrudes along +Z, then
   * positions and orients the mesh so its local +Z matches the face normal.
   */
  private static extrudeCustomPlaneSketch(sketch: Sketch, distance: number, profileIndex?: number): THREE.Mesh | null {
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const normal = sketch.planeNormal.clone().normalize();

    const proj = (p: SketchPoint): { u: number; v: number } => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const allShapes = this.entitiesToShapes(sketch.entities, proj);
    const shapes = profileIndex === undefined
      ? allShapes
      : (allShapes[profileIndex] ? [allShapes[profileIndex]] : []);
    if (shapes.length === 0) return null;

    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: distance, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Orient mesh's local +Z (its extrude direction) to match the face normal,
    // and align local X with t1 so the (u, v) coords map back to world correctly.
    // Build a basis matrix where columns are (t1, t2, normal).
    const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.position.copy(origin);

    return mesh;
  }

  /**
   * Extrude a sketch as a surface (wall-only, no end caps).
   * Returns a Mesh built from quad strips along the profile outline.
   * Handles standard sketch planes and custom face-based planes.
   */
  static extrudeSketchSurface(sketch: Sketch, distance: number): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    // Get one or more profile outline loops in plane-local 2D (u, v)
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const proj = (p: SketchPoint) => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };
    const shapes = this.entitiesToShapes(sketch.entities, proj);
    if (shapes.length === 0) return null;
    let outlineLoops2D: { u: number; v: number }[][] =
      shapes.map((shape) => shape.getPoints(64).map((p) => ({ u: p.x, v: p.y })));

    outlineLoops2D = outlineLoops2D.filter((loop) => loop.length >= 2);
    if (outlineLoops2D.length === 0) return null;

    // Build wall-only geometry: for each pair of consecutive outline points,
    // emit a quad (2 triangles) bridging the bottom rail to the top rail.
    const positions: number[] = [];
    const indices: number[] = [];

    const addWallQuad = (
      ax: number, ay: number, az: number, // bottom-left
      bx: number, by: number, bz: number, // bottom-right
      cx: number, cy: number, cz: number, // top-right
      dx: number, dy: number, dz: number, // top-left
    ) => {
      const i = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      // Two triangles: (i, i+1, i+2) and (i, i+2, i+3)
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };

    const normal = sketch.planeNormal.clone().normalize();

    for (const outline2D of outlineLoops2D) {
      for (let i = 0; i < outline2D.length - 1; i++) {
        const a = outline2D[i];
        const b = outline2D[i + 1];
        // bottom = a/b at plane origin; top = a/b offset by distance along normal
        const ax = origin.x + t1.x * a.u + t2.x * a.v;
        const ay = origin.y + t1.y * a.u + t2.y * a.v;
        const az = origin.z + t1.z * a.u + t2.z * a.v;
        const bx = origin.x + t1.x * b.u + t2.x * b.v;
        const by = origin.y + t1.y * b.u + t2.y * b.v;
        const bz = origin.z + t1.z * b.u + t2.z * b.v;
        addWallQuad(
          ax, ay, az,
          bx, by, bz,
          bx + normal.x * distance, by + normal.y * distance, bz + normal.z * distance,
          ax + normal.x * distance, ay + normal.y * distance, az + normal.z * distance,
        );
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, SURFACE_MATERIAL);
  }

  static sketchToShape(sketch: Sketch): THREE.Shape | null {
    const shapes = this.sketchToShapes(sketch);
    return shapes.length > 0 ? shapes[0] : null;
  }

  /** Returns true when the sketch resolves to a closed profile loop. */
  static isSketchClosedProfile(sketch: Sketch): boolean {
    if (sketch.entities.length === 0) return false;
    const shapes = this.sketchToShapes(sketch);
    if (shapes.length === 0) return false;

    return shapes.every((shape) => {
      const pts = shape.getPoints(64);
      if (pts.length < 3) return false;
      const first = pts[0];
      const last = pts[pts.length - 1];
      return first.distanceTo(last) <= 1e-4;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static createFilletGeometry(mesh: THREE.Mesh, _radius: number): THREE.Mesh {
    // Fillet approximation using edge beveling — full implementation requires OpenCascade
    const geometry = mesh.geometry.clone();
    const material = (mesh.material as THREE.Material).clone();
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Build the mesh for a single extrude feature, including direction handling
   * (normal / reverse / symmetric). Positions the mesh in world space and
   * returns it. Caller owns disposal of the geometry.
   *
   * `distance` here is always the absolute extrusion depth (>0). For press-pull
   * inward / reverse, pass `direction: 'negative'`.
   */
  static buildExtrudeFeatureMesh(
    sketch: Sketch,
    distance: number,
    direction: 'positive' | 'negative' | 'symmetric' | 'two-sides',
    taperAngleDeg = 0,
    startOffset = 0,
    distance2 = 0,
    taperAngleDeg2 = taperAngleDeg,
  ): THREE.Mesh | null {
    // CORR-2: Two-sides — build positive side + negative side, merge via CSG union
    if (direction === 'two-sides') {
      const meshPos = Math.abs(taperAngleDeg) > 0.01
        ? this.extrudeSketchWithTaper(sketch, distance, taperAngleDeg)
        : this.extrudeSketch(sketch, distance);
      const meshNeg = Math.abs(taperAngleDeg2) > 0.01
        ? this.extrudeSketchWithTaper(sketch, distance2 || distance, taperAngleDeg2)
        : this.extrudeSketch(sketch, distance2 || distance);
      if (!meshPos) return meshNeg;
      if (!meshNeg) return meshPos;
      const normal = this.getSketchExtrudeNormal(sketch);
      meshNeg.position.addScaledVector(normal, -(distance2 || distance));
      // Bake positions into geometry before CSG merge
      meshPos.updateMatrixWorld(true);
      meshNeg.updateMatrixWorld(true);
      const gPos = meshPos.geometry.clone().applyMatrix4(meshPos.matrixWorld);
      const gNeg = meshNeg.geometry.clone().applyMatrix4(meshNeg.matrixWorld);
      const merged = this.csgUnion(gPos, gNeg);
      gPos.dispose();
      gNeg.dispose();
      meshPos.geometry.dispose();
      meshNeg.geometry.dispose();
      const result = new THREE.Mesh(merged, BODY_MATERIAL);
      result.castShadow = true;
      result.receiveShadow = true;
      return result;
    }

    // Symmetric: extrude the full distance but shift half back so the body
    // is centred on the sketch plane. Reverse: shift the full distance back.
    const mesh = Math.abs(taperAngleDeg) > 0.01
      ? this.extrudeSketchWithTaper(sketch, distance, taperAngleDeg)
      : this.extrudeSketch(sketch, distance);
    if (!mesh) return null;
    const normal = this.getSketchExtrudeNormal(sketch);
    if (direction === 'symmetric') {
      mesh.position.addScaledVector(normal, -distance / 2);
    } else if (direction === 'negative') {
      mesh.position.addScaledVector(normal, -distance);
    }
    if (Math.abs(startOffset) > 0.001) {
      mesh.position.addScaledVector(normal, startOffset);
    }
    return mesh;
  }

  /**
   * Bake a mesh's position/rotation/scale into its BufferGeometry, returning a
   * new world-space geometry. Leaves the input mesh untouched (clones geometry
   * first). Needed for CSG, which operates in the brush's local space.
   */
  static bakeMeshWorldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
    mesh.updateMatrixWorld(true);
    const cloned = mesh.geometry.clone();
    cloned.applyMatrix4(mesh.matrixWorld);
    return cloned;
  }

  /**
   * three-bvh-csg requires a `uv` attribute on every geometry it processes.
   * Geometries built with manual vertex arrays (e.g. tapered extrusions) may
   * omit UVs. This pads a zero-filled uv attribute in-place when missing.
   */
  private static _ensureUVs(g: THREE.BufferGeometry): void {
    if (g.attributes.uv) return;
    const count = (g.attributes.position as THREE.BufferAttribute).count;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }

  /**
   * Boolean A − B (subtract) on two world-space geometries. Returns a new
   * BufferGeometry. Disposes nothing — caller owns all inputs and the output.
   */
  static csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    this._ensureUVs(a);
    this._ensureUVs(b);
    const brushA = new Brush(a);
    const brushB = new Brush(b);
    brushA.updateMatrixWorld();
    brushB.updateMatrixWorld();
    const result = _csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
    return result.geometry;
  }

  /**
   * Boolean A ∪ B (union) on two world-space geometries. See csgSubtract.
   */
  static csgUnion(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    this._ensureUVs(a);
    this._ensureUVs(b);
    const brushA = new Brush(a);
    const brushB = new Brush(b);
    brushA.updateMatrixWorld();
    brushB.updateMatrixWorld();
    const result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);
    return result.geometry;
  }

  /**
   * Boolean A ∩ B (intersection) on two world-space geometries. See csgSubtract.
   */
  static csgIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    this._ensureUVs(a);
    this._ensureUVs(b);
    const brushA = new Brush(a);
    const brushB = new Brush(b);
    brushA.updateMatrixWorld();
    brushB.updateMatrixWorld();
    const result = _csgEvaluator.evaluate(brushA, brushB, INTERSECTION);
    return result.geometry;
  }

  /**
   * Revolve a face boundary (ordered world-space polygon) around an axis through
   * the world origin. Each point is rotated 0..angle to build a swept surface.
   */
  static revolveFaceBoundary(
    boundary: THREE.Vector3[],
    axisDir: THREE.Vector3,
    angle: number,
    isSurface = false,
  ): THREE.Mesh | null {
    if (boundary.length < 3) return null;

    const N_SEG = 64;
    const nPts = boundary.length;
    const positions: number[] = [];
    const indices: number[] = [];
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _ax = axisDir.clone().normalize();

    for (let i = 0; i <= N_SEG; i++) {
      const theta = (angle / N_SEG) * i;
      _q.setFromAxisAngle(_ax, theta);
      for (let j = 0; j < nPts; j++) {
        _p.copy(boundary[j]).applyQuaternion(_q);
        positions.push(_p.x, _p.y, _p.z);
      }
    }

    for (let i = 0; i < N_SEG; i++) {
      for (let j = 0; j < nPts; j++) {
        const a = i * nPts + j;
        const b = i * nPts + (j + 1) % nPts;
        const c = (i + 1) * nPts + (j + 1) % nPts;
        const d = (i + 1) * nPts + j;
        indices.push(a, b, c, a, c, d);
      }
    }

    // Flat end caps (fan from centroid) for partial solid revolves
    if (!isSurface && angle < 2 * Math.PI - 0.01) {
      let cx = 0, cy = 0, cz = 0;
      for (const v of boundary) { cx += v.x; cy += v.y; cz += v.z; }
      cx /= nPts; cy /= nPts; cz /= nPts;

      const s0 = positions.length / 3;
      positions.push(cx, cy, cz);
      for (let j = 0; j < nPts; j++) positions.push(boundary[j].x, boundary[j].y, boundary[j].z);
      for (let j = 0; j < nPts; j++) indices.push(s0, s0 + 1 + (j + 1) % nPts, s0 + 1 + j);

      _q.setFromAxisAngle(_ax, angle);
      _p.set(cx, cy, cz).applyQuaternion(_q);
      const e0 = positions.length / 3;
      positions.push(_p.x, _p.y, _p.z);
      for (let j = 0; j < nPts; j++) {
        _p.copy(boundary[j]).applyQuaternion(_q);
        positions.push(_p.x, _p.y, _p.z);
      }
      for (let j = 0; j < nPts; j++) indices.push(e0, e0 + 1 + j, e0 + 1 + (j + 1) % nPts);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = isSurface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  static revolveSketch(sketch: Sketch, angle: number, axis: THREE.Vector3): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    const shape = this.sketchToShape(sketch);
    if (!shape) return null;

    const points = shape.getPoints(64);
    const lathePoints = points.map(p => new THREE.Vector2(Math.abs(p.x), p.y));

    // LatheGeometry always revolves around world +Y. To honor the caller's
    // axis (X/Z/centerline/arbitrary), build the lathe in its local frame and
    // then rotate the geometry so +Y aligns with the requested axis.
    // Previously `_axis` was ignored — non-Y axes were silently swapped to Y.
    const geometry = new THREE.LatheGeometry(lathePoints, 64, 0, angle);
    const targetAxis = axis.clone().normalize();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const cosAng = yAxis.dot(targetAxis);
    if (cosAng < 0.9999) {
      const rotAxis = new THREE.Vector3().crossVectors(yAxis, targetAxis);
      if (rotAxis.lengthSq() > 1e-10) {
        const rotAngle = Math.acos(Math.max(-1, Math.min(1, cosAng)));
        const m = new THREE.Matrix4().makeRotationAxis(rotAxis.normalize(), rotAngle);
        geometry.applyMatrix4(m);
      } else if (cosAng < -0.9999) {
        // 180° flip — pick any perpendicular axis
        geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
      }
    }

    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Internal sweep implementation that takes both the curve and Frenet frames */
  private static _sweepWithCurve(
    profilePts2D: THREE.Vector2[],
    curve: THREE.CatmullRomCurve3,
    N_FRAMES: number,
    surface = false,
  ): THREE.Mesh | null {
    const nProfile = profilePts2D.length;
    const positions: number[] = [];
    const indices: number[] = [];

    const frames = curve.computeFrenetFrames(N_FRAMES, false);
    const curvePts = curve.getPoints(N_FRAMES);

    for (let i = 0; i <= N_FRAMES; i++) {
      const fi = Math.min(i, N_FRAMES - 1);
      const origin = curvePts[i] ?? curvePts[curvePts.length - 1];
      const N2 = frames.normals[fi];
      const B = frames.binormals[fi];

      for (let j = 0; j < nProfile; j++) {
        const { x: u, y: v } = profilePts2D[j];
        positions.push(
          origin.x + N2.x * u + B.x * v,
          origin.y + N2.y * u + B.y * v,
          origin.z + N2.z * u + B.z * v,
        );
      }
    }

    // Build quad-strip indices
    for (let i = 0; i < N_FRAMES; i++) {
      for (let j = 0; j < nProfile - 1; j++) {
        const a = i * nProfile + j;
        const b = a + 1;
        const c = a + nProfile;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    if (!surface) {
      // Cap start (fan)
      const startOffset = 0;
      for (let j = 1; j < nProfile - 1; j++) {
        indices.push(startOffset, startOffset + j, startOffset + j + 1);
      }
      // Cap end (fan, reversed)
      const endOffset = N_FRAMES * nProfile;
      for (let j = 1; j < nProfile - 1; j++) {
        indices.push(endOffset, endOffset + j + 1, endOffset + j);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, surface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Loft between 2+ profile sketches.
   * Samples each profile at PROFILE_SEGS+1 points in world space, interpolates
   * linearly between consecutive sections (linear loft), and builds a closed quad-strip
   * body with start/end fan caps.
   */
  static loftSketches(profileSketches: Sketch[], surface = false): THREE.Mesh | null {
    if (profileSketches.length < 2) return null;
    const PROFILE_SEGS = 48;

    // Sample each sketch profile as world-space ring of PROFILE_SEGS points.
    const rings: THREE.Vector3[][] = [];
    for (const sketch of profileSketches) {
      let ring: THREE.Vector3[];

      if (sketch.plane === 'custom') {
        const { t1, t2 } = this.getSketchAxes(sketch);
        const origin = sketch.planeOrigin;
        const proj = (p: SketchPoint) => {
          const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
          return { u: d.dot(t1), v: d.dot(t2) };
        };
        const shape = this.entitiesToShape(sketch.entities, proj);
        if (!shape) return null;
        ring = shape.getPoints(PROFILE_SEGS).map(({ x: u, y: v }) =>
          new THREE.Vector3(
            origin.x + t1.x * u + t2.x * v,
            origin.y + t1.y * u + t2.y * v,
            origin.z + t1.z * u + t2.z * v,
          )
        );
      } else {
        // Standard plane: project via plane axes, then back-project to world space.
        const { t1, t2 } = this.getSketchAxes(sketch);
        const proj = (p: SketchPoint) => ({
          u: t1.x * p.x + t1.y * p.y + t1.z * p.z,
          v: t2.x * p.x + t2.y * p.y + t2.z * p.z,
        });
        const shape = this.entitiesToShape(sketch.entities, proj);
        if (!shape) return null;
        ring = shape.getPoints(PROFILE_SEGS).map(({ x: u, y: v }) =>
          new THREE.Vector3(t1.x * u + t2.x * v, t1.y * u + t2.y * v, t1.z * u + t2.z * v)
        );
      }

      if (ring.length < 2) return null;
      rings.push(ring);
    }

    if (rings.length < 2) return null;

    // Normalize ring lengths to PROFILE_SEGS points
    const N = PROFILE_SEGS; // number of vertices per ring (open)

    const positions: number[] = [];
    const indices: number[] = [];

    for (const ring of rings) {
      for (const pt of ring.slice(0, N)) {
        positions.push(pt.x, pt.y, pt.z);
      }
    }

    // Quad strips between consecutive rings
    for (let ri = 0; ri < rings.length - 1; ri++) {
      const baseA = ri * N;
      const baseB = (ri + 1) * N;
      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        const a = baseA + j;
        const b = baseA + j1;
        const c = baseB + j;
        const d = baseB + j1;
        indices.push(a, c, b, b, c, d);
      }
    }

    if (!surface) {
      // Start cap (fan from ring[0] centroid)
      const r0 = rings[0].slice(0, N);
      const c0 = r0.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
      const centroid0Idx = positions.length / 3;
      positions.push(c0.x, c0.y, c0.z);
      for (let j = 0; j < N; j++) {
        indices.push(centroid0Idx, j, (j + 1) % N);
      }

      // End cap (fan from rings[last] centroid)
      const rN = rings[rings.length - 1].slice(0, N);
      const cN = rN.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
      const centroidNIdx = positions.length / 3;
      positions.push(cN.x, cN.y, cN.z);
      const lastBase = (rings.length - 1) * N;
      for (let j = 0; j < N; j++) {
        indices.push(centroidNIdx, lastBase + (j + 1) % N, lastBase + j);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, surface ? SURFACE_MATERIAL : EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * D106 — Patch: creates a flat filled surface inside a closed sketch profile.
   * No extrusion — just a flat polygon triangulated from the sketch outline.
   * Handles both standard named planes and custom face-based planes.
   */
  static patchSketch(sketch: Sketch): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const origin = sketch.planeOrigin;

      const proj = (p: SketchPoint): { u: number; v: number } => {
        const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
      const shape = this.entitiesToShape(sketch.entities, proj);
      if (!shape) return null;

      // ShapeGeometry triangulates in 2D (u,v) space — then back-project each vertex to world
      const shapeGeom = new THREE.ShapeGeometry(shape);
      const posAttr = shapeGeom.attributes.position as THREE.BufferAttribute;
      const worldPositions = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) {
        const u = posAttr.getX(i);
        const v = posAttr.getY(i);
        worldPositions[i * 3]     = origin.x + t1.x * u + t2.x * v;
        worldPositions[i * 3 + 1] = origin.y + t1.y * u + t2.y * v;
        worldPositions[i * 3 + 2] = origin.z + t1.z * u + t2.z * v;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(worldPositions, 3));
      if (shapeGeom.index) geom.setIndex(shapeGeom.index.clone());
      geom.computeVertexNormals();
      shapeGeom.dispose();

      return new THREE.Mesh(geom, SURFACE_MATERIAL);
    }

    // Standard named plane: project via t1/t2 dot-product (plane-aware), not raw p.x/p.y
    const { t1, t2 } = this.getSketchAxes(sketch);
    const proj = (p: SketchPoint) => ({
      u: t1.x * p.x + t1.y * p.y + t1.z * p.z,
      v: t2.x * p.x + t2.y * p.y + t2.z * p.z,
    });
    const shape = this.entitiesToShape(sketch.entities, proj);
    if (!shape) return null;

    const geom = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
    const rot = this.getPlaneRotation(sketch.plane);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  }

  /**
   * D107 — Ruled Surface: creates a straight-line-interpolated surface between
   * two sketch profiles. Samples each at N world-space points, then builds quad
   * strips between corresponding points (linear ruled surface, no end caps).
   */
  static ruledSurface(sketchA: Sketch, sketchB: Sketch): THREE.Mesh | null {
    if (sketchA.entities.length === 0 || sketchB.entities.length === 0) return null;

    const N = 64;

    const sampleSketch = (sketch: Sketch): THREE.Vector3[] | null => {
      if (sketch.plane === 'custom') {
        const { t1, t2 } = this.getSketchAxes(sketch);
        const origin = sketch.planeOrigin;
        const proj = (p: SketchPoint) => {
          const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
          return { u: d.dot(t1), v: d.dot(t2) };
        };
        const shape = this.entitiesToShape(sketch.entities, proj);
        if (!shape) return null;
        return shape.getPoints(N).map(({ x: u, y: v }) =>
          new THREE.Vector3(
            origin.x + t1.x * u + t2.x * v,
            origin.y + t1.y * u + t2.y * v,
            origin.z + t1.z * u + t2.z * v,
          )
        );
      }
      // Standard plane: project via plane axes, then back-project to world space
      const { t1, t2 } = this.getSketchAxes(sketch);
      const proj = (p: SketchPoint) => ({
        u: t1.x * p.x + t1.y * p.y + t1.z * p.z,
        v: t2.x * p.x + t2.y * p.y + t2.z * p.z,
      });
      const shape = this.entitiesToShape(sketch.entities, proj);
      if (!shape) return null;
      return shape.getPoints(N).map(({ x: u, y: v }) =>
        new THREE.Vector3(t1.x * u + t2.x * v, t1.y * u + t2.y * v, t1.z * u + t2.z * v)
      );
    };

    const ringA = sampleSketch(sketchA);
    const ringB = sampleSketch(sketchB);
    if (!ringA || !ringB || ringA.length < 2 || ringB.length < 2) return null;

    // Trim both rings to the same length
    const len = Math.min(ringA.length, ringB.length);
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < len; i++) {
      const a = ringA[i];
      const b = ringB[i];
      positions.push(a.x, a.y, a.z);
      positions.push(b.x, b.y, b.z);
    }

    // Build quad strips: each pair of consecutive cross-segments forms a quad.
    // Detect closed loops (start ≈ end within tol) — if closed, add the seam
    // facet bridging vertex[len-1] back to vertex[0] so the surface is watertight.
    const TOL = 1e-4;
    const aStart = ringA[0];
    const aEnd = ringA[len - 1];
    const bStart = ringB[0];
    const bEnd = ringB[len - 1];
    const closed =
      aStart.distanceTo(aEnd) < TOL &&
      bStart.distanceTo(bEnd) < TOL;
    const stripEnd = closed ? len : len - 1;
    for (let i = 0; i < stripEnd; i++) {
      // vertex layout: row i → [2i, 2i+1], row i+1 → [2i+2, 2i+3]
      // For the seam (i === len-1 when closed), wrap row i+1 back to row 0.
      const a = 2 * i;
      const b = 2 * i + 1;
      const next = (i + 1) % len;
      const c = 2 * next;
      const d = 2 * next + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Public entry point — sweepSketch calls this after extracting shape + curve */
  static sweepSketchInternal(profileSketch: Sketch, pathSketch: Sketch, surface = false): THREE.Mesh | null {
    if (profileSketch.entities.length === 0 || pathSketch.entities.length === 0) return null;

    // Path points
    const pathPts: THREE.Vector3[] = [];
    for (const e of pathSketch.entities) {
      for (const p of e.points) pathPts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const deduped: THREE.Vector3[] = [pathPts[0]];
    for (let i = 1; i < pathPts.length; i++) {
      if (pathPts[i].distanceTo(deduped[deduped.length - 1]) > 0.001) deduped.push(pathPts[i]);
    }
    if (deduped.length < 2) return null;

    const N_FRAMES = Math.max(32, deduped.length * 4);
    const curve = new THREE.CatmullRomCurve3(deduped, false, 'centripetal');

    // Profile polygon
    const { t1, t2 } = this.getSketchAxes(profileSketch);
    const profileOrigin = profileSketch.planeOrigin;
    const projFn = (p: SketchPoint): { u: number; v: number } => {
      const d = new THREE.Vector3(p.x - profileOrigin.x, p.y - profileOrigin.y, p.z - profileOrigin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };
    const shape = this.entitiesToShape(profileSketch.entities, projFn);
    const PROFILE_SEGS = 32;
    let pts2D: THREE.Vector2[];
    if (shape) {
      pts2D = shape.getPoints(PROFILE_SEGS).map(p => new THREE.Vector2(p.x, p.y));
    } else {
      pts2D = profileSketch.entities.flatMap(e => e.points).map(p => {
        const { u, v } = projFn(p);
        return new THREE.Vector2(u, v);
      });
    }
    if (pts2D.length < 2) return null;

    return this._sweepWithCurve(pts2D, curve, N_FRAMES, surface);
  }

  // ── D119 Tessellate — extract mesh geometry from a feature ────────────────
  /**
   * Clone the BufferGeometry from a Mesh or Group (first Mesh child).
   * Returns null if no mesh geometry is found.
   */
  static extractMeshGeometry(mesh: THREE.Mesh | THREE.Group): THREE.BufferGeometry | null {
    if (mesh instanceof THREE.Mesh) return mesh.geometry.clone();
    let found: THREE.BufferGeometry | null = null;
    mesh.traverse((child) => {
      if (!found && child instanceof THREE.Mesh) found = child.geometry.clone();
    });
    return found;
  }

  // ── D36 Coil — helix sweep primitive ──────────────────────────────────────
  /**
   * Build a coil (spring/helix) geometry by sweeping a circular wire profile
   * along a helix path using Frenet frames.
   *
   * @param outerRadius  - radius from helix axis to wire centre
   * @param wireRadius   - radius of the circular wire cross-section
   * @param pitch        - height gained per full turn
   * @param turns        - number of full turns
   */
  static coilGeometry(
    outerRadius: number,
    wireRadius: number,
    pitch: number,
    turns: number,
  ): THREE.BufferGeometry {
    const N_FRAMES = Math.max(32, Math.round(turns * 32));
    const N_PROFILE = 12;

    // Build helix path points
    const helixPts: THREE.Vector3[] = [];
    for (let i = 0; i <= N_FRAMES; i++) {
      const t = (i / N_FRAMES) * turns * Math.PI * 2;
      helixPts.push(new THREE.Vector3(
        outerRadius * Math.cos(t),
        (t / (Math.PI * 2)) * pitch,
        outerRadius * Math.sin(t),
      ));
    }

    const curve = new THREE.CatmullRomCurve3(helixPts, false, 'centripetal');
    const frames = curve.computeFrenetFrames(N_FRAMES, false);
    const curvePts = curve.getPoints(N_FRAMES);

    // Build circle profile in local 2-D (u,v) space
    const profilePts: [number, number][] = [];
    for (let j = 0; j < N_PROFILE; j++) {
      const a = (j / N_PROFILE) * Math.PI * 2;
      profilePts.push([wireRadius * Math.cos(a), wireRadius * Math.sin(a)]);
    }
    // Close profile ring by repeating first point
    profilePts.push(profilePts[0]);
    const nRing = profilePts.length; // N_PROFILE + 1

    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= N_FRAMES; i++) {
      const fi = Math.min(i, N_FRAMES - 1);
      const origin = curvePts[i] ?? curvePts[curvePts.length - 1];
      const N2 = frames.normals[fi];
      const B = frames.binormals[fi];
      for (const [u, v] of profilePts) {
        positions.push(
          origin.x + N2.x * u + B.x * v,
          origin.y + N2.y * u + B.y * v,
          origin.z + N2.z * u + B.z * v,
        );
      }
    }

    // Quad-strip between consecutive ring slices
    for (let i = 0; i < N_FRAMES; i++) {
      for (let j = 0; j < nRing - 1; j++) {
        const a = i * nRing + j;
        const b = a + 1;
        const c = a + nRing;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    // End-caps (fan from first / last ring centre)
    const startCentre = positions.length / 3;
    const sc = curvePts[0];
    positions.push(sc.x, sc.y, sc.z);
    for (let j = 0; j < nRing - 1; j++) {
      indices.push(startCentre, j + 1, j);
    }

    const endCentre = positions.length / 3;
    const ec = curvePts[N_FRAMES];
    positions.push(ec.x, ec.y, ec.z);
    const base = N_FRAMES * nRing;
    for (let j = 0; j < nRing - 1; j++) {
      indices.push(endCentre, base + j, base + j + 1);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  // ── D125 Mesh Reduce ───────────────────────────────────────────────────────
  static async simplifyGeometry(
    geom: THREE.BufferGeometry,
    reductionPercent: number,
  ): Promise<THREE.BufferGeometry> {
    const { SimplifyModifier } = await import(
      'three/examples/jsm/modifiers/SimplifyModifier.js'
    );
    const { mergeVertices } = await import(
      'three/examples/jsm/utils/BufferGeometryUtils.js'
    );

    // SimplifyModifier requires an indexed geometry
    const indexed = geom.index ? geom : mergeVertices(geom);

    const posAttr = indexed.getAttribute('position');
    const count = Math.floor(posAttr.count * reductionPercent / 100);
    if (count <= 0) return geom.clone();

    const modifier = new SimplifyModifier();
    const simplified = modifier.modify(indexed, count);
    return simplified;
  }

  // ── D115 Reverse Normal ────────────────────────────────────────────────────
  static reverseNormals(geom: THREE.BufferGeometry): void {
    if (geom.index) {
      const idx = geom.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const tmp = idx[i + 1];
        (idx as Uint16Array | Uint32Array)[i + 1] = idx[i + 2];
        (idx as Uint16Array | Uint32Array)[i + 2] = tmp;
      }
      geom.index.needsUpdate = true;
    } else {
      const pos = geom.getAttribute('position');
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 9) {
        // swap vertex 1 (i+3..i+5) and vertex 2 (i+6..i+8)
        for (let k = 0; k < 3; k++) {
          const tmp = arr[i + 3 + k];
          arr[i + 3 + k] = arr[i + 6 + k];
          arr[i + 6 + k] = tmp;
        }
      }
      pos.needsUpdate = true;
    }
    geom.computeVertexNormals();
  }

  // ── D168 Mirror Mesh ───────────────────────────────────────────────────────
  /**
   * Reflect a mesh through a named plane (XY, XZ, YZ).
   * Returns a new THREE.Mesh with cloned + reflected geometry and flipped face normals.
   * Caller owns the returned mesh (must dispose when done).
   */
  static mirrorMesh(source: THREE.Mesh, plane: 'XY' | 'XZ' | 'YZ'): THREE.Mesh {
    // Build a scale matrix that reflects through the chosen plane
    const scale = new THREE.Vector3(
      plane === 'YZ' ? -1 : 1,
      plane === 'XZ' ? -1 : 1,
      plane === 'XY' ? -1 : 1,
    );
    const reflectMatrix = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);

    // Clone the geometry and apply the reflection
    const geo = source.geometry.clone();
    geo.applyMatrix4(reflectMatrix);

    // Reflection reverses winding order → flip face indices so normals are outward
    const idx = geo.index;
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        const b = idx.getX(i + 2);
        idx.setX(i + 1, b);
        idx.setX(i + 2, a);
      }
      idx.needsUpdate = true;
    } else {
      // Non-indexed: swap vertices 1 and 2 in each triangle
      const pos = geo.attributes.position;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        tmp.fromBufferAttribute(pos, i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, tmp.x, tmp.y, tmp.z);
      }
      pos.needsUpdate = true;
    }
    geo.computeVertexNormals();

    const mat = Array.isArray(source.material) ? source.material[0].clone() : source.material.clone();
    const mirrored = new THREE.Mesh(geo, mat);
    return mirrored;
  }

  // ── MSH8 — Reverse Mesh Normals ────────────────────────────────────────────
  /**
   * Clone the geometry of a mesh and flip its face winding (reverses normals).
   * Returns a new THREE.Mesh; caller owns it (must dispose when done).
   */
  static reverseMeshNormals(mesh: THREE.Mesh): THREE.Mesh {
    const geom = mesh.geometry.clone();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    if (geom.index) {
      const idx = geom.index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < idx.length; i += 3) {
        const tmp = idx[i + 1]; (idx as Uint32Array)[i + 1] = idx[i + 2]; (idx as Uint32Array)[i + 2] = tmp;
      }
      geom.index.needsUpdate = true;
    } else {
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 9) {
        for (let j = 0; j < 3; j++) {
          const tmp = arr[i + 3 + j]; arr[i + 3 + j] = arr[i + 6 + j]; arr[i + 6 + j] = tmp;
        }
      }
      pos.needsUpdate = true;
    }
    if (geom.attributes.normal) geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── MSH7 — Combine Meshes ─────────────────────────────────────────────────
  /**
   * Merge all provided meshes into a single geometry (concatenation, no CSG).
   * Each mesh's world transform is baked in.
   */
  static combineMeshes(meshes: THREE.Mesh[]): THREE.Mesh {
    const geoms = meshes.map((m) => {
      const g = m.geometry.toNonIndexed();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    // Inline merge: concatenate position/normal/uv buffers
    let totalVerts = 0;
    for (const g of geoms) totalVerts += (g.attributes.position as THREE.BufferAttribute).count;
    const positions = new Float32Array(totalVerts * 3);
    let offset = 0;
    for (const g of geoms) {
      const p = g.attributes.position.array as Float32Array;
      positions.set(p, offset);
      offset += p.length;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.computeVertexNormals();
    const mat = Array.isArray(meshes[0].material) ? meshes[0].material[0] : meshes[0].material;
    return new THREE.Mesh(merged, mat);
  }

  // ── MSH11 — Transform Mesh ────────────────────────────────────────────────
  /**
   * Apply a translate/rotate/uniform-scale transform to a cloned mesh geometry.
   * Angles are in radians. Returns a new THREE.Mesh; caller owns it.
   */
  static transformMesh(mesh: THREE.Mesh, params: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; scale: number }): THREE.Mesh {
    const geom = mesh.geometry.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(params.tx, params.ty, params.tz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(params.rx, params.ry, params.rz)),
      new THREE.Vector3(params.scale, params.scale, params.scale),
    );
    geom.applyMatrix4(m);
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── SLD13 — Scale Mesh ────────────────────────────────────────────────────
  /**
   * Scale a cloned mesh geometry by independent X/Y/Z factors.
   * Returns a new THREE.Mesh; caller owns it.
   */
  static scaleMesh(mesh: THREE.Mesh, sx: number, sy: number, sz: number): THREE.Mesh {
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ---------------------------------------------------------------------------
  // Surface intersection: mesh-mesh and plane-mesh
  // ---------------------------------------------------------------------------

  /**
   * Computes the intersection curve(s) between two triangle meshes.
   *
   * Algorithm: for each triangle pair (one from meshA, one from meshB),
   * compute the triangle-triangle intersection segment. Collect all segments,
   * then chain them into ordered polylines (closed loops where possible).
   *
   * @returns Array of polylines (each is an ordered array of world-space Vector3).
   *          Empty array if meshes don't intersect.
   */
  static computeMeshIntersectionCurve(
    meshA: THREE.Mesh,
    meshB: THREE.Mesh,
    tol = 1e-6,
  ): THREE.Vector3[][] {
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);

    const trisA = GeometryEngine._extractWorldTriangles(meshA);
    const trisB = GeometryEngine._extractWorldTriangles(meshB);

    // Complexity guard: avoid O(n²) blowup on high-poly meshes
    if (trisA.length * trisB.length > 50000) return [];

    const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];

    for (const tA of trisA) {
      for (const tB of trisB) {
        // Quick AABB overlap check before the expensive intersection test
        if (!GeometryEngine._triBoxesOverlap(tA, tB, tol)) continue;
        const seg = GeometryEngine.triTriIntersectSegment(tA, tB, tol);
        if (seg) segments.push(seg);
      }
    }

    return GeometryEngine.chainSegments(segments, tol);
  }

  /**
   * Intersects a mesh with a plane, returning the intersection polyline(s).
   * More efficient than mesh-mesh intersection when one surface is planar.
   *
   * @param mesh    The mesh to slice
   * @param plane   The cutting plane (THREE.Plane in world space)
   * @returns       Array of polylines (world-space Vector3 arrays)
   */
  static computePlaneIntersectionCurve(
    mesh: THREE.Mesh,
    plane: THREE.Plane,
    tol = 1e-6,
  ): THREE.Vector3[][] {
    mesh.updateWorldMatrix(true, false);
    const tris = GeometryEngine._extractWorldTriangles(mesh);
    const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];

    for (const [v0, v1, v2] of tris) {
      const d0 = plane.distanceToPoint(v0);
      const d1 = plane.distanceToPoint(v1);
      const d2 = plane.distanceToPoint(v2);

      // Skip if all on same side (no crossing)
      const s0 = d0 > tol ? 1 : d0 < -tol ? -1 : 0;
      const s1 = d1 > tol ? 1 : d1 < -tol ? -1 : 0;
      const s2 = d2 > tol ? 1 : d2 < -tol ? -1 : 0;
      if (s0 === s1 && s1 === s2) continue;

      // Gather intersection points from each edge that straddles the plane
      const pts: THREE.Vector3[] = [];
      const edgeVerts: Array<[THREE.Vector3, number, THREE.Vector3, number]> = [
        [v0, d0, v1, d1],
        [v1, d1, v2, d2],
        [v2, d2, v0, d0],
      ];
      for (const [va, da, vb, db] of edgeVerts) {
        const sa = da > tol ? 1 : da < -tol ? -1 : 0;
        const sb = db > tol ? 1 : db < -tol ? -1 : 0;
        if (sa === 0) {
          // vertex is exactly on plane — add once
          if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(va) > tol * tol) {
            pts.push(va.clone());
          }
        } else if (sb === 0) {
          // next vertex exactly on plane — will be caught as sa===0 on next edge
        } else if (sa !== sb) {
          // edge straddles the plane
          const t = da / (da - db);
          pts.push(new THREE.Vector3().lerpVectors(va, vb, t));
        }
      }

      if (pts.length >= 2) {
        segments.push([pts[0], pts[1]]);
      }
    }

    return GeometryEngine.chainSegments(segments, tol);
  }

  /**
   * Compute the triangle-triangle intersection segment in world space.
   * Returns null if triangles don't intersect or the intersection is degenerate.
   */
  private static triTriIntersectSegment(
    tA: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    tB: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    tol: number,
  ): [THREE.Vector3, THREE.Vector3] | null {
    const [a0, a1, a2] = tA;
    const [b0, b1, b2] = tB;

    // Normal and plane offset for tB
    const ab = b1.clone().sub(b0);
    const ac = b2.clone().sub(b0);
    const nB = ab.cross(ac);
    if (nB.lengthSq() < tol * tol) return null; // degenerate triangle
    nB.normalize();
    const dB = nB.dot(b0);

    // Signed distances of tA vertices to plane B
    const dA = [nB.dot(a0) - dB, nB.dot(a1) - dB, nB.dot(a2) - dB];
    if (
      (dA[0] > tol && dA[1] > tol && dA[2] > tol) ||
      (dA[0] < -tol && dA[1] < -tol && dA[2] < -tol)
    ) return null;

    // Normal and plane offset for tA
    const aa = a1.clone().sub(a0);
    const ac2 = a2.clone().sub(a0);
    const nA = aa.cross(ac2);
    if (nA.lengthSq() < tol * tol) return null;
    nA.normalize();
    const dA_plane = nA.dot(a0);

    // Signed distances of tB vertices to plane A
    const dBdist = [nA.dot(b0) - dA_plane, nA.dot(b1) - dA_plane, nA.dot(b2) - dA_plane];
    if (
      (dBdist[0] > tol && dBdist[1] > tol && dBdist[2] > tol) ||
      (dBdist[0] < -tol && dBdist[1] < -tol && dBdist[2] < -tol)
    ) return null;

    // Intersection line direction
    const L = nA.clone().cross(nB);
    const Llen = L.length();
    if (Llen < tol) return null; // parallel planes
    const Lnorm = L.clone().divideScalar(Llen);

    // Find a point on the intersection line (plane-plane-plane with a helper coord plane)
    // Use the axis with the largest component of L to anchor the third plane
    const ax = Math.abs(Lnorm.x), ay = Math.abs(Lnorm.y), az = Math.abs(Lnorm.z);
    let P: THREE.Vector3;
    if (ax >= ay && ax >= az) {
      // Set x = 0 and solve for y, z from nA and nB
      const det = nA.y * nB.z - nA.z * nB.y;
      if (Math.abs(det) < tol) return null;
      const y = (dA_plane * nB.z - dB * nA.z) / det;
      const z = (nA.y * dB - nB.y * dA_plane) / det;
      P = new THREE.Vector3(0, y, z);
    } else if (ay >= ax && ay >= az) {
      const det = nA.x * nB.z - nA.z * nB.x;
      if (Math.abs(det) < tol) return null;
      const x = (dA_plane * nB.z - dB * nA.z) / det;
      const z = (nA.x * dB - nB.x * dA_plane) / det;
      P = new THREE.Vector3(x, 0, z);
    } else {
      const det = nA.x * nB.y - nA.y * nB.x;
      if (Math.abs(det) < tol) return null;
      const x = (dA_plane * nB.y - dB * nA.y) / det;
      const y = (nA.x * dB - nB.x * dA_plane) / det;
      P = new THREE.Vector3(x, y, 0);
    }

    // Project triangle vertices onto the intersection line to get scalar intervals
    const projA = [
      Lnorm.dot(a0) - Lnorm.dot(P),
      Lnorm.dot(a1) - Lnorm.dot(P),
      Lnorm.dot(a2) - Lnorm.dot(P),
    ];
    const projB = [
      Lnorm.dot(b0) - Lnorm.dot(P),
      Lnorm.dot(b1) - Lnorm.dot(P),
      Lnorm.dot(b2) - Lnorm.dot(P),
    ];

    const intervalA = GeometryEngine._triInterval(projA, dA, tol);
    const intervalB = GeometryEngine._triInterval(projB, dBdist, tol);
    if (!intervalA || !intervalB) return null;

    // Overlap of the two intervals
    const ta = Math.max(intervalA[0], intervalB[0]);
    const tb = Math.min(intervalA[1], intervalB[1]);
    if (tb - ta < tol) return null; // no meaningful overlap

    const p0 = P.clone().addScaledVector(Lnorm, ta);
    const p1 = P.clone().addScaledVector(Lnorm, tb);
    return [p0, p1];
  }

  /**
   * Compute the scalar interval [t0, t1] where the given triangle overlaps
   * the intersection line.
   *
   * projVerts: projections of triangle vertices onto the line.
   * planeDist: signed distances of those vertices to the opposing plane.
   */
  private static _triInterval(
    projVerts: number[],
    planeDist: number[],
    tol: number,
  ): [number, number] | null {
    // Find the vertex on the "opposite" side of the plane
    // The two vertices on one side intersect two edges with the lone vertex.
    let singleIdx = -1;
    let singleSign = 0;
    for (let i = 0; i < 3; i++) {
      const sign = planeDist[i] > tol ? 1 : planeDist[i] < -tol ? -1 : 0;
      if (sign === 0) continue;
      const otherSigns = [0, 1, 2].filter((j) => j !== i).map((j) =>
        planeDist[j] > tol ? 1 : planeDist[j] < -tol ? -1 : 0,
      );
      if (otherSigns[0] !== sign || otherSigns[1] !== sign) {
        singleIdx = i;
        singleSign = sign;
        break;
      }
    }

    if (singleIdx === -1) {
      // All vertices on same side or coplanar — just use min/max of projections
      // that belong to vertices touching the plane
      const onPlane = [0, 1, 2].filter((i) => Math.abs(planeDist[i]) <= tol);
      if (onPlane.length < 2) return null;
      const t0 = Math.min(...onPlane.map((i) => projVerts[i]));
      const t1 = Math.max(...onPlane.map((i) => projVerts[i]));
      return t0 < t1 ? [t0, t1] : null;
    }

    const idx0 = (singleIdx + 1) % 3;
    const idx1 = (singleIdx + 2) % 3;

    const d_single = planeDist[singleIdx];
    const d0 = planeDist[idx0];
    const d1 = planeDist[idx1];

    // Clamp to avoid division by near-zero
    const denom0 = d_single - d0;
    const denom1 = d_single - d1;

    const t0 = Math.abs(denom0) > tol
      ? projVerts[idx0] + (projVerts[singleIdx] - projVerts[idx0]) * (d0 / (d0 - d_single))
      : projVerts[idx0];
    const t1 = Math.abs(denom1) > tol
      ? projVerts[idx1] + (projVerts[singleIdx] - projVerts[idx1]) * (d1 / (d1 - d_single))
      : projVerts[idx1];

    void singleSign; // used conceptually to identify the lone vertex
    return [Math.min(t0, t1), Math.max(t0, t1)];
  }

  /**
   * Chain a flat list of unordered segments into connected polylines.
   * Endpoints that are within `tol` of each other are considered shared.
   */
  private static chainSegments(
    segments: Array<[THREE.Vector3, THREE.Vector3]>,
    tol: number,
  ): THREE.Vector3[][] {
    if (segments.length === 0) return [];

    const tolSq = tol * tol;

    // Build adjacency: for each segment endpoint, find adjacent segment indices
    // We store: endpointList[i] = { pt, segIdx, endIdx (0 or 1) }
    interface EP { pt: THREE.Vector3; segIdx: number; endIdx: 0 | 1 }
    const endpoints: EP[] = [];
    for (let i = 0; i < segments.length; i++) {
      endpoints.push({ pt: segments[i][0], segIdx: i, endIdx: 0 });
      endpoints.push({ pt: segments[i][1], segIdx: i, endIdx: 1 });
    }

    // For each endpoint, find its "partner" (another endpoint of a *different* segment
    // that is within tol). Store as adjacency[epIdx] = epIdx of partner | -1.
    const partner = new Array<number>(endpoints.length).fill(-1);
    for (let i = 0; i < endpoints.length; i++) {
      if (partner[i] !== -1) continue;
      for (let j = i + 1; j < endpoints.length; j++) {
        if (partner[j] !== -1) continue;
        if (endpoints[i].segIdx === endpoints[j].segIdx) continue;
        if (endpoints[i].pt.distanceToSquared(endpoints[j].pt) < tolSq) {
          partner[i] = j;
          partner[j] = i;
          break;
        }
      }
    }

    const usedSegs = new Set<number>();
    const polylines: THREE.Vector3[][] = [];

    for (let startSeg = 0; startSeg < segments.length; startSeg++) {
      if (usedSegs.has(startSeg)) continue;

      // Walk the chain forward from endpoint 1 of startSeg
      const chain: THREE.Vector3[] = [segments[startSeg][0].clone(), segments[startSeg][1].clone()];
      usedSegs.add(startSeg);

      // Try extending forward (from endpoint index 1 of current last segment)
      let curSegIdx = startSeg;
      let curEndIdx: 0 | 1 = 1;
      for (;;) {
        const epIdx: number = curSegIdx * 2 + curEndIdx;
        const partnerId: number = partner[epIdx];
        if (partnerId === -1) break;
        const nextSeg: number = endpoints[partnerId].segIdx;
        if (usedSegs.has(nextSeg)) break;
        usedSegs.add(nextSeg);
        const nextEnd: 0 | 1 = endpoints[partnerId].endIdx;
        // The "other" end of nextSeg is the new tip
        const otherEnd: 0 | 1 = nextEnd === 0 ? 1 : 0;
        chain.push(segments[nextSeg][otherEnd].clone());
        curSegIdx = nextSeg;
        curEndIdx = otherEnd;
      }

      // Try extending backward (from endpoint index 0 of startSeg)
      curSegIdx = startSeg;
      curEndIdx = 0;
      const prepend: THREE.Vector3[] = [];
      for (;;) {
        const epIdx: number = curSegIdx * 2 + curEndIdx;
        const partnerId: number = partner[epIdx];
        if (partnerId === -1) break;
        const nextSeg: number = endpoints[partnerId].segIdx;
        if (usedSegs.has(nextSeg)) break;
        usedSegs.add(nextSeg);
        const nextEnd: 0 | 1 = endpoints[partnerId].endIdx;
        const otherEnd: 0 | 1 = nextEnd === 0 ? 1 : 0;
        prepend.unshift(segments[nextSeg][otherEnd].clone());
        curSegIdx = nextSeg;
        curEndIdx = otherEnd;
      }

      const full = [...prepend, ...chain];
      if (full.length >= 2) polylines.push(full);
    }

    return polylines;
  }

  /** Extract all triangles from a mesh as world-space vertex triples. */
  private static _extractWorldTriangles(
    mesh: THREE.Mesh,
  ): Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return [];

    const m = mesh.matrixWorld;
    const idxAttr = geom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;

    const tris: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [];
    for (let t = 0; t < triCount; t++) {
      let i0: number, i1: number, i2: number;
      if (idxAttr) {
        i0 = idxAttr.getX(t * 3);
        i1 = idxAttr.getX(t * 3 + 1);
        i2 = idxAttr.getX(t * 3 + 2);
      } else {
        i0 = t * 3;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(m);
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(m);
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(m);
      tris.push([v0, v1, v2]);
    }
    return tris;
  }

  /** Fast AABB overlap test for two triangles — prune pairs before full intersection. */
  private static _triBoxesOverlap(
    tA: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    tB: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
    tol: number,
  ): boolean {
    for (let axis = 0; axis < 3; axis++) {
      const k = axis as 0 | 1 | 2;
      const aMin = Math.min(tA[0].getComponent(k), tA[1].getComponent(k), tA[2].getComponent(k)) - tol;
      const aMax = Math.max(tA[0].getComponent(k), tA[1].getComponent(k), tA[2].getComponent(k)) + tol;
      const bMin = Math.min(tB[0].getComponent(k), tB[1].getComponent(k), tB[2].getComponent(k)) - tol;
      const bMax = Math.max(tB[0].getComponent(k), tB[1].getComponent(k), tB[2].getComponent(k)) + tol;
      if (aMax < bMin || bMax < aMin) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // D137 — Texture Extrude
  // ---------------------------------------------------------------------------

  /**
   * Bilinear sample of a height-map pixel array at normalized UV coordinates.
   *
   * @param heightData  Flat RGBA Uint8ClampedArray (from canvas.getImageData)
   * @param w           Image width in pixels
   * @param h           Image height in pixels
   * @param u           Horizontal UV in [0, 1]
   * @param v           Vertical UV in [0, 1]
   * @param channel     Which channel to read: 'r' | 'g' | 'b' | 'luminance'
   * @returns           Sampled height value in [0, 1]
   */
  private static sampleHeightBilinear(
    heightData: Uint8ClampedArray,
    w: number,
    h: number,
    u: number,
    v: number,
    channel: 'r' | 'g' | 'b' | 'luminance',
  ): number {
    // Bilinear sample at (u, v) in [0,1]x[0,1]; flip V since image Y is top-down
    const x = u * (w - 1);
    const y = (1 - v) * (h - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0;
    const fy = y - y0;

    const sample = (px: number, py: number): number => {
      const i = (py * w + px) * 4;
      if (channel === 'r') return heightData[i] / 255;
      if (channel === 'g') return heightData[i + 1] / 255;
      if (channel === 'b') return heightData[i + 2] / 255;
      // luminance
      return (0.299 * heightData[i] + 0.587 * heightData[i + 1] + 0.114 * heightData[i + 2]) / 255;
    };

    const v00 = sample(x0, y0);
    const v10 = sample(x1, y0);
    const v01 = sample(x0, y1);
    const v11 = sample(x1, y1);
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  }

  /**
   * Applies a height-map-driven displacement to a mesh, pushing vertices
   * along their normals by an amount proportional to the texture value at
   * the corresponding UV coordinate.
   *
   * This is a CPU-side operation that produces a NEW BufferGeometry
   * (does not mutate the input). For use with D137 Texture Extrude.
   *
   * @param geometry    Source geometry (must have position, normal, uv attributes)
   * @param heightData  Flat RGBA pixel array (Uint8ClampedArray from canvas.getImageData)
   * @param imageWidth  Width of the height map in pixels
   * @param imageHeight Height of the height map in pixels
   * @param strength    Max displacement distance in model units (positive = outward along normal)
   * @param channel     Which channel to read height from: 'r' | 'g' | 'b' | 'luminance' (default: 'luminance')
   * @returns           A NEW BufferGeometry with displaced positions (same topology as input)
   */
  static computeTextureExtrude(
    geometry: THREE.BufferGeometry,
    heightData: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    strength: number,
    channel: 'r' | 'g' | 'b' | 'luminance' = 'luminance',
  ): THREE.BufferGeometry {
    const out = geometry.clone();

    const posAttr = out.attributes.position as THREE.BufferAttribute | undefined;
    const normAttr = out.attributes.normal as THREE.BufferAttribute | undefined;
    const uvAttr = out.attributes.uv as THREE.BufferAttribute | undefined;

    // If any required attribute is missing, return the clone unchanged
    if (!posAttr || !normAttr || !uvAttr) return out;

    const vertexCount = posAttr.count;

    for (let i = 0; i < vertexCount; i++) {
      // Read UV and clamp to [0, 1]
      const u = Math.max(0, Math.min(1, uvAttr.getX(i)));
      const v = Math.max(0, Math.min(1, uvAttr.getY(i)));

      // Bilinear sample of the height map
      const height = GeometryEngine.sampleHeightBilinear(
        heightData, imageWidth, imageHeight, u, v, channel,
      );

      // Read normal components
      const nx = normAttr.getX(i);
      const ny = normAttr.getY(i);
      const nz = normAttr.getZ(i);

      // Displace position along normal
      const px = posAttr.getX(i) + nx * height * strength;
      const py = posAttr.getY(i) + ny * height * strength;
      const pz = posAttr.getZ(i) + nz * height * strength;

      posAttr.setXYZ(i, px, py, pz);
    }

    posAttr.needsUpdate = true;

    // Recompute normals after displacement
    out.computeVertexNormals();

    return out;
  }

  /**
   * Loads an image URL and returns its pixel data as a Uint8ClampedArray.
   * Requires a browser environment (uses canvas).
   *
   * @returns Promise resolving to { data, width, height }
   */
  static async loadImageAsHeightData(
    url: string,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ data: imageData.data, width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ---------------------------------------------------------------------------
  // D46 Project to Surface — surface projection helpers
  // ---------------------------------------------------------------------------

  /**
   * Projects an array of 3D world-space points onto the nearest surface of a mesh.
   * Uses BVH-style ray casting: for each point, casts a ray toward the mesh center
   * to find the closest intersection, then uses the hit face normal to find the
   * true closest surface point.
   *
   * Practical use: D46 Project to Surface — projects sketch curve points onto
   * a body surface to create a 3D curve on the surface.
   *
   * @param points    World-space source points to project
   * @param mesh      Target surface mesh (must have matrixWorld applied)
   * @param direction Optional projection direction (world-space unit vector).
   *                  If omitted, projects along the closest surface normal.
   * @returns         Projected points (same length as input). Points that miss the
   *                  mesh are returned at the closest found position, or unchanged
   *                  if no hit is possible.
   */
  static projectPointsOntoMesh(
    points: THREE.Vector3[],
    mesh: THREE.Mesh,
    direction?: THREE.Vector3,
  ): THREE.Vector3[] {
    mesh.updateWorldMatrix(true, false);

    // Precompute world-space bounding sphere for early-out checks
    const geom = mesh.geometry;
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const localSphere = geom.boundingSphere!;
    const worldCenter = localSphere.center.clone().applyMatrix4(mesh.matrixWorld);
    // Scale the radius by the largest axis scale of matrixWorld
    const scaleVec = new THREE.Vector3();
    mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scaleVec);
    const worldRadius = localSphere.radius * Math.max(Math.abs(scaleVec.x), Math.abs(scaleVec.y), Math.abs(scaleVec.z));

    const raycaster = new THREE.Raycaster();
    const result: THREE.Vector3[] = [];

    const SIX_DIRS: THREE.Vector3[] = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];

    for (const p of points) {
      let bestHit: THREE.Vector3 | null = null;
      let bestDist = Infinity;

      if (direction) {
        // Directional projection: cast from p - dir*1000 toward dir
        const castDir = direction.clone().normalize();
        const origin = p.clone().addScaledVector(castDir, -1000);
        raycaster.set(origin, castDir);
        raycaster.near = 0;
        raycaster.far = Infinity;
        const hits = raycaster.intersectObject(mesh, false);
        for (const hit of hits) {
          const d = hit.point.distanceTo(p);
          if (d < bestDist) {
            bestDist = d;
            bestHit = hit.point.clone();
          }
        }
      } else {
        // Multi-direction sampling: cast 6 axis-aligned rays from p
        for (const dir of SIX_DIRS) {
          raycaster.set(p, dir);
          raycaster.near = 0;
          raycaster.far = Infinity;
          const hits = raycaster.intersectObject(mesh, false);
          for (const hit of hits) {
            const d = hit.point.distanceTo(p);
            if (d < bestDist) {
              bestDist = d;
              bestHit = hit.point.clone();
            }
          }
        }
      }

      if (bestHit) {
        result.push(bestHit);
        continue;
      }

      // Fallback: cast from mesh bounding sphere center toward p (inward)
      const fallbackDir = p.clone().sub(worldCenter);
      const fallbackLen = fallbackDir.length();
      if (fallbackLen > 1e-9) {
        fallbackDir.normalize();
        raycaster.set(worldCenter, fallbackDir);
        raycaster.near = 0;
        raycaster.far = fallbackLen + worldRadius * 2;
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length > 0) {
          // Find hit closest to p
          let closestHit = hits[0].point.clone();
          let closestD = hits[0].point.distanceTo(p);
          for (let i = 1; i < hits.length; i++) {
            const d = hits[i].point.distanceTo(p);
            if (d < closestD) { closestD = d; closestHit = hits[i].point.clone(); }
          }
          result.push(closestHit);
          continue;
        }
      }

      // No hit at all — return p unchanged
      result.push(p.clone());
    }

    return result;
  }

  /**
   * Takes a projected polyline (from projectPointsOntoMesh) and smooths/re-samples
   * it by recursively subdividing edges that deviate from the surface.
   *
   * @param polyline    World-space projected points
   * @param mesh        The surface mesh
   * @param maxError    Max deviation allowed (model units, default 0.1)
   * @param maxDepth    Max recursion depth (default 4)
   * @returns           Refined polyline that more closely follows the surface
   */
  static discretizeCurveOnSurface(
    polyline: THREE.Vector3[],
    mesh: THREE.Mesh,
    maxError = 0.1,
    maxDepth = 4,
  ): THREE.Vector3[] {
    if (polyline.length < 2) return polyline.map((p) => p.clone());

    mesh.updateWorldMatrix(true, false);

    const subdivide = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      depth: number,
    ): THREE.Vector3[] => {
      if (depth <= 0) return [b.clone()];

      // Midpoint in straight-line space
      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      // Project midpoint onto the surface
      const projected = GeometryEngine.projectPointsOntoMesh([mid], mesh)[0];

      // Check deviation: distance from straight-line midpoint to projected midpoint
      const deviation = projected.distanceTo(mid);
      if (deviation <= maxError) {
        return [b.clone()];
      }

      // Insert projected midpoint and recurse on both halves
      return [
        ...subdivide(a, projected, depth - 1),
        ...subdivide(projected, b, depth - 1),
      ];
    };

    const result: THREE.Vector3[] = [polyline[0].clone()];
    for (let i = 0; i < polyline.length - 1; i++) {
      const refined = subdivide(polyline[i], polyline[i + 1], maxDepth);
      result.push(...refined);
    }
    return result;
  }

  // ── SFC7: Fill Surface ─────────────────────────────────────────────────────
  /**
   * Creates a planar or blended patch from boundary polylines.
   * - G0: fan triangulation from centroid
   * - G1/G2: blend boundary points toward centroid for a smoother interior
   */
  static fillSurface(
    boundaryPoints: THREE.Vector3[][],
    continuity: ('G0' | 'G1' | 'G2')[],
  ): THREE.BufferGeometry {
    // Compute centroid of all boundary points
    const allPts: THREE.Vector3[] = [];
    for (const edge of boundaryPoints) allPts.push(...edge);

    const centroid = new THREE.Vector3();
    for (const p of allPts) centroid.add(p);
    if (allPts.length > 0) centroid.divideScalar(allPts.length);

    const positions: number[] = [];
    const indices: number[] = [];

    // For each edge, generate interior sample points blended toward centroid
    for (let ei = 0; ei < boundaryPoints.length; ei++) {
      const edge = boundaryPoints[ei];
      const cont = continuity[ei] ?? 'G0';
      const blendFactor = cont === 'G2' ? 0.5 : cont === 'G1' ? 0.3 : 0.0;

      const edgePts: THREE.Vector3[] = edge.map((p) => {
        if (blendFactor === 0) return p.clone();
        return new THREE.Vector3().lerpVectors(p, centroid, blendFactor);
      });

      // Fan from centroid to each consecutive pair in this edge
      const cIdx = positions.length / 3;
      positions.push(centroid.x, centroid.y, centroid.z);

      for (const p of edgePts) {
        positions.push(p.x, p.y, p.z);
      }

      for (let i = 0; i < edgePts.length - 1; i++) {
        indices.push(cIdx, cIdx + 1 + i, cIdx + 2 + i);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  // ── SFC8: Offset Curve to Surface ─────────────────────────────────────────
  /**
   * Offsets an open polyline curve by distance along referenceNormal, returning
   * a strip of quads (two triangles each) between original and offset polyline.
   */
  static offsetCurveToSurface(
    points: THREE.Vector3[],
    distance: number,
    referenceNormal: THREE.Vector3,
  ): THREE.BufferGeometry {
    if (points.length < 2) return new THREE.BufferGeometry();

    const n = referenceNormal.clone().normalize();
    const offset = n.clone().multiplyScalar(distance);

    const positions: number[] = [];
    const indices: number[] = [];

    // Build two rows: original (even indices) and offset (odd indices)
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      positions.push(q.x, q.y, q.z);
    }

    // Quads: for each consecutive pair of columns
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      // Two triangles per quad
      indices.push(a, b, c);
      indices.push(b, d, c);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  // ── SFC16: Merge Surfaces ─────────────────────────────────────────────────
  /**
   * Merges two meshes by combining their vertex buffers, offsetting B's indices,
   * and welding duplicate vertices within a tolerance.
   */
  static mergeSurfaces(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.BufferGeometry {
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);

    const geomA = meshA.geometry.clone().applyMatrix4(meshA.matrixWorld);
    const geomB = meshB.geometry.clone().applyMatrix4(meshB.matrixWorld);

    const posA = geomA.attributes.position as THREE.BufferAttribute;
    const posB = geomB.attributes.position as THREE.BufferAttribute;
    const idxA = geomA.index;
    const idxB = geomB.index;

    const countA = posA.count;
    const countB = posB.count;

    const merged = new Float32Array((countA + countB) * 3);
    for (let i = 0; i < countA; i++) {
      merged[i * 3]     = posA.getX(i);
      merged[i * 3 + 1] = posA.getY(i);
      merged[i * 3 + 2] = posA.getZ(i);
    }
    for (let i = 0; i < countB; i++) {
      merged[(countA + i) * 3]     = posB.getX(i);
      merged[(countA + i) * 3 + 1] = posB.getY(i);
      merged[(countA + i) * 3 + 2] = posB.getZ(i);
    }

    const indicesA: number[] = [];
    if (idxA) {
      for (let i = 0; i < idxA.count; i++) indicesA.push(idxA.getX(i));
    } else {
      for (let i = 0; i < countA; i++) indicesA.push(i);
    }

    const indicesB: number[] = [];
    if (idxB) {
      for (let i = 0; i < idxB.count; i++) indicesB.push(idxB.getX(i) + countA);
    } else {
      for (let i = 0; i < countB; i++) indicesB.push(countA + i);
    }

    const allIndices = [...indicesA, ...indicesB];

    // Weld duplicate vertices within tolerance 1e-4
    const TOL = 1e-4;
    const remapTable = new Int32Array(countA + countB);
    const keptPos: number[] = [];
    for (let i = 0; i < countA + countB; i++) {
      const ix = merged[i * 3], iy = merged[i * 3 + 1], iz = merged[i * 3 + 2];
      let found = -1;
      for (let j = 0; j < keptPos.length / 3; j++) {
        const dx = keptPos[j * 3] - ix, dy = keptPos[j * 3 + 1] - iy, dz = keptPos[j * 3 + 2] - iz;
        if (dx * dx + dy * dy + dz * dz < TOL * TOL) { found = j; break; }
      }
      if (found === -1) {
        remapTable[i] = keptPos.length / 3;
        keptPos.push(ix, iy, iz);
      } else {
        remapTable[i] = found;
      }
    }

    const remappedIndices = allIndices.map((i) => remapTable[i]);

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keptPos, 3));
    out.setIndex(remappedIndices);
    out.computeVertexNormals();

    geomA.dispose();
    geomB.dispose();
    return out;
  }

  // ── SFC22: Surface Primitives ─────────────────────────────────────────────
  /**
   * Creates open surface geometry for common primitive shapes.
   */
  static createSurfacePrimitive(
    type: 'plane' | 'box' | 'sphere' | 'cylinder' | 'torus' | 'cone',
    params: Record<string, number>,
  ): THREE.BufferGeometry {
    switch (type) {
      case 'plane': {
        const w = params.width ?? 10;
        const h = params.height ?? 10;
        return new THREE.PlaneGeometry(w, h);
      }
      case 'box': {
        const w = params.width ?? 10;
        const h = params.height ?? 10;
        const d = params.depth ?? 10;
        // Six separate PlaneGeometry faces merged into one geometry
        const hw = w / 2, hh = h / 2, hd = d / 2;
        const faces = [
          // +X, -X, +Y, -Y, +Z, -Z
          { axis: 'x',  sign:  1, pos: new THREE.Vector3( hw,  0,  0), rot: [0,  Math.PI / 2, 0], size: [d, h] },
          { axis: 'x',  sign: -1, pos: new THREE.Vector3(-hw,  0,  0), rot: [0, -Math.PI / 2, 0], size: [d, h] },
          { axis: 'y',  sign:  1, pos: new THREE.Vector3(  0, hh,  0), rot: [-Math.PI / 2, 0, 0], size: [w, d] },
          { axis: 'y',  sign: -1, pos: new THREE.Vector3(  0,-hh,  0), rot: [ Math.PI / 2, 0, 0], size: [w, d] },
          { axis: 'z',  sign:  1, pos: new THREE.Vector3(  0,  0, hd), rot: [0,  0, 0], size: [w, h] },
          { axis: 'z',  sign: -1, pos: new THREE.Vector3(  0,  0,-hd), rot: [0, Math.PI, 0], size: [w, h] },
        ] as const;

        const allPos: number[] = [];
        const allIdx: number[] = [];
        let vertOffset = 0;

        for (const face of faces) {
          const pg = new THREE.PlaneGeometry(face.size[0], face.size[1]);
          pg.applyMatrix4(
            new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...face.rot as [number, number, number])),
          );
          pg.applyMatrix4(new THREE.Matrix4().makeTranslation(face.pos.x, face.pos.y, face.pos.z));

          const posAttr = pg.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < posAttr.count; i++) {
            allPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          }
          if (pg.index) {
            for (let i = 0; i < pg.index.count; i++) allIdx.push(pg.index.getX(i) + vertOffset);
          } else {
            for (let i = 0; i < posAttr.count; i++) allIdx.push(i + vertOffset);
          }
          vertOffset += posAttr.count;
          pg.dispose();
        }

        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
        out.setIndex(allIdx);
        out.computeVertexNormals();
        return out;
      }
      case 'sphere': {
        const r = params.radius ?? 5;
        return new THREE.SphereGeometry(r, 32, 16);
      }
      case 'cylinder': {
        const r = params.radius ?? 5;
        const h = params.height2 ?? params.height ?? 10;
        return new THREE.CylinderGeometry(r, r, h, 32, 1, true);
      }
      case 'torus': {
        const r = params.radius ?? 8;
        const tube = params.tube ?? 2;
        return new THREE.TorusGeometry(r, tube, 16, 100);
      }
      case 'cone': {
        const r = params.radius ?? 5;
        const h = params.height2 ?? params.height ?? 10;
        return new THREE.ConeGeometry(r, h, 32, 1, true);
      }
      default:
        return new THREE.BufferGeometry();
    }
  }

  // ── SFC9 — Offset Surface ──────────────────────────────────────────────────
  /**
   * Offsets every vertex of a mesh along its vertex normal by `distance`.
   * For negative distances the face winding is reversed so outward normals
   * remain consistent.
   * Returns a new BufferGeometry (caller owns it — must dispose when done).
   */
  static offsetSurface(mesh: THREE.Mesh, distance: number): THREE.BufferGeometry {
    const src = mesh.geometry;
    const geo = src.clone();

    // Ensure vertex normals exist
    geo.computeVertexNormals();

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const nrmAttr = geo.attributes.normal as THREE.BufferAttribute;

    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXYZ(
        i,
        posAttr.getX(i) + nrmAttr.getX(i) * distance,
        posAttr.getY(i) + nrmAttr.getY(i) * distance,
        posAttr.getZ(i) + nrmAttr.getZ(i) * distance,
      );
    }
    posAttr.needsUpdate = true;

    // When offsetting inward (negative distance) flip winding so normals stay outward
    if (distance < 0) {
      GeometryEngine.reverseNormals(geo);
    } else {
      geo.computeVertexNormals();
    }

    return geo;
  }

  // ── SFC11 — Surface Extend ─────────────────────────────────────────────────
  /**
   * Extends the open boundary edges of a mesh outward by `distance`.
   * For each consecutive pair of boundary-edge vertices a quad (two triangles)
   * is appended, connecting the original boundary to the extended positions.
   *
   * Extension directions per mode:
   *   'natural'      — average of incident face normals crossed with edge direction
   *                    gives a tangent-plane outward vector (same as 'tangent').
   *   'tangent'      — extend along the boundary-edge tangent direction projected
   *                    into the surface plane.
   *   'perpendicular'— extend perpendicular to the boundary edge in the surface plane.
   *
   * Returns a new BufferGeometry (original triangles + extension quads).
   * Caller owns and must dispose the returned geometry.
   */
  static extendSurface(
    mesh: THREE.Mesh,
    distance: number,
    mode: 'natural' | 'tangent' | 'perpendicular',
  ): THREE.BufferGeometry {
    const src = mesh.geometry;
    src.computeVertexNormals();

    const posAttr = src.attributes.position as THREE.BufferAttribute;
    const nrmAttr = src.attributes.normal as THREE.BufferAttribute;
    const idxAttr = src.index;

    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const getIdx = (tri: number, slot: number): number =>
      idxAttr ? idxAttr.getX(tri * 3 + slot) : tri * 3 + slot;

    // ── Build boundary edge set ──────────────────────────────────────────────
    // An edge is a boundary edge if it appears in exactly one triangle.
    // Key: `min,max` of its two vertex indices.
    const edgeTriCount = new Map<string, number>();
    // Also store directed edge (a→b) for each triangle so we know orientation
    const directedEdges: Array<[number, number]> = [];

    for (let t = 0; t < triCount; t++) {
      const a = getIdx(t, 0), b = getIdx(t, 1), c = getIdx(t, 2);
      for (const [ea, eb] of [[a, b], [b, c], [c, a]] as const) {
        const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
        edgeTriCount.set(key, (edgeTriCount.get(key) ?? 0) + 1);
        directedEdges.push([ea, eb]);
      }
    }

    // Collect boundary edges (appear once only), preserving direction from the triangle
    const boundaryEdges: Array<[number, number]> = [];
    for (const [ea, eb] of directedEdges) {
      const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
      if (edgeTriCount.get(key) === 1) {
        // Avoid duplicating: only keep the first encounter (which is from the triangle)
        if (!boundaryEdges.some(([x, y]) => (x === ea && y === eb))) {
          boundaryEdges.push([ea, eb]);
        }
      }
    }

    // ── Copy original geometry data ──────────────────────────────────────────
    const origPositions: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      origPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    }

    const origIndices: number[] = [];
    for (let t = 0; t < triCount; t++) {
      origIndices.push(getIdx(t, 0), getIdx(t, 1), getIdx(t, 2));
    }

    // ── Build extension quads ────────────────────────────────────────────────
    const newPositions: number[] = [...origPositions];
    const newIndices: number[] = [...origIndices];

    const getVert = (vi: number) =>
      new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
    const getVertNorm = (vi: number) =>
      new THREE.Vector3(nrmAttr.getX(vi), nrmAttr.getY(vi), nrmAttr.getZ(vi)).normalize();

    const extendDir = (va: THREE.Vector3, vb: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3): { da: THREE.Vector3; db: THREE.Vector3 } => {
      const edgeDir = vb.clone().sub(va).normalize();

      if (mode === 'perpendicular') {
        // Perpendicular to edge in the surface plane: cross(edge, surfaceNormal)
        const da = new THREE.Vector3().crossVectors(edgeDir, na).normalize();
        const db = new THREE.Vector3().crossVectors(edgeDir, nb).normalize();
        // Flip if pointing inward — we want outward
        return { da, db };
      } else {
        // 'tangent' and 'natural': extend outward along surface plane
        // outward = cross(surfaceNormal, edge) projects into surface plane away from mesh
        const da = new THREE.Vector3().crossVectors(na, edgeDir).normalize();
        const db = new THREE.Vector3().crossVectors(nb, edgeDir).normalize();
        // If both directions point the same general direction as their normals projected
        // onto the boundary plane, they're already outward. If mode is 'natural' use avg.
        if (mode === 'natural') {
          const avgDir = da.clone().add(db).normalize();
          return { da: avgDir.clone(), db: avgDir.clone() };
        }
        return { da, db };
      }
    };

    const baseCount = posAttr.count;

    for (const [ai, bi] of boundaryEdges) {
      const va = getVert(ai), vb = getVert(bi);
      const na = getVertNorm(ai), nb = getVertNorm(bi);

      const { da, db } = extendDir(va, vb, na, nb);

      const vc = va.clone().addScaledVector(da, distance); // extended ai
      const vd = vb.clone().addScaledVector(db, distance); // extended bi

      const ci = newPositions.length / 3;
      newPositions.push(vc.x, vc.y, vc.z);
      const di = newPositions.length / 3;
      newPositions.push(vd.x, vd.y, vd.z);

      // Quad: ai→bi→di→ci  (two triangles maintaining CCW winding)
      // Offset ci/di by baseCount because they're appended after original verts
      const ciIdx = baseCount + (ci - baseCount);
      const diIdx = baseCount + (di - baseCount);
      newIndices.push(ai, bi, diIdx);
      newIndices.push(ai, diIdx, ciIdx);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── SFC17 — Thicken Surface ────────────────────────────────────────────────
  /**
   * Converts a surface body into a solid by:
   * 1. Creating an offset shell (positive or negative depending on `direction`)
   * 2. Building quad side-walls along the boundary edges connecting original to offset
   * 3. Merging all geometry into one closed BufferGeometry
   *
   * For symmetric: offsets +thickness/2 outward and -thickness/2 inward.
   * Returns a new BufferGeometry. Caller owns it (must dispose when done).
   */
  static thickenSurface(
    mesh: THREE.Mesh,
    thickness: number,
    direction: 'inside' | 'outside' | 'symmetric',
  ): THREE.BufferGeometry {
    const t = Math.abs(thickness);

    // Determine offset distances for inner and outer shells
    let outerDist: number, innerDist: number;
    if (direction === 'outside') {
      outerDist = t;
      innerDist = 0;
    } else if (direction === 'inside') {
      outerDist = 0;
      innerDist = -t;
    } else {
      // symmetric
      outerDist = t / 2;
      innerDist = -(t / 2);
    }

    // ── Build offset shell geometries ────────────────────────────────────────
    const srcGeo = mesh.geometry;
    srcGeo.computeVertexNormals();

    const posAttr = srcGeo.attributes.position as THREE.BufferAttribute;
    const nrmAttr = srcGeo.attributes.normal as THREE.BufferAttribute;
    const idxAttr = srcGeo.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const getIdx = (tri: number, slot: number): number =>
      idxAttr ? idxAttr.getX(tri * 3 + slot) : tri * 3 + slot;

    // Helper: offset vertex positions by normal * dist
    const makeShell = (dist: number, flipWinding: boolean): { positions: number[]; indices: number[] } => {
      const positions: number[] = [];
      for (let i = 0; i < posAttr.count; i++) {
        positions.push(
          posAttr.getX(i) + nrmAttr.getX(i) * dist,
          posAttr.getY(i) + nrmAttr.getY(i) * dist,
          posAttr.getZ(i) + nrmAttr.getZ(i) * dist,
        );
      }
      const indices: number[] = [];
      for (let t2 = 0; t2 < triCount; t2++) {
        const a = getIdx(t2, 0), b = getIdx(t2, 1), c = getIdx(t2, 2);
        if (flipWinding) {
          indices.push(a, c, b);
        } else {
          indices.push(a, b, c);
        }
      }
      return { positions, indices };
    };

    const outer = makeShell(outerDist, false);
    const inner = makeShell(innerDist, true); // flip winding so inner shell normals face inward

    // ── Find boundary edges for side walls ───────────────────────────────────
    const edgeCount = new Map<string, number>();
    const directedEdges: Array<[number, number]> = [];

    for (let t2 = 0; t2 < triCount; t2++) {
      const a = getIdx(t2, 0), b = getIdx(t2, 1), c = getIdx(t2, 2);
      for (const [ea, eb] of [[a, b], [b, c], [c, a]] as const) {
        const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        directedEdges.push([ea, eb]);
      }
    }

    const boundaryEdges: Array<[number, number]> = [];
    for (const [ea, eb] of directedEdges) {
      const key = ea < eb ? `${ea},${eb}` : `${eb},${ea}`;
      if (edgeCount.get(key) === 1) {
        if (!boundaryEdges.some(([x, y]) => x === ea && y === eb)) {
          boundaryEdges.push([ea, eb]);
        }
      }
    }

    // ── Merge all geometry ───────────────────────────────────────────────────
    // Layout: [outer verts | inner verts]
    const outerVertCount = posAttr.count;
    const innerVertCount = posAttr.count;
    const allPositions: number[] = [...outer.positions, ...inner.positions];
    const allIndices: number[] = [...outer.indices];

    // Inner shell indices are offset by outerVertCount
    for (const idx of inner.indices) {
      allIndices.push(idx + outerVertCount);
    }

    // Side wall quads for each boundary edge
    // outer ai/bi (indices as-is), inner ai/bi (offset by outerVertCount)
    for (const [ai, bi] of boundaryEdges) {
      const outerA = ai;
      const outerB = bi;
      const innerA = ai + outerVertCount;
      const innerB = bi + outerVertCount;

      // Two triangles forming a quad bridging outer→inner
      allIndices.push(outerA, outerB, innerB);
      allIndices.push(outerA, innerB, innerA);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    geo.setIndex(allIndices);
    geo.computeVertexNormals();

    // Dispose temporary clones — none were created here (we built arrays directly)
    void innerVertCount; // suppress unused-variable lint

    return geo;
  }

  // ── SFC12 — Stitch ──────────────────────────────────────────────────────────
  /**
   * Merge adjacent surface bodies into a single quilt (or a closed solid if
   * fully enclosed).
   *
   * Algorithm:
   * 1. Combine all mesh geometries into one world-space buffer.
   * 2. Weld boundary vertices that are within `tolerance` of each other using a
   *    union-find (disjoint set) structure.
   * 3. Detect closure: if no boundary edges remain, the result is a solid.
   * 4. Rebuild the geometry with welded indices and recompute vertex normals.
   */
  static stitchSurfaces(
    meshes: THREE.Mesh[],
    tolerance = 1e-3,
  ): { geometry: THREE.BufferGeometry; isSolid: boolean } {
    if (meshes.length === 0) {
      return { geometry: new THREE.BufferGeometry(), isSolid: false };
    }

    // ── 1. Combine all meshes into flat world-space arrays ───────────────────
    const allPositions: number[] = [];
    const allIndices: number[] = [];
    // Track which mesh each vertex came from (for cross-mesh welding only)
    const vertexMeshId: number[] = [];

    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      mesh.updateWorldMatrix(true, false);
      const m = mesh.matrixWorld;
      const geom = mesh.geometry;
      const posAttr = geom.attributes.position as THREE.BufferAttribute;
      const idxAttr = geom.index;
      const baseVertex = allPositions.length / 3;

      // Transform every vertex into world space
      const tmpV = new THREE.Vector3();
      for (let vi = 0; vi < posAttr.count; vi++) {
        tmpV.fromBufferAttribute(posAttr, vi).applyMatrix4(m);
        allPositions.push(tmpV.x, tmpV.y, tmpV.z);
        vertexMeshId.push(mi);
      }

      // Offset index references
      if (idxAttr) {
        for (let ii = 0; ii < idxAttr.count; ii++) {
          allIndices.push(idxAttr.getX(ii) + baseVertex);
        }
      } else {
        for (let ii = 0; ii < posAttr.count; ii++) {
          allIndices.push(ii + baseVertex);
        }
      }
    }

    const vertCount = allPositions.length / 3;

    // ── 2. Union-Find (disjoint set) for vertex welding ──────────────────────
    const parent = new Int32Array(vertCount);
    for (let i = 0; i < vertCount; i++) parent[i] = i;

    function find(x: number): number {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]]; // path compression
        x = parent[x];
      }
      return x;
    }
    function union(a: number, b: number): void {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    const tol2 = tolerance * tolerance;

    // Weld vertices that are from different meshes and within tolerance
    // We use a spatial bucket (grid hash) to avoid O(n²) brute force.
    const cellSize = tolerance * 2;
    const buckets = new Map<string, number[]>();
    function cellKey(x: number, y: number, z: number): string {
      return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
    }

    for (let vi = 0; vi < vertCount; vi++) {
      const bx = allPositions[vi * 3];
      const by = allPositions[vi * 3 + 1];
      const bz = allPositions[vi * 3 + 2];
      const key = cellKey(bx, by, bz);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(vi);
    }

    // For each vertex, check its own cell and the 26 neighbour cells
    const offsets = [-1, 0, 1];
    for (let vi = 0; vi < vertCount; vi++) {
      const vx = allPositions[vi * 3];
      const vy = allPositions[vi * 3 + 1];
      const vz = allPositions[vi * 3 + 2];
      const cx = Math.floor(vx / cellSize);
      const cy = Math.floor(vy / cellSize);
      const cz = Math.floor(vz / cellSize);

      for (const dx of offsets) {
        for (const dy of offsets) {
          for (const dz of offsets) {
            const nbs = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!nbs) continue;
            for (const ui of nbs) {
              if (ui <= vi) continue; // avoid duplicate pairs
              // Only weld vertices from different source meshes
              if (vertexMeshId[vi] === vertexMeshId[ui]) continue;
              const dx2 = vx - allPositions[ui * 3];
              const dy2 = vy - allPositions[ui * 3 + 1];
              const dz2 = vz - allPositions[ui * 3 + 2];
              if (dx2 * dx2 + dy2 * dy2 + dz2 * dz2 <= tol2) {
                union(vi, ui);
              }
            }
          }
        }
      }
    }

    // Remap every index to its canonical root
    const weldedIndices = allIndices.map((i) => find(i));

    // ── 3. Check closure (boundary edges) ────────────────────────────────────
    // A boundary edge appears in exactly one triangle.
    const edgeCount = new Map<string, number>();
    const triCount = weldedIndices.length / 3;
    for (let ti = 0; ti < triCount; ti++) {
      const a = weldedIndices[ti * 3];
      const b = weldedIndices[ti * 3 + 1];
      const c = weldedIndices[ti * 3 + 2];
      const edges: [number, number][] = [
        [Math.min(a, b), Math.max(a, b)],
        [Math.min(b, c), Math.max(b, c)],
        [Math.min(a, c), Math.max(a, c)],
      ];
      for (const [ea, eb] of edges) {
        const ek = `${ea}_${eb}`;
        edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
      }
    }
    let isSolid = true;
    for (const count of edgeCount.values()) {
      if (count === 1) { isSolid = false; break; }
    }

    // ── 4. Compact positions to only referenced vertices ─────────────────────
    const usedRoots = new Set(weldedIndices);
    const rootToCompact = new Map<number, number>();
    const compactPositions: number[] = [];
    for (const root of usedRoots) {
      rootToCompact.set(root, compactPositions.length / 3);
      compactPositions.push(
        allPositions[root * 3],
        allPositions[root * 3 + 1],
        allPositions[root * 3 + 2],
      );
    }
    const compactIndices = weldedIndices.map((r) => rootToCompact.get(r)!);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(compactPositions, 3));
    geometry.setIndex(compactIndices);
    geometry.computeVertexNormals();

    return { geometry, isSolid };
  }

  // ── SFC13 — Unstitch ─────────────────────────────────────────────────────────
  /**
   * Split a stitched quilt back into its component face groups.
   *
   * Algorithm:
   * 1. Build a face-adjacency graph: two triangles are adjacent if they share an
   *    edge (by index).
   * 2. Find connected components of triangles via BFS.
   * 3. Extract each component into its own BufferGeometry with re-indexed verts.
   *
   * Returns one geometry per connected component. If there is only one component
   * the original geometry is returned in a single-element array (no copy).
   */
  static unstitchSurface(mesh: THREE.Mesh): THREE.BufferGeometry[] {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index;

    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    if (triCount === 0) return [geom];

    const getTri = (ti: number): [number, number, number] => {
      if (idxAttr) {
        return [idxAttr.getX(ti * 3), idxAttr.getX(ti * 3 + 1), idxAttr.getX(ti * 3 + 2)];
      }
      return [ti * 3, ti * 3 + 1, ti * 3 + 2];
    };

    // ── 1. Build edge → triangle adjacency ──────────────────────────────────
    // Key: "minVert_maxVert" → array of triangle indices that share that edge
    const edgeToTris = new Map<string, number[]>();
    for (let ti = 0; ti < triCount; ti++) {
      const [a, b, c] = getTri(ti);
      const pairs: [number, number][] = [
        [Math.min(a, b), Math.max(a, b)],
        [Math.min(b, c), Math.max(b, c)],
        [Math.min(a, c), Math.max(a, c)],
      ];
      for (const [ea, eb] of pairs) {
        const ek = `${ea}_${eb}`;
        if (!edgeToTris.has(ek)) edgeToTris.set(ek, []);
        edgeToTris.get(ek)!.push(ti);
      }
    }

    // ── 2. BFS to find connected components ──────────────────────────────────
    const componentId = new Int32Array(triCount).fill(-1);
    let numComponents = 0;

    for (let start = 0; start < triCount; start++) {
      if (componentId[start] !== -1) continue;
      const compIdx = numComponents++;
      const queue: number[] = [start];
      componentId[start] = compIdx;
      let head = 0;
      while (head < queue.length) {
        const ti = queue[head++];
        const [a, b, c] = getTri(ti);
        const pairs: [number, number][] = [
          [Math.min(a, b), Math.max(a, b)],
          [Math.min(b, c), Math.max(b, c)],
          [Math.min(a, c), Math.max(a, c)],
        ];
        for (const [ea, eb] of pairs) {
          const neighbours = edgeToTris.get(`${ea}_${eb}`);
          if (!neighbours) continue;
          for (const ni of neighbours) {
            if (componentId[ni] === -1) {
              componentId[ni] = compIdx;
              queue.push(ni);
            }
          }
        }
      }
    }

    // If only one component, return as-is
    if (numComponents === 1) return [geom];

    // ── 3. Extract each component into its own BufferGeometry ────────────────
    const results: THREE.BufferGeometry[] = [];

    for (let ci = 0; ci < numComponents; ci++) {
      const compPositions: number[] = [];
      const compIndices: number[] = [];
      const oldToNew = new Map<number, number>();

      for (let ti = 0; ti < triCount; ti++) {
        if (componentId[ti] !== ci) continue;
        const [a, b, c] = getTri(ti);
        for (const vi of [a, b, c]) {
          if (!oldToNew.has(vi)) {
            oldToNew.set(vi, compPositions.length / 3);
            compPositions.push(
              posAttr.getX(vi),
              posAttr.getY(vi),
              posAttr.getZ(vi),
            );
          }
          compIndices.push(oldToNew.get(vi)!);
        }
      }

      const compGeo = new THREE.BufferGeometry();
      compGeo.setAttribute('position', new THREE.Float32BufferAttribute(compPositions, 3));
      compGeo.setIndex(compIndices);
      compGeo.computeVertexNormals();
      results.push(compGeo);
    }

    return results;
  }

  // ── SFC10 — Surface Trim ──────────────────────────────────────────────────
  /**
   * Trims `mesh` against `trimmerMesh` (or a plane derived from it).
   *
   * Strategy: extract the first-triangle plane of the trimmer, then keep only
   * the triangles on the `keepSide` of that plane.  Open-boundary — no cap is
   * added (surface trim, not solid).
   *
   * @returns New BufferGeometry containing only the kept triangles.
   */
  static trimSurface(
    mesh: THREE.Mesh,
    trimmerMesh: THREE.Mesh,
    keepSide: 'inside' | 'outside',
  ): THREE.BufferGeometry {
    // ── Derive a cutting plane from the trimmer's first triangle ─────────────
    trimmerMesh.updateWorldMatrix(true, false);
    const trimmerTris = GeometryEngine._extractWorldTriangles(trimmerMesh);
    if (trimmerTris.length === 0) {
      // Nothing to trim against — return a clone of the original geometry
      return mesh.geometry.clone();
    }
    const [tp0, tp1, tp2] = trimmerTris[0];
    const edge1 = tp1.clone().sub(tp0);
    const edge2 = tp2.clone().sub(tp0);
    const planeNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    const cuttingPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, tp0);

    // ── Walk triangles of the source mesh ────────────────────────────────────
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;

    const getTri = (ti: number): [number, number, number] => {
      if (idxAttr) {
        return [idxAttr.getX(ti * 3), idxAttr.getX(ti * 3 + 1), idxAttr.getX(ti * 3 + 2)];
      }
      return [ti * 3, ti * 3 + 1, ti * 3 + 2];
    };

    const m = mesh.matrixWorld;
    const getWorldVert = (vi: number): THREE.Vector3 => {
      const v = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      return v.applyMatrix4(m);
    };

    const keptPositions: number[] = [];
    const keptIndices: number[] = [];
    let vertexCounter = 0;

    for (let ti = 0; ti < triCount; ti++) {
      const [ai, bi, ci] = getTri(ti);
      const wa = getWorldVert(ai);
      const wb = getWorldVert(bi);
      const wc = getWorldVert(ci);

      // Centroid classification
      const centroid = new THREE.Vector3().addVectors(wa, wb).add(wc).divideScalar(3);
      const dist = cuttingPlane.distanceToPoint(centroid);

      const onPositiveSide = dist >= 0;
      const keep = keepSide === 'outside' ? onPositiveSide : !onPositiveSide;

      if (!keep) continue;

      const base = vertexCounter;
      for (const wv of [wa, wb, wc]) {
        keptPositions.push(wv.x, wv.y, wv.z);
      }
      keptIndices.push(base, base + 1, base + 2);
      vertexCounter += 3;
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
    result.setIndex(keptIndices);
    result.computeVertexNormals();
    return result;
  }

  // ── SFC14 — Surface Split ─────────────────────────────────────────────────
  /**
   * Splits `mesh` by a plane (or by a plane derived from the first triangle of
   * a splitter mesh).  Triangles straddling the plane are cut at the plane edge.
   *
   * @returns Tuple [sideA geometry (positive half), sideB geometry (negative half)].
   *          Either may be empty if the plane misses the mesh entirely.
   */
  static splitSurface(
    mesh: THREE.Mesh,
    splitter: THREE.Mesh | THREE.Plane,
  ): THREE.BufferGeometry[] {
    // ── Derive cutting plane ──────────────────────────────────────────────────
    let plane: THREE.Plane;
    if (splitter instanceof THREE.Plane) {
      plane = splitter;
    } else {
      (splitter as THREE.Mesh).updateWorldMatrix(true, false);
      const tris = GeometryEngine._extractWorldTriangles(splitter as THREE.Mesh);
      if (tris.length === 0) {
        return [mesh.geometry.clone(), new THREE.BufferGeometry()];
      }
      const [sp0, sp1, sp2] = tris[0];
      const e1 = sp1.clone().sub(sp0);
      const e2 = sp2.clone().sub(sp0);
      const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, sp0);
    }

    // ── Walk source triangles ─────────────────────────────────────────────────
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;

    const getTri = (ti: number): [number, number, number] => {
      if (idxAttr) {
        return [idxAttr.getX(ti * 3), idxAttr.getX(ti * 3 + 1), idxAttr.getX(ti * 3 + 2)];
      }
      return [ti * 3, ti * 3 + 1, ti * 3 + 2];
    };

    const m = mesh.matrixWorld;
    const getWorldVert = (vi: number): THREE.Vector3 => {
      const v = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      return v.applyMatrix4(m);
    };

    // Each side: flat arrays of positions + index list
    const posA: number[] = [];
    const idxA: number[] = [];
    const posB: number[] = [];
    const idxB: number[] = [];

    const pushTri = (
      positions: number[],
      indices: number[],
      v0: THREE.Vector3,
      v1: THREE.Vector3,
      v2: THREE.Vector3,
    ) => {
      const base = positions.length / 3;
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      indices.push(base, base + 1, base + 2);
    };

    const edgeIntersect = (va: THREE.Vector3, da: number, vb: THREE.Vector3, db: number): THREE.Vector3 => {
      const t = da / (da - db);
      return new THREE.Vector3().lerpVectors(va, vb, t);
    };

    const TOL = 1e-6;

    for (let ti = 0; ti < triCount; ti++) {
      const [ai, bi, ci] = getTri(ti);
      const verts = [getWorldVert(ai), getWorldVert(bi), getWorldVert(ci)];
      const dists = verts.map((v) => plane.distanceToPoint(v));
      const sides = dists.map((d) => (d > TOL ? 1 : d < -TOL ? -1 : 0));

      // All on positive side
      if (sides[0] >= 0 && sides[1] >= 0 && sides[2] >= 0) {
        pushTri(posA, idxA, verts[0], verts[1], verts[2]);
        continue;
      }
      // All on negative side
      if (sides[0] <= 0 && sides[1] <= 0 && sides[2] <= 0) {
        pushTri(posB, idxB, verts[0], verts[1], verts[2]);
        continue;
      }

      // Mixed — need to cut.  Find the 1-vertex side and the 2-vertex side.
      // Determine which vertex is alone on one side.
      let loneIdx = -1;
      for (let k = 0; k < 3; k++) {
        const other0 = (k + 1) % 3;
        const other1 = (k + 2) % 3;
        if (
          (sides[k] > 0 && sides[other0] <= 0 && sides[other1] <= 0) ||
          (sides[k] < 0 && sides[other0] >= 0 && sides[other1] >= 0)
        ) {
          loneIdx = k;
          break;
        }
      }

      if (loneIdx === -1) {
        // Degenerate / on-plane — assign by centroid
        const cx = (dists[0] + dists[1] + dists[2]) / 3;
        if (cx >= 0) pushTri(posA, idxA, verts[0], verts[1], verts[2]);
        else pushTri(posB, idxB, verts[0], verts[1], verts[2]);
        continue;
      }

      const idxPair0 = (loneIdx + 1) % 3;
      const idxPair1 = (loneIdx + 2) % 3;
      const vLone = verts[loneIdx];
      const vP0 = verts[idxPair0];
      const vP1 = verts[idxPair1];
      const dLone = dists[loneIdx];
      const dP0 = dists[idxPair0];
      const dP1 = dists[idxPair1];

      // Two intersection points where lone-edge crosses the plane
      const cut0 = edgeIntersect(vLone, dLone, vP0, dP0);
      const cut1 = edgeIntersect(vLone, dLone, vP1, dP1);

      // lone vertex side = loneSign, pair side = opposite
      const loneSide = sides[loneIdx] > 0 ? posA : posB;
      const loneIdx_ = sides[loneIdx] > 0 ? idxA : idxB;
      const pairSide = sides[loneIdx] > 0 ? posB : idxB;
      const pairIdx = sides[loneIdx] > 0 ? idxB : posA; // intentional swap ref

      // lone triangle: vLone, cut0, cut1
      pushTri(loneSide, loneIdx_, vLone, cut0, cut1);

      // pair side: two triangles from quad (vP0, vP1, cut0, cut1)
      //   tri 1: vP0, vP1, cut0
      //   tri 2: vP1, cut1, cut0
      const pairPositions = sides[loneIdx] > 0 ? posB : posA;
      const pairIndices = sides[loneIdx] > 0 ? idxB : idxA;
      pushTri(pairPositions, pairIndices, vP0, vP1, cut0);
      pushTri(pairPositions, pairIndices, vP1, cut1, cut0);

      // suppress unused-variable warnings for the incorrectly aliased refs above
      void pairSide; void pairIdx;
    }

    const makeGeo = (positions: number[], indices: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      return g;
    };

    return [makeGeo(posA, idxA), makeGeo(posB, idxB)];
  }

  // ── SFC15 — Untrim ────────────────────────────────────────────────────────
  /**
   * Restores trimmed boundary edges by extruding them outward to an expanded
   * bounding box.  This approximates Fusion 360's "Untrim" which extends a
   * surface to its natural (untrimmed) boundary.
   *
   * Algorithm:
   * 1. Compute expanded Box3 of the mesh.
   * 2. Find boundary edges (edges referenced by exactly one triangle).
   * 3. For each boundary edge, project both vertices outward along the surface
   *    normal until they touch the expanded bounds, forming a quad patch.
   * 4. Merge original geometry + all patches into one BufferGeometry.
   *
   * @param mesh         Source surface mesh.
   * @param expandFactor How much to expand the bounding box (default 1.5×).
   * @returns New BufferGeometry with boundary extended.
   */
  static untrimSurface(mesh: THREE.Mesh, expandFactor = 1.5): THREE.BufferGeometry {
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const idxAttr = geom.index;
    const vertCount = posAttr.count;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const m = mesh.matrixWorld;

    const getTri = (ti: number): [number, number, number] => {
      if (idxAttr) {
        return [idxAttr.getX(ti * 3), idxAttr.getX(ti * 3 + 1), idxAttr.getX(ti * 3 + 2)];
      }
      return [ti * 3, ti * 3 + 1, ti * 3 + 2];
    };

    const getWorldVert = (vi: number): THREE.Vector3 => {
      const v = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      return v.applyMatrix4(m);
    };

    // ── 1. Expanded bounding box ──────────────────────────────────────────────
    const box = new THREE.Box3().setFromBufferAttribute(posAttr);
    // Transform box to world space
    box.applyMatrix4(m);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const expandedBox = new THREE.Box3(
      center.clone().sub(size.clone().multiplyScalar(expandFactor * 0.5)),
      center.clone().add(size.clone().multiplyScalar(expandFactor * 0.5)),
    );

    // ── 2. Find boundary edges ─────────────────────────────────────────────────
    // Edge key: "min_vi-max_vi"
    const edgeCount = new Map<string, number>();
    const edgeTriMap = new Map<string, [number, number]>(); // edge → triangle's two vertex indices

    for (let ti = 0; ti < triCount; ti++) {
      const [ai, bi, ci] = getTri(ti);
      const edges: [number, number][] = [[ai, bi], [bi, ci], [ci, ai]];
      for (const [ea, eb] of edges) {
        const key = `${Math.min(ea, eb)}-${Math.max(ea, eb)}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        if (!edgeTriMap.has(key)) edgeTriMap.set(key, [ea, eb]);
      }
    }

    // Boundary edges are those used exactly once
    const boundaryEdges: [number, number][] = [];
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        boundaryEdges.push(edgeTriMap.get(key)!);
      }
    }

    // ── 3. Compute average surface normal ─────────────────────────────────────
    // Used for projecting boundary verts outward
    let avgNormal = new THREE.Vector3();
    for (let ti = 0; ti < triCount; ti++) {
      const [ai, bi, ci] = getTri(ti);
      const wa = getWorldVert(ai);
      const wb = getWorldVert(bi);
      const wc = getWorldVert(ci);
      const e1 = wb.clone().sub(wa);
      const e2 = wc.clone().sub(wa);
      avgNormal.add(new THREE.Vector3().crossVectors(e1, e2));
    }
    if (avgNormal.lengthSq() < 1e-12) avgNormal = new THREE.Vector3(0, 1, 0);
    else avgNormal.normalize();

    // ── 4. Build original verts in world space ────────────────────────────────
    const allPositions: number[] = [];
    const allIndices: number[] = [];

    // Copy original triangles
    for (let vi = 0; vi < vertCount; vi++) {
      const wv = getWorldVert(vi);
      allPositions.push(wv.x, wv.y, wv.z);
    }
    for (let ti = 0; ti < triCount; ti++) {
      const [ai, bi, ci] = getTri(ti);
      allIndices.push(ai, bi, ci);
    }

    // ── 5. Extend boundary edges to expanded box ──────────────────────────────
    const clampToBox = (start: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 => {
      // Ray-box intersection: find smallest positive t so start + t*dir hits expanded box
      let tMin = 0;
      let tMax = Infinity;
      const dims: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
      for (const d of dims) {
        const o = start[d];
        const dv = dir[d];
        if (Math.abs(dv) < 1e-12) continue;
        const t1 = (expandedBox.min[d] - o) / dv;
        const t2 = (expandedBox.max[d] - o) / dv;
        const tEnter = Math.min(t1, t2);
        const tExit = Math.max(t1, t2);
        tMin = Math.max(tMin, tEnter);
        tMax = Math.min(tMax, tExit);
      }
      if (tMax < tMin || tMax <= 0) {
        // Ray doesn't hit box — return a small offset
        return start.clone().addScaledVector(dir, 1.0);
      }
      const t = Math.max(tMin, 0.1); // at least a small extension
      return start.clone().addScaledVector(dir, t);
    };

    for (const [ea, eb] of boundaryEdges) {
      const wa = getWorldVert(ea);
      const wb = getWorldVert(eb);

      // Outward direction: normal to the edge, in the plane of the surface normal
      const edgeDir = wb.clone().sub(wa).normalize();
      const outDir = new THREE.Vector3().crossVectors(avgNormal, edgeDir).normalize();
      // Ensure outward (away from mesh center)
      const toCenter = center.clone().sub(wa);
      if (outDir.dot(toCenter) > 0) outDir.negate();

      const wa2 = clampToBox(wa, outDir);
      const wb2 = clampToBox(wb, outDir);

      // Quad patch: wa, wb, wb2, wa2 → two triangles
      const base = allPositions.length / 3;
      allPositions.push(wa.x, wa.y, wa.z);
      allPositions.push(wb.x, wb.y, wb.z);
      allPositions.push(wb2.x, wb2.y, wb2.z);
      allPositions.push(wa2.x, wa2.y, wa2.z);
      allIndices.push(base, base + 1, base + 2);
      allIndices.push(base, base + 2, base + 3);
    }

    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    result.setIndex(allIndices);
    result.computeVertexNormals();
    return result;
  }

  // ── SLD7 — Linear Pattern ─────────────────────────────────────────────────
  static linearPattern(mesh: THREE.Mesh, params: {
    dirX: number; dirY: number; dirZ: number;
    spacing: number; count: number;
    dir2X?: number; dir2Y?: number; dir2Z?: number;
    spacing2?: number; count2?: number;
  }): THREE.Mesh[] {
    const dir1 = new THREE.Vector3(params.dirX, params.dirY, params.dirZ).normalize();
    const results: THREE.Mesh[] = [];
    const count2 = params.count2 ?? 1;
    const spacing2 = params.spacing2 ?? 0;
    const dir2 = params.dir2X !== undefined
      ? new THREE.Vector3(params.dir2X, params.dir2Y ?? 0, params.dir2Z ?? 0).normalize()
      : null;
    for (let j = 0; j < count2; j++) {
      for (let i = 0; i < params.count; i++) {
        if (i === 0 && j === 0) continue; // skip original position
        const offset = dir1.clone().multiplyScalar(i * params.spacing);
        if (dir2) offset.addScaledVector(dir2, j * spacing2);
        const geom = mesh.geometry.clone();
        geom.translate(offset.x, offset.y, offset.z);
        const copy = new THREE.Mesh(geom, mesh.material);
        copy.userData = { ...mesh.userData };
        results.push(copy);
      }
    }
    return results;
  }

  // ── SLD8 — Circular Pattern ───────────────────────────────────────────────
  static circularPattern(mesh: THREE.Mesh, params: {
    axisX: number; axisY: number; axisZ: number;
    originX: number; originY: number; originZ: number;
    count: number; totalAngle: number; // degrees
  }): THREE.Mesh[] {
    const axis = new THREE.Vector3(params.axisX, params.axisY, params.axisZ).normalize();
    const origin = new THREE.Vector3(params.originX, params.originY, params.originZ);
    const results: THREE.Mesh[] = [];
    const angleStep = (params.totalAngle / params.count) * (Math.PI / 180);
    for (let i = 1; i < params.count; i++) {
      const angle = angleStep * i;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const geom = mesh.geometry.clone();
      // Rotate each vertex around origin
      const pos = geom.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, v).sub(origin).applyQuaternion(q).add(origin);
        pos.setXYZ(v, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      geom.computeVertexNormals();
      const copy = new THREE.Mesh(geom, mesh.material);
      copy.userData = { ...mesh.userData };
      results.push(copy);
    }
    return results;
  }

  // ── MSH2 — Plane Cut ─────────────────────────────────────────────────────
  static planeCutMesh(mesh: THREE.Mesh, planeNormal: THREE.Vector3, planeOffset: number, keepSide: 'positive' | 'negative'): THREE.Mesh {
    const geom = mesh.geometry.toNonIndexed();
    geom.applyMatrix4(mesh.matrixWorld);
    const n = planeNormal.clone().normalize();
    const sign = keepSide === 'positive' ? 1 : -1;

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const keptVerts: number[] = [];
    const cutLoop: THREE.Vector3[] = [];

    for (let i = 0; i < pos.count; i += 3) {
      const va = new THREE.Vector3().fromBufferAttribute(pos, i);
      const vb = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const vc = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      const da = n.dot(va) - planeOffset;
      const db = n.dot(vb) - planeOffset;
      const dc = n.dot(vc) - planeOffset;
      const sa = Math.sign(da) * sign >= 0;
      const sb = Math.sign(db) * sign >= 0;
      const sc = Math.sign(dc) * sign >= 0;

      if (sa && sb && sc) {
        keptVerts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
      } else if (!sa && !sb && !sc) {
        // discard
      } else {
        const verts = [va, vb, vc];
        const d = [da, db, dc];
        const kept: THREE.Vector3[] = [];
        const boundary: THREE.Vector3[] = [];
        for (let j = 0; j < 3; j++) {
          const curr = verts[j], next = verts[(j + 1) % 3];
          const dc0 = d[j], dc1 = d[(j + 1) % 3];
          const currKept = dc0 * sign >= 0;
          const nextKept = dc1 * sign >= 0;
          if (currKept) kept.push(curr);
          if (currKept !== nextKept) {
            const t = dc0 / (dc0 - dc1);
            const p = curr.clone().lerp(next, t);
            kept.push(p);
            boundary.push(p.clone());
          }
        }
        for (let j = 1; j + 1 < kept.length; j++) {
          keptVerts.push(kept[0].x, kept[0].y, kept[0].z,
                         kept[j].x, kept[j].y, kept[j].z,
                         kept[j+1].x, kept[j+1].y, kept[j+1].z);
        }
        cutLoop.push(...boundary);
      }
    }

    // Build cap from cut loop (centroid fan)
    if (cutLoop.length >= 3) {
      const cen = cutLoop.reduce((a, b) => a.clone().add(b)).divideScalar(cutLoop.length);
      for (let i = 0; i < cutLoop.length - 1; i++) {
        keptVerts.push(cen.x, cen.y, cen.z, cutLoop[i].x, cutLoop[i].y, cutLoop[i].z,
                       cutLoop[i+1].x, cutLoop[i+1].y, cutLoop[i+1].z);
      }
    }

    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptVerts), 3));
    newGeom.computeVertexNormals();
    const result = new THREE.Mesh(newGeom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── MSH3 — Make Closed Mesh ──────────────────────────────────────────────
  static makeClosedMesh(mesh: THREE.Mesh): THREE.Mesh {
    const geom = mesh.geometry.toNonIndexed();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const quantum = 1e-4;
    const hashKey = (v: THREE.Vector3) =>
      `${Math.round(v.x/quantum)}|${Math.round(v.y/quantum)}|${Math.round(v.z/quantum)}`;

    const existingVerts: number[] = [];
    for (let i = 0; i < pos.count * 3; i++) existingVerts.push(pos.array[i]);

    const edgeCount = new Map<string, number>();
    const edgeVerts = new Map<string, [THREE.Vector3, THREE.Vector3]>();
    for (let i = 0; i < pos.count; i += 3) {
      const verts = [
        new THREE.Vector3().fromBufferAttribute(pos, i),
        new THREE.Vector3().fromBufferAttribute(pos, i+1),
        new THREE.Vector3().fromBufferAttribute(pos, i+2),
      ];
      for (let j = 0; j < 3; j++) {
        const a = verts[j], b = verts[(j+1)%3];
        const ka = hashKey(a), kb = hashKey(b);
        const k = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
        edgeVerts.set(k, [a, b]);
      }
    }

    const adj = new Map<string, string[]>();
    const keyVert = new Map<string, THREE.Vector3>();
    for (const [k, count] of edgeCount) {
      if (count === 1) {
        const [a, b] = edgeVerts.get(k)!;
        const ka = hashKey(a), kb = hashKey(b);
        keyVert.set(ka, a); keyVert.set(kb, b);
        if (!adj.has(ka)) adj.set(ka, []);
        if (!adj.has(kb)) adj.set(kb, []);
        adj.get(ka)!.push(kb);
        adj.get(kb)!.push(ka);
      }
    }

    const visited = new Set<string>();
    const capVerts: number[] = [];
    for (const startKey of adj.keys()) {
      if (visited.has(startKey)) continue;
      const loop: THREE.Vector3[] = [];
      let cur = startKey, prev = '';
      while (!visited.has(cur)) {
        visited.add(cur);
        loop.push(keyVert.get(cur)!);
        const neighbors = adj.get(cur) ?? [];
        const next = neighbors.find(nn => nn !== prev && !visited.has(nn));
        if (!next) break;
        prev = cur; cur = next;
      }
      if (loop.length < 3) continue;
      const cen = loop.reduce((a, b) => a.clone().add(b)).divideScalar(loop.length);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i+1)%loop.length];
        capVerts.push(cen.x, cen.y, cen.z, b.x, b.y, b.z, a.x, a.y, a.z);
      }
    }

    const combined = new Float32Array(existingVerts.length + capVerts.length);
    combined.set(existingVerts);
    combined.set(capVerts, existingVerts.length);
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.BufferAttribute(combined, 3));
    newGeom.computeVertexNormals();
    const result = new THREE.Mesh(newGeom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── MSH5 — Mesh Smooth ───────────────────────────────────────────────────
  static smoothMesh(mesh: THREE.Mesh, iterations: number, factor: number = 0.5): THREE.Mesh {
    const geom = mesh.geometry.clone().toNonIndexed();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    const neighbors = new Map<number, Set<number>>();
    for (let i = 0; i < count; i++) neighbors.set(i, new Set());
    for (let i = 0; i < count; i += 3) {
      const [a, b, c] = [i, i+1, i+2];
      neighbors.get(a)!.add(b); neighbors.get(a)!.add(c);
      neighbors.get(b)!.add(a); neighbors.get(b)!.add(c);
      neighbors.get(c)!.add(a); neighbors.get(c)!.add(b);
    }
    const arr = pos.array as Float32Array;
    for (let iter = 0; iter < iterations; iter++) {
      const newPos = arr.slice();
      for (let i = 0; i < count; i++) {
        const nbrs = [...neighbors.get(i)!];
        if (nbrs.length === 0) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const nn of nbrs) { sx += arr[nn*3]; sy += arr[nn*3+1]; sz += arr[nn*3+2]; }
        sx /= nbrs.length; sy /= nbrs.length; sz /= nbrs.length;
        newPos[i*3]   = arr[i*3]   + factor * (sx - arr[i*3]);
        newPos[i*3+1] = arr[i*3+1] + factor * (sy - arr[i*3+1]);
        newPos[i*3+2] = arr[i*3+2] + factor * (sz - arr[i*3+2]);
      }
      arr.set(newPos);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── MSH13 — Mesh Section Sketch ──────────────────────────────────────────
  static meshSectionSketch(mesh: THREE.Mesh, plane: THREE.Plane): THREE.Vector3[][] {
    const geom = mesh.geometry.toNonIndexed();
    geom.applyMatrix4(mesh.matrixWorld);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const segments: [THREE.Vector3, THREE.Vector3][] = [];
    for (let i = 0; i < pos.count; i += 3) {
      const verts = [
        new THREE.Vector3().fromBufferAttribute(pos, i),
        new THREE.Vector3().fromBufferAttribute(pos, i+1),
        new THREE.Vector3().fromBufferAttribute(pos, i+2),
      ];
      const dists = verts.map(v => plane.distanceToPoint(v));
      const crossings: THREE.Vector3[] = [];
      for (let j = 0; j < 3; j++) {
        const a = verts[j], b = verts[(j+1)%3];
        const da = dists[j], db = dists[(j+1)%3];
        if (da * db < 0) {
          crossings.push(a.clone().lerp(b, da / (da - db)));
        } else if (Math.abs(da) < 1e-6) {
          crossings.push(a.clone());
        }
      }
      if (crossings.length >= 2) segments.push([crossings[0], crossings[1]]);
    }
    return segments.map(([a, b]) => [a, b]);
  }

  // ── SLD1 — Rib ───────────────────────────────────────────────────────────
  static createRib(profilePoints: THREE.Vector3[], thickness: number, height: number, normal: THREE.Vector3): THREE.Mesh {
    const n = normal.clone().normalize();
    const verts: number[] = [];

    for (let i = 0; i + 1 < profilePoints.length; i++) {
      const p0 = profilePoints[i], p1 = profilePoints[i + 1];
      const dir = p1.clone().sub(p0).normalize();
      const side = new THREE.Vector3().crossVectors(dir, n).normalize().multiplyScalar(thickness / 2);
      const up = n.clone().multiplyScalar(height);

      const c = [
        p0.clone().sub(side),
        p0.clone().add(side),
        p1.clone().add(side),
        p1.clone().sub(side),
        p0.clone().sub(side).add(up),
        p0.clone().add(side).add(up),
        p1.clone().add(side).add(up),
        p1.clone().sub(side).add(up),
      ];

      const faces = [[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[2,6,7,2,7,3],[0,3,7,0,7,4],[1,5,6,1,6,2]];
      for (const f of faces) {
        for (const idx of f) verts.push(c[idx].x, c[idx].y, c[idx].z);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
    return mesh;
  }

  // ── SLD2 — Web ───────────────────────────────────────────────────────────
  static createWeb(entityPoints: THREE.Vector3[][], thickness: number, height: number, normal: THREE.Vector3): THREE.Mesh {
    // Collect all rib vertex arrays and concatenate into a single buffer
    const allVerts: number[] = [];
    for (const pts of entityPoints) {
      if (pts.length >= 2) {
        const ribMesh = GeometryEngine.createRib(pts, thickness, height, normal);
        const pos = ribMesh.geometry.attributes.position as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < arr.length; i++) allVerts.push(arr[i]);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allVerts), 3));
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
  }

  // ── SLD4 — Rest ──────────────────────────────────────────────────────────
  static createRest(
    centerX: number, centerY: number, centerZ: number,
    normalX: number, normalY: number, normalZ: number,
    width: number, depth: number, thickness: number,
  ): THREE.Mesh {
    const baseGeom = new THREE.BoxGeometry(width, thickness, depth);
    const normal = new THREE.Vector3(normalX, normalY, normalZ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const mesh = new THREE.Mesh(baseGeom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
    mesh.position.set(centerX, centerY, centerZ);
    mesh.quaternion.copy(q);
    mesh.updateMatrixWorld(true);
    const geom = baseGeom.clone();
    geom.applyMatrix4(mesh.matrixWorld);
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, new THREE.MeshPhysicalMaterial({ color: 0x8899aa, metalness: 0.3, roughness: 0.4 }));
    return result;
  }

  // ── SLD5 — Cosmetic Thread helix ─────────────────────────────────────────
  static createCosmeticThread(radius: number, pitch: number, length: number, turns?: number): THREE.BufferGeometry {
    const n = turns ?? Math.ceil(length / pitch);
    const stepsPerTurn = 64;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= n * stepsPerTurn; i++) {
      const t = i / stepsPerTurn;
      const angle = t * Math.PI * 2;
      const y = (i / (n * stepsPerTurn)) * length;
      points.push(new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle)));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  // ── SLD9 — Pattern on Path ───────────────────────────────────────────────
  static patternOnPath(mesh: THREE.Mesh, pathPoints: THREE.Vector3[], count: number): THREE.Mesh[] {
    if (pathPoints.length < 2 || count < 2) return [];
    const results: THREE.Mesh[] = [];
    const arcLens = [0];
    for (let i = 1; i < pathPoints.length; i++) {
      arcLens.push(arcLens[i - 1] + pathPoints[i].distanceTo(pathPoints[i - 1]));
    }
    const total = arcLens[arcLens.length - 1];

    for (let k = 0; k < count; k++) {
      // Guard against count === 1 → division by zero → NaN positions
      // (one copy lands at the path start).
      const targetLen = count > 1 ? (k / (count - 1)) * total : 0;
      let seg = 0;
      for (let i = 1; i < arcLens.length; i++) {
        if (arcLens[i] >= targetLen) { seg = i - 1; break; }
      }
      const segT = arcLens[seg + 1] > arcLens[seg]
        ? (targetLen - arcLens[seg]) / (arcLens[seg + 1] - arcLens[seg])
        : 0;
      const pos = pathPoints[seg].clone().lerp(pathPoints[Math.min(seg + 1, pathPoints.length - 1)], segT);

      const tangent = pathPoints[Math.min(seg + 1, pathPoints.length - 1)].clone().sub(pathPoints[seg]).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);

      const geom = mesh.geometry.clone();
      const mat = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
      geom.applyMatrix4(mat);
      const copy = new THREE.Mesh(geom, mesh.material);
      copy.userData = { ...mesh.userData };
      results.push(copy);
    }
    return results;
  }

  // ── MSH1 — Remesh ────────────────────────────────────────────────────────
  static remesh(mesh: THREE.Mesh, mode: 'refine' | 'coarsen', iterations: number): THREE.Mesh {
    if (mode === 'refine') {
      let geom = mesh.geometry.clone().toNonIndexed();
      for (let iter = 0; iter < iterations; iter++) {
        const pos = geom.attributes.position as THREE.BufferAttribute;
        const newVerts: number[] = [];
        for (let i = 0; i < pos.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(pos, i);
          const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
          const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
          const ab = a.clone().add(b).multiplyScalar(0.5);
          const bc = b.clone().add(c).multiplyScalar(0.5);
          const ca = c.clone().add(a).multiplyScalar(0.5);
          for (const [x, y, z] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [THREE.Vector3, THREE.Vector3, THREE.Vector3][]) {
            newVerts.push(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
          }
        }
        geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newVerts), 3));
      }
      geom.computeVertexNormals();
      const result = new THREE.Mesh(geom, mesh.material);
      result.userData = { ...mesh.userData };
      return result;
    } else {
      return GeometryEngine.smoothMesh(mesh, iterations * 2, 0.3);
    }
  }

  // ── PL1 — Boss ───────────────────────────────────────────────────────────
  // ── SLD10 — Shell ────────────────────────────────────────────────────────
  static shellMesh(mesh: THREE.Mesh, thickness: number, direction: 'inward' | 'outward' | 'symmetric'): THREE.Mesh {
    const inwardDist = direction === 'outward' ? 0 : -thickness;

    // Get outer geometry (clone of original)
    const outerGeom = mesh.geometry.clone().toNonIndexed();
    outerGeom.applyMatrix4(mesh.matrixWorld);
    outerGeom.computeVertexNormals();

    // Build inner shell: offset every vertex inward along its normal
    const innerGeom = outerGeom.clone();
    const innerPos = innerGeom.attributes.position as THREE.BufferAttribute;
    const innerNorm = innerGeom.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < innerPos.count; i++) {
      const nx = innerNorm.getX(i), ny = innerNorm.getY(i), nz = innerNorm.getZ(i);
      innerPos.setXYZ(i,
        innerPos.getX(i) + nx * inwardDist,
        innerPos.getY(i) + ny * inwardDist,
        innerPos.getZ(i) + nz * inwardDist,
      );
    }
    innerPos.needsUpdate = true;
    // Flip inner shell winding
    const innerArr = innerPos.array as Float32Array;
    for (let i = 0; i < innerArr.length; i += 9) {
      for (let j = 0; j < 3; j++) {
        const tmp = innerArr[i + 3 + j]; innerArr[i + 3 + j] = innerArr[i + 6 + j]; innerArr[i + 6 + j] = tmp;
      }
    }
    innerPos.needsUpdate = true;
    innerGeom.computeVertexNormals();

    // Merge outer + inner into one geometry
    const outerArr = Array.from(outerGeom.attributes.position.array as Float32Array);
    const innerArrFull = Array.from(innerGeom.attributes.position.array as Float32Array);
    const combined = new Float32Array([...outerArr, ...innerArrFull]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(combined, 3));
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── SLD11 — Draft ────────────────────────────────────────────────────────
  static draftMesh(mesh: THREE.Mesh, pullAxisDir: THREE.Vector3, draftAngle: number, fixedPlaneY: number = 0): THREE.Mesh {
    const geom = mesh.geometry.clone().toNonIndexed();
    geom.applyMatrix4(mesh.matrixWorld);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const axis = pullAxisDir.clone().normalize();
    const tanAngle = Math.tan(draftAngle * Math.PI / 180);

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      // Height above fixed plane along pull axis
      const height = v.dot(axis) - fixedPlaneY;
      if (Math.abs(height) < 1e-6) continue;
      // Radial offset in the plane perpendicular to the axis
      const axisComponent = axis.clone().multiplyScalar(v.dot(axis));
      const radial = v.clone().sub(axisComponent);
      const radialLen = radial.length();
      if (radialLen < 1e-8) continue;
      const radialDir = radial.divideScalar(radialLen);
      const offset = height * tanAngle;
      pos.setXYZ(i,
        v.x + radialDir.x * offset,
        v.y + radialDir.y * offset,
        v.z + radialDir.z * offset,
      );
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, mesh.material);
    result.userData = { ...mesh.userData };
    return result;
  }

  // ── SLD16 — Remove Face and Heal ─────────────────────────────────────────
  static removeFaceAndHeal(mesh: THREE.Mesh, faceNormal: THREE.Vector3, faceCentroid: THREE.Vector3, tol = 0.1): THREE.Mesh {
    const geom = mesh.geometry.clone().toNonIndexed();
    geom.applyMatrix4(mesh.matrixWorld);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const n = faceNormal.clone().normalize();

    const keptVerts: number[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      const triN = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      const triCen = a.clone().add(b).add(c).divideScalar(3);
      if (triN.dot(n) > 1 - tol && triCen.distanceTo(faceCentroid) < tol * 10) continue;
      keptVerts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }

    const tempGeom = new THREE.BufferGeometry();
    tempGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keptVerts), 3));
    const tempMesh = new THREE.Mesh(tempGeom, mesh.material);
    return GeometryEngine.makeClosedMesh(tempMesh);
  }

  // ── MSH9 — Mesh Align ────────────────────────────────────────────────────
  static alignMeshToCentroid(sourceMesh: THREE.Mesh, targetMesh: THREE.Mesh): THREE.Mesh {
    const srcBox = new THREE.Box3().setFromObject(sourceMesh);
    const tgtBox = new THREE.Box3().setFromObject(targetMesh);
    const srcCen = new THREE.Vector3();
    const tgtCen = new THREE.Vector3();
    srcBox.getCenter(srcCen);
    tgtBox.getCenter(tgtCen);
    const offset = tgtCen.sub(srcCen);
    const geom = sourceMesh.geometry.clone();
    geom.applyMatrix4(sourceMesh.matrixWorld);
    geom.translate(offset.x, offset.y, offset.z);
    geom.computeVertexNormals();
    const result = new THREE.Mesh(geom, sourceMesh.material);
    result.userData = { ...sourceMesh.userData };
    return result;
  }

}

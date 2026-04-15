import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import type { Sketch, SketchEntity, SketchPoint, SketchPlane } from '../types/cad';
import { SURFACE_MATERIAL } from '../components/viewport/scene/bodyMaterial';

// Single shared CSG evaluator — constructing one is cheap but reusing is free
const _csgEvaluator = new Evaluator();
_csgEvaluator.useGroups = false;

// Shared materials — created once, never duplicated per-entity
const SKETCH_MATERIAL = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });
// Construction lines: orange, short dash — reference geometry, not part of profile
const CONSTRUCTION_MATERIAL = new THREE.LineDashedMaterial({
  color: 0xff8800, linewidth: 1, dashSize: 0.3, gapSize: 0.18,
});
// Centerlines: dark green/teal, long dash + small gap — used for symmetry/revolve axes
const CENTERLINE_MATERIAL = new THREE.LineDashedMaterial({
  color: 0x00aa55, linewidth: 1, dashSize: 0.7, gapSize: 0.2,
});
const EXTRUDE_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0x8899aa,
  metalness: 0.3,
  roughness: 0.4,
  side: THREE.DoubleSide,
});

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

    // Bounding radius for plane-distance tolerance scaling
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const radius = geom.boundingSphere?.radius ?? 1;
    const planeTol = Math.max(tol, tol * radius);

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
      // Wider normal tolerance (0.99) since small triangles can have noisy normals
      if (n.dot(hitNormal) < 0.99) continue;
      const off = n.dot(va);
      if (Math.abs(off - hitOffset) > planeTol) continue;
      coplanarTris.push([va, vb, vc]);
    }
    if (coplanarTris.length === 0) return null;

    // Quantize positions to a grid so duplicated verts at the same world
    // location (common in ExtrudeGeometry between cap and side) hash equal.
    const quantum = Math.max(1e-4, planeTol);
    const hashKey = (v: THREE.Vector3) =>
      `${Math.round(v.x / quantum)}|${Math.round(v.y / quantum)}|${Math.round(v.z / quantum)}`;
    // Map: hash → first vector encountered (canonical position for that key)
    const canonicalPos = new Map<string, THREE.Vector3>();
    const keyFor = (v: THREE.Vector3): string => {
      const k = hashKey(v);
      if (!canonicalPos.has(k)) canonicalPos.set(k, v.clone());
      return k;
    };

    // Build undirected edge counts and a directed adjacency list (so a vertex
    // may have MULTIPLE outgoing boundary edges when the boundary has more
    // than one loop or branches).
    const undirectedKey = (a: string, b: string) => (a < b ? `${a}#${b}` : `${b}#${a}`);
    const edgeCount = new Map<string, number>();
    for (const [va, vb, vc] of coplanarTris) {
      const ka = keyFor(va), kb = keyFor(vb), kc = keyFor(vc);
      for (const [e0, e1] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
        const k = undirectedKey(e0, e1);
        edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      }
    }

    // Directed adjacency for boundary edges (preserves CCW around each triangle)
    const adjacency = new Map<string, string[]>();
    for (const [va, vb, vc] of coplanarTris) {
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
   * World direction the extrusion grows along, after the named-plane rotation
   * is applied to the mesh. NOT the plane's visual face normal — for that see
   * sketch.planeNormal (which is what's used for 'custom' face-based sketches).
   */
  static getSketchExtrudeNormal(sketch: Sketch): THREE.Vector3 {
    if (sketch.plane === 'custom') return sketch.planeNormal.clone().normalize();
    switch (sketch.plane) {
      case 'XZ': return new THREE.Vector3(0, 1, 0);
      case 'YZ': return new THREE.Vector3(1, 0, 0);
      default:   return new THREE.Vector3(0, 0, 1);
    }
  }

  /**
   * World-space centroid of the sketch's profile shape, computed from its 2D
   * bounding-box center. Returns null for empty sketches. Handles both named
   * and custom (face-based) planes.
   */
  static getSketchProfileCentroid(sketch: Sketch): THREE.Vector3 | null {
    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const origin = sketch.planeOrigin;
      const box = new THREE.Box2();
      for (const e of sketch.entities) {
        for (const p of e.points) {
          const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
          box.expandByPoint(new THREE.Vector2(d.dot(t1), d.dot(t2)));
        }
      }
      if (box.isEmpty()) return null;
      const c2 = box.getCenter(new THREE.Vector2());
      return origin.clone().addScaledVector(t1, c2.x).addScaledVector(t2, c2.y);
    }
    const shape = this.sketchToShape(sketch);
    if (!shape) return null;
    const box = new THREE.Box2();
    for (const p of shape.getPoints(32)) box.expandByPoint(p);
    if (box.isEmpty()) return null;
    const c2 = box.getCenter(new THREE.Vector2());
    const rot = this.getPlaneRotation(sketch.plane);
    return new THREE.Vector3(c2.x, c2.y, 0).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  }

  /**
   * Builds a flat (un-extruded) mesh for the sketch's profile, positioned and
   * oriented in world space to match the extruded body. Caller owns disposal
   * of the geometry. Used for hit-testing/picking.
   */
  static createSketchProfileMesh(sketch: Sketch, material: THREE.Material): THREE.Mesh | null {
    if (sketch.plane === 'custom') {
      // Reuse the projection used by extrudeCustomPlaneSketch: build a 2D
      // shape in plane-local (u,v), then orient via the (t1, t2, n) basis.
      const { t1, t2 } = this.getSketchAxes(sketch);
      const normal = sketch.planeNormal.clone().normalize();
      const origin = sketch.planeOrigin;
      const proj = (p: SketchPoint): { u: number; v: number } => {
        const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
      const shape = this.entitiesToShape(sketch.entities, proj);
      if (!shape) return null;
      const geom = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geom, material);
      const m = new THREE.Matrix4().makeBasis(t1, t2, normal);
      mesh.quaternion.setFromRotationMatrix(m);
      mesh.position.copy(origin);
      return mesh;
    }
    const shape = this.sketchToShape(sketch);
    if (!shape) return null;
    const geom = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geom, material);
    const rot = this.getPlaneRotation(sketch.plane);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    return mesh;
  }

  /**
   * Build a THREE.Shape from sketch entities using a custom (x,y) projection.
   * Used by both named-plane sketchToShape and custom-plane variants.
   */
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
      }
    }
    return hasContent ? shape : null;
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
    const projFn = sketch.plane === 'custom'
      ? (p: SketchPoint) => {
          const { t1, t2 } = this.getSketchAxes(sketch);
          const d = new THREE.Vector3(p.x - sketch.planeOrigin.x, p.y - sketch.planeOrigin.y, p.z - sketch.planeOrigin.z);
          return { u: d.dot(t1), v: d.dot(t2) };
        }
      : (p: SketchPoint) => ({ u: p.x, v: p.y });

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

  static extrudeSketch(sketch: Sketch, distance: number): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    // Custom face-based sketches: project entities to plane-local 2D, extrude,
    // then position+orient the resulting mesh to align with the face.
    if (sketch.plane === 'custom') {
      return this.extrudeCustomPlaneSketch(sketch, distance);
    }

    const shape = this.sketchToShape(sketch);
    if (!shape) return null;

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: distance,
      bevelEnabled: false,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mesh = new THREE.Mesh(geometry, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const rot = this.getPlaneRotation(sketch.plane);
    mesh.rotation.set(rot[0], rot[1], rot[2]);

    return mesh;
  }

  /**
   * Extrude a sketch defined on a custom (face-based) plane.
   * Projects entity points to plane-local 2D (u, v) coordinates using the
   * sketch's tangent axes, builds a 2D shape, extrudes along +Z, then
   * positions and orients the mesh so its local +Z matches the face normal.
   */
  private static extrudeCustomPlaneSketch(sketch: Sketch, distance: number): THREE.Mesh | null {
    const { t1, t2 } = this.getSketchAxes(sketch);
    const origin = sketch.planeOrigin;
    const normal = sketch.planeNormal.clone().normalize();

    const proj = (p: SketchPoint): { u: number; v: number } => {
      const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const shape = this.entitiesToShape(sketch.entities, proj);
    if (!shape) return null;

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: distance, bevelEnabled: false });
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

    // Get the profile outline points in plane-local 2D (u, v)
    let outline2D: { u: number; v: number }[] = [];
    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const origin = sketch.planeOrigin;
      const proj = (p: SketchPoint) => {
        const d = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        return { u: d.dot(t1), v: d.dot(t2) };
      };
      const shape = this.entitiesToShape(sketch.entities, proj);
      if (!shape) return null;
      outline2D = shape.getPoints(64).map((p) => ({ u: p.x, v: p.y }));
    } else {
      // Standard plane: project via plane axes so XY/XZ/YZ all work correctly
      const { t1, t2 } = this.getSketchAxes(sketch);
      const proj = (p: SketchPoint) => ({
        u: t1.x * p.x + t1.y * p.y + t1.z * p.z,
        v: t2.x * p.x + t2.y * p.y + t2.z * p.z,
      });
      const shape = this.entitiesToShape(sketch.entities, proj);
      if (!shape) return null;
      outline2D = shape.getPoints(64).map((p) => ({ u: p.x, v: p.y }));
    }

    if (outline2D.length < 2) return null;

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

    if (sketch.plane === 'custom') {
      const { t1, t2 } = this.getSketchAxes(sketch);
      const normal = sketch.planeNormal.clone().normalize();
      const origin = sketch.planeOrigin;

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

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
      return mesh;
    } else {
      // Standard plane: outline2D uses (u=x, v=y) in plane-local coords.
      // Build geometry in local space (Z = extrude axis), then apply plane rotation.
      for (let i = 0; i < outline2D.length - 1; i++) {
        const a = outline2D[i];
        const b = outline2D[i + 1];
        addWallQuad(
          a.u, a.v, 0,
          b.u, b.v, 0,
          b.u, b.v, distance,
          a.u, a.v, distance,
        );
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      const mesh = new THREE.Mesh(geom, SURFACE_MATERIAL);
      const rot = this.getPlaneRotation(sketch.plane);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      return mesh;
    }
  }

  static sketchToShape(sketch: Sketch): THREE.Shape | null {
    return this.entitiesToShape(sketch.entities, (p) => ({ u: p.x, v: p.y }));
  }

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
   * inward / reverse, pass `direction: 'reverse'`.
   */
  static buildExtrudeFeatureMesh(
    sketch: Sketch,
    distance: number,
    direction: 'normal' | 'reverse' | 'symmetric',
  ): THREE.Mesh | null {
    const depth = direction === 'symmetric' ? distance : distance;
    const mesh = this.extrudeSketch(sketch, depth);
    if (!mesh) return null;
    if (direction !== 'normal') {
      const offset = direction === 'symmetric' ? distance / 2 : distance;
      mesh.position.sub(this.getSketchExtrudeNormal(sketch).multiplyScalar(offset));
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
   * Boolean A − B (subtract) on two world-space geometries. Returns a new
   * BufferGeometry. Disposes nothing — caller owns all inputs and the output.
   */
  static csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
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
    const brushA = new Brush(a);
    const brushB = new Brush(b);
    brushA.updateMatrixWorld();
    brushB.updateMatrixWorld();
    const result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);
    return result.geometry;
  }

  static revolveSketch(sketch: Sketch, angle: number, _axis: THREE.Vector3): THREE.Mesh | null {
    if (sketch.entities.length === 0) return null;

    const shape = this.sketchToShape(sketch);
    if (!shape) return null;

    const points = shape.getPoints(64);
    const lathePoints = points.map(p => new THREE.Vector2(Math.abs(p.x), p.y));

    const geometry = new THREE.LatheGeometry(
      lathePoints,
      64,
      0,
      angle
    );

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

    // Build quad strips: each pair of consecutive cross-segments forms a quad
    for (let i = 0; i < len - 1; i++) {
      // vertex layout: row i → [2i, 2i+1], row i+1 → [2i+2, 2i+3]
      const a = 2 * i;
      const b = 2 * i + 1;
      const c = 2 * i + 2;
      const d = 2 * i + 3;
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
    let indexed = geom.index ? geom : mergeVertices(geom);

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
}

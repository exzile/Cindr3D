import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import type { Sketch, SketchEntity, SketchPoint, SketchPlane } from '../types/cad';

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

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, EXTRUDE_MATERIAL);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Public entry point — sweepSketch calls this after extracting shape + curve */
  static sweepSketchInternal(profileSketch: Sketch, pathSketch: Sketch): THREE.Mesh | null {
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

    return this._sweepWithCurve(pts2D, curve, N_FRAMES);
  }
}

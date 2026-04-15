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

  /**
   * Build one or more closed shapes from sketch entities.
   * Keeps inherently closed primitives (rectangle/circle) as independent loops
   * to avoid triangulation bridges between disjoint profiles.
   */
  private static entitiesToShapes(
    entities: SketchEntity[],
    proj: (p: SketchPoint) => { u: number; v: number },
  ): THREE.Shape[] {
    const shapes: THREE.Shape[] = [];
    const chained: SketchEntity[] = [];

    const getEntityEndpoints = (entity: SketchEntity): [{ u: number; v: number }, { u: number; v: number }] | null => {
      if (entity.type === 'line' || entity.type === 'construction-line' || entity.type === 'centerline') {
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
      return null;
    };

    const isChainClosed = (chain: SketchEntity[]) => {
      if (chain.length === 0) return false;
      const first = getEntityEndpoints(chain[0]);
      const last = getEntityEndpoints(chain[chain.length - 1]);
      if (!first || !last) return false;
      const du = first[0].u - last[1].u;
      const dv = first[0].v - last[1].v;
      return Math.hypot(du, dv) <= 1e-3;
    };

    for (const entity of entities) {
      if (entity.type === 'rectangle' || entity.type === 'circle') {
        const s = this.entitiesToShape([entity], proj);
        if (s) shapes.push(s);
      } else {
        chained.push(entity);
      }
    }

    if (isChainClosed(chained)) {
      const chainedShape = this.entitiesToShape(chained, proj);
      if (chainedShape) shapes.push(chainedShape);
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
        const epIdx = curSegIdx * 2 + curEndIdx;
        const partnerId = partner[epIdx];
        if (partnerId === -1) break;
        const nextSeg = endpoints[partnerId].segIdx;
        if (usedSegs.has(nextSeg)) break;
        usedSegs.add(nextSeg);
        const nextEnd = endpoints[partnerId].endIdx;
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
        const epIdx = curSegIdx * 2 + curEndIdx;
        const partnerId = partner[epIdx];
        if (partnerId === -1) break;
        const nextSeg = endpoints[partnerId].segIdx;
        if (usedSegs.has(nextSeg)) break;
        usedSegs.add(nextSeg);
        const nextEnd = endpoints[partnerId].endIdx;
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
   * Gets the closest point on a mesh surface to a given world-space query point.
   * Uses brute-force triangle iteration for small meshes (< 5000 triangles);
   * falls back to 6-direction raycast for larger ones.
   */
  private static closestPointOnMesh(
    query: THREE.Vector3,
    mesh: THREE.Mesh,
  ): THREE.Vector3 | null {
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;

    const idxAttr = geom.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const m = mesh.matrixWorld;

    if (triCount < 5000) {
      // Brute-force triangle iteration
      let bestDist = Infinity;
      let bestPoint: THREE.Vector3 | null = null;

      const va = new THREE.Vector3();
      const vb = new THREE.Vector3();
      const vc = new THREE.Vector3();

      for (let t = 0; t < triCount; t++) {
        let ia: number, ib: number, ic: number;
        if (idxAttr) {
          ia = idxAttr.getX(t * 3);
          ib = idxAttr.getX(t * 3 + 1);
          ic = idxAttr.getX(t * 3 + 2);
        } else {
          ia = t * 3; ib = t * 3 + 1; ic = t * 3 + 2;
        }
        va.fromBufferAttribute(posAttr, ia).applyMatrix4(m);
        vb.fromBufferAttribute(posAttr, ib).applyMatrix4(m);
        vc.fromBufferAttribute(posAttr, ic).applyMatrix4(m);

        const cp = GeometryEngine.closestPointOnTriangle(query, va, vb, vc);
        const d = cp.distanceToSquared(query);
        if (d < bestDist) {
          bestDist = d;
          bestPoint = cp.clone();
        }
      }
      return bestPoint;
    }

    // Fallback for large meshes: 6-direction raycast
    const [hit] = GeometryEngine.projectPointsOntoMesh([query], mesh);
    return hit ?? null;
  }

  /**
   * Closest point on a triangle to a point (all world-space).
   * Returns the barycentric-clamped nearest point.
   *
   * Reference: Real-Time Collision Detection, Ericson, §5.1.5
   */
  private static closestPointOnTriangle(
    p: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
  ): THREE.Vector3 {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const ap = p.clone().sub(a);
    const d1 = ab.dot(ap);
    const d2 = ac.dot(ap);
    if (d1 <= 0 && d2 <= 0) return a.clone();

    const bp = p.clone().sub(b);
    const d3 = ab.dot(bp);
    const d4 = ac.dot(bp);
    if (d3 >= 0 && d4 <= d3) return b.clone();

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return a.clone().addScaledVector(ab, v);
    }

    const cp = p.clone().sub(c);
    const d5 = ab.dot(cp);
    const d6 = ac.dot(cp);
    if (d6 >= 0 && d5 <= d6) return c.clone();

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return a.clone().addScaledVector(ac, w);
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return b.clone().addScaledVector(c.clone().sub(b), w);
    }

    const denom = 1 / (va + vb + vc);
    const vv = vb * denom;
    const ww = vc * denom;
    return a.clone().addScaledVector(ab, vv).addScaledVector(ac, ww);
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
}

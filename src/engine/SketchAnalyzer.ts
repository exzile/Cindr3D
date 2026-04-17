import * as THREE from 'three';
import type { SketchEntity, SketchPoint, Sketch, SketchConstraint } from '../types/cad';

/** A chain of connected entities forming a continuous path */
export interface SketchLoop {
  entityIds: string[];     // ordered entity IDs in the loop
  closed: boolean;         // true if last entity connects back to first
  area?: number;           // signed area (positive = CCW), undefined for open loops
}

export interface SketchAnalysis {
  loops: SketchLoop[];           // all detected continuous chains
  closedProfiles: SketchLoop[];  // subset that are closed (usable for extrude)
  openChains: SketchLoop[];      // subset that are open
  isolatedPoints: string[];      // entity IDs with no connections
  selfIntersections: Array<{     // detected self-intersecting segments
    entityIdA: string;
    entityIdB: string;
    point: { x: number; y: number };
  }>;
  redundantEntities: string[];   // duplicate or zero-length entities
  stats: {
    entityCount: number;
    lineCount: number;
    arcCount: number;
    circleCount: number;
    constraintCount: number;
    dimensionCount: number;
    dof: number;                 // estimated degrees of freedom (positive = under-constrained)
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Pt2 {
  x: number;
  y: number;
}

/**
 * Plane-aware projection helper. SketchPoints are stored in WORLD 3D
 * coordinates, not 2D plane-local coords — see SketchInteraction.tsx:447
 * where x/y/z are written from the world-space raycast hit. To do correct
 * 2D analysis (chain detection, area, intersection) on a non-XY sketch
 * (XZ, YZ, custom face plane), we must project each 3D point onto the
 * sketch plane's t1/t2 axes.
 *
 * If `axes` is null we fall back to the legacy XY-only behavior — keeps
 * the helpers usable for unit tests that pass synthetic 2D entities.
 */
type SketchAxes = { origin: THREE.Vector3; t1: THREE.Vector3; t2: THREE.Vector3 } | null;

/** Build SketchAxes from a Sketch's plane definition. */
function buildSketchAxes(sketch: Sketch): SketchAxes {
  const n = sketch.planeNormal?.clone().normalize();
  const o = sketch.planeOrigin?.clone();
  if (!n || !o) return null;
  // Choose a stable t1: world X if non-parallel to normal, else world Z
  const ref = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const t1 = ref.clone().sub(n.clone().multiplyScalar(ref.dot(n))).normalize();
  const t2 = n.clone().cross(t1).normalize();
  return { origin: o, t1, t2 };
}

/** Project a 3D SketchPoint onto sketch plane UV coords. */
function projectPt(p: SketchPoint, axes: SketchAxes): Pt2 {
  if (!axes) return { x: p.x, y: p.y };
  const v = new THREE.Vector3(p.x, p.y, p.z).sub(axes.origin);
  return { x: v.dot(axes.t1), y: v.dot(axes.t2) };
}

/** Round a coordinate to a grid bucket for tolerance-based grouping */
function bucketKey(x: number, y: number, tol: number): string {
  const bx = Math.round(x / tol);
  const by = Math.round(y / tol);
  return `${bx},${by}`;
}

function dist2(a: Pt2, b: Pt2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Return the 2-D start and end points of an entity.
 * Circles have no open endpoints — returns null.
 * Polygons/rectangles/slots that are closed also return null.
 */
function entityEndpoints(e: SketchEntity, axes: SketchAxes = null): [Pt2, Pt2] | null {
  switch (e.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (e.points.length < 2) return null;
      return [projectPt(e.points[0], axes), projectPt(e.points[1], axes)];
    }
    case 'arc': {
      // Arc: points[0] is center, radius + startAngle + endAngle define geometry.
      // Actual start/end points computed from center + angles.
      if (e.points.length < 1 || e.radius == null || e.startAngle == null || e.endAngle == null) {
        return null;
      }
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      // Arc angles are stored in RADIANS (set via Math.atan2 in commitTool.ts).
      // The previous code multiplied by π/180 as if they were degrees, which
      // produced wildly wrong endpoints — broke chain detection, closed-profile
      // detection, and self-intersection tests for any sketch with an arc.
      const sa = e.startAngle;
      const ea = e.endAngle;
      return [
        { x: cx + r * Math.cos(sa), y: cy + r * Math.sin(sa) },
        { x: cx + r * Math.cos(ea), y: cy + r * Math.sin(ea) },
      ];
    }
    case 'circle':
    case 'ellipse':
      // These are closed by nature — no open endpoints
      return null;
    case 'elliptical-arc': {
      // Open arc — endpoints at startAngle and endAngle
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return null;
      const sa = e.startAngle ?? 0;
      const ea = e.endAngle ?? Math.PI;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const sxU = a * Math.cos(sa) * cosR - b * Math.sin(sa) * sinR;
      const syU = a * Math.cos(sa) * sinR + b * Math.sin(sa) * cosR;
      const exU = a * Math.cos(ea) * cosR - b * Math.sin(ea) * sinR;
      const eyU = a * Math.cos(ea) * sinR + b * Math.sin(ea) * cosR;
      return [
        { x: cx + sxU, y: cy + syU },
        { x: cx + exU, y: cy + eyU },
      ];
    }
    case 'spline': {
      if (e.points.length < 2) return null;
      // Closed spline?
      if (e.closed) return null;
      return [
        projectPt(e.points[0], axes),
        projectPt(e.points[e.points.length - 1], axes),
      ];
    }
    case 'polygon':
    case 'rectangle':
    case 'slot':
      // These are closed contours
      return null;
    case 'point':
      // Isolated point entity
      return null;
    default:
      return null;
  }
}

/**
 * Sample points along an entity (for shoelace area computation).
 * Lines: 2 points. Arcs: N samples. Circles: N samples.
 * Polygons/rectangles: their control points.
 */
function sampleEntityPoints(e: SketchEntity, arcSamples = 8, axes: SketchAxes = null): Pt2[] {
  switch (e.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (e.points.length < 2) return [];
      return [projectPt(e.points[0], axes), projectPt(e.points[1], axes)];
    }
    case 'arc': {
      if (e.points.length < 1 || e.radius == null || e.startAngle == null || e.endAngle == null) {
        return [];
      }
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      // Arc angles are stored in RADIANS — see entityEndpoints comment above.
      const sa = e.startAngle;
      let ea = e.endAngle;
      // Ensure we sweep in the correct direction (CCW)
      if (ea < sa) ea += 2 * Math.PI;
      const pts: Pt2[] = [];
      for (let i = 0; i <= arcSamples; i++) {
        const t = sa + ((ea - sa) * i) / arcSamples;
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return pts;
    }
    case 'circle': {
      if (e.points.length < 1 || e.radius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const r = e.radius;
      const pts: Pt2[] = [];
      for (let i = 0; i < arcSamples; i++) {
        const t = (2 * Math.PI * i) / arcSamples;
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
      return pts;
    }
    case 'ellipse': {
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const pts: Pt2[] = [];
      for (let i = 0; i < arcSamples; i++) {
        const t = (2 * Math.PI * i) / arcSamples;
        const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
        const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
        pts.push({ x: cx + u, y: cy + v });
      }
      return pts;
    }
    case 'elliptical-arc': {
      if (e.points.length < 1 || e.majorRadius == null || e.minorRadius == null) return [];
      const c2 = projectPt(e.points[0], axes);
      const cx = c2.x;
      const cy = c2.y;
      const a = e.majorRadius;
      const b = e.minorRadius;
      const rot = e.rotation ?? 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const sa = e.startAngle ?? 0;
      const ea = e.endAngle ?? Math.PI;
      const pts: Pt2[] = [];
      for (let i = 0; i <= arcSamples; i++) {
        const t = sa + ((ea - sa) * i) / arcSamples;
        const u = a * Math.cos(t) * cosR - b * Math.sin(t) * sinR;
        const v = a * Math.cos(t) * sinR + b * Math.sin(t) * cosR;
        pts.push({ x: cx + u, y: cy + v });
      }
      return pts;
    }
    case 'spline':
    case 'polygon':
    case 'rectangle':
    case 'slot':
      return e.points.map((p) => projectPt(p, axes));
    default:
      return e.points.map(p => ({ x: p.x, y: p.y }));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SketchAnalyzer {
  // -------------------------------------------------------------------------
  // analyze
  // -------------------------------------------------------------------------
  static analyze(sketch: Sketch, tol = 0.1): SketchAnalysis {
    const { entities, constraints, dimensions } = sketch;

    // Build plane-aware axes ONCE so every helper projects 3D points to the
    // sketch plane's local UV. Without this, non-XY sketches (XZ, YZ, custom
    // face planes) silently corrupt chain detection, area, and intersection.
    const axes = buildSketchAxes(sketch);

    const loops = SketchAnalyzer.findLoops(entities, tol, axes);
    const closedProfiles = loops.filter(l => l.closed);
    const openChains = loops.filter(l => !l.closed);

    // Attach area to closed loops
    for (const loop of closedProfiles) {
      loop.area = SketchAnalyzer.computeLoopArea(loop, entities, axes);
    }

    // Isolated points: 'point' type entities, or line/arc stubs with no connections
    const connectedIds = new Set(loops.flatMap(l => l.entityIds));
    const isolatedPoints: string[] = [];
    for (const e of entities) {
      if (e.type === 'point') {
        isolatedPoints.push(e.id);
      } else if (!connectedIds.has(e.id) && !e.isConstruction) {
        // Entity not in any loop — treat as isolated
        isolatedPoints.push(e.id);
      }
    }

    const selfIntersections = SketchAnalyzer.findSelfIntersections(entities, tol * 0.1, axes);
    const redundantEntities = SketchAnalyzer.findRedundantEntities(entities, tol * 0.1, axes);

    const nonConstruction = entities.filter(e => !e.isConstruction);
    const stats = {
      entityCount: nonConstruction.length,
      lineCount: nonConstruction.filter(e => e.type === 'line').length,
      arcCount: nonConstruction.filter(e => e.type === 'arc').length,
      circleCount: nonConstruction.filter(e => e.type === 'circle').length,
      constraintCount: constraints.length,
      dimensionCount: dimensions.length,
      dof: SketchAnalyzer.estimateDOF(entities, constraints),
    };

    return {
      loops,
      closedProfiles,
      openChains,
      isolatedPoints,
      selfIntersections,
      redundantEntities,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // findLoops
  // -------------------------------------------------------------------------
  static findLoops(entities: SketchEntity[], tol = 0.1, axes: SketchAxes = null): SketchLoop[] {
    // Filter to geometry that can form loops (skip isolated points, construction)
    const candidates = entities.filter(e =>
      e.type !== 'point' && !e.isConstruction
    );

    const loops: SketchLoop[] = [];

    // --- Circles, closed polygons, rectangles, slots, closed splines are
    //     already self-contained closed loops ---
    const alreadyClosed = new Set<string>();
    for (const e of candidates) {
      if (
        e.type === 'circle' ||
        e.type === 'polygon' ||
        e.type === 'rectangle' ||
        e.type === 'slot' ||
        (e.type === 'spline' && e.closed)
      ) {
        alreadyClosed.add(e.id);
        const loop: SketchLoop = { entityIds: [e.id], closed: true };
        loop.area = SketchAnalyzer.computeLoopArea(loop, entities);
        loops.push(loop);
      }
    }

    // Open-endpoint entities
    const openEntities = candidates.filter(e => !alreadyClosed.has(e.id));
    if (openEntities.length === 0) return loops;

    // Build endpoint → entity adjacency map using bucket snapping
    // Each entity contributes two endpoints (start, end)
    // Map: bucketKey → Array<{ entityId, endpointIndex (0=start, 1=end) }>
    type EndRef = { entityId: string; endIdx: 0 | 1 };
    const bucketMap = new Map<string, EndRef[]>();

    const addEndpoint = (pt: Pt2, entityId: string, endIdx: 0 | 1) => {
      // Use neighboring buckets to handle tolerance boundary cases
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bx = Math.round(pt.x / tol) + dx;
          const by = Math.round(pt.y / tol) + dy;
          const key = `${bx},${by}`;
          if (!bucketMap.has(key)) bucketMap.set(key, []);
        }
      }
      // Primary bucket only for insertion (avoids duplicates)
      const bx = Math.round(pt.x / tol);
      const by = Math.round(pt.y / tol);
      const key = `${bx},${by}`;
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push({ entityId, endIdx });
    };

    const endpointOf = new Map<string, [Pt2, Pt2] | null>();

    for (const e of openEntities) {
      const eps = entityEndpoints(e, axes);
      endpointOf.set(e.id, eps);
      if (!eps) continue;
      addEndpoint(eps[0], e.id, 0);
      addEndpoint(eps[1], e.id, 1);
    }

    // For each endpoint, find nearby entities within tol
    const findNeighbors = (pt: Pt2, excludeEntityId: string): EndRef[] => {
      const results: EndRef[] = [];
      const bx = Math.round(pt.x / tol);
      const by = Math.round(pt.y / tol);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${bx + dx},${by + dy}`;
          const bucket = bucketMap.get(key);
          if (!bucket) continue;
          for (const ref of bucket) {
            if (ref.entityId === excludeEntityId) continue;
            const eps = endpointOf.get(ref.entityId);
            if (!eps) continue;
            const candidatePt = eps[ref.endIdx];
            if (dist2(pt, candidatePt) <= tol) {
              // Avoid adding the same entity+endIdx twice
              if (!results.some(r => r.entityId === ref.entityId && r.endIdx === ref.endIdx)) {
                results.push(ref);
              }
            }
          }
        }
      }
      return results;
    };

    // Walk chains using DFS/greedy traversal
    const visited = new Set<string>();

    for (const startEntity of openEntities) {
      if (visited.has(startEntity.id)) continue;
      const eps = endpointOf.get(startEntity.id);
      if (!eps) {
        visited.add(startEntity.id);
        continue;
      }

      // Walk in both directions from this entity to build a chain
      const chain: string[] = [startEntity.id];
      visited.add(startEntity.id);

      // Direction state: which endpoint of the chain's last entity to follow
      // Forward: follow end (index 1) of current last entity
      // Backward: follow start (index 0) of current first entity

      // Walk forward from end[1] of last entity
      const walkForward = (): boolean => {
        const lastId = chain[chain.length - 1];
        const lastEps = endpointOf.get(lastId);
        if (!lastEps) return false;
        const tip = lastEps[1];
        const neighbors = findNeighbors(tip, lastId);
        for (const nb of neighbors) {
          if (!visited.has(nb.entityId)) {
            visited.add(nb.entityId);
            // If the neighbor connects at its end (index 1), we need to conceptually
            // "flip" it — but since we're just tracking IDs in order, we track the
            // connection for the purpose of the next tip:
            // The "other end" of the neighbor entity becomes the new tip
            const nbEps = endpointOf.get(nb.entityId);
            if (!nbEps) continue;
            chain.push(nb.entityId);
            // If we connected at endpoint 1 of the neighbor, next tip is endpoint 0
            // We store the orientation implicitly via chain order; walkForward
            // always uses endpoint[1] of the last entity. So if we connected to
            // endpoint 1, we need to swap the interpretation — but since we only
            // store IDs we can't do that here. Instead, store a separate orientation array.
            return true;
          }
        }
        return false;
      };

      // Walk backward from start[0] of first entity
      const walkBackward = (): boolean => {
        const firstId = chain[0];
        const firstEps = endpointOf.get(firstId);
        if (!firstEps) return false;
        const tip = firstEps[0];
        const neighbors = findNeighbors(tip, firstId);
        for (const nb of neighbors) {
          if (!visited.has(nb.entityId)) {
            visited.add(nb.entityId);
            chain.unshift(nb.entityId);
            return true;
          }
        }
        return false;
      };

      while (walkForward()) { /* extend chain */ }
      while (walkBackward()) { /* extend chain */ }

      // Now determine if the chain is closed:
      // Check whether the free tip of chain[0] (start) connects to
      // the free tip of chain[chain.length-1] (end)
      let closed = false;
      if (chain.length >= 2) {
        const firstEps = endpointOf.get(chain[0]);
        const lastEps = endpointOf.get(chain[chain.length - 1]);
        if (firstEps && lastEps) {
          // Try all tip combinations — the actual "free" ends depend on orientation
          // Use the simpler approach: check all four combinations
          const d1 = dist2(firstEps[0], lastEps[1]);
          const d2 = dist2(firstEps[1], lastEps[0]);
          const d3 = dist2(firstEps[0], lastEps[0]);
          const d4 = dist2(firstEps[1], lastEps[1]);
          if (Math.min(d1, d2, d3, d4) <= tol) {
            closed = true;
          }
        }
      }

      loops.push({ entityIds: [...chain], closed });
    }

    return loops;
  }

  // -------------------------------------------------------------------------
  // computeLoopArea
  // -------------------------------------------------------------------------
  static computeLoopArea(loop: SketchLoop, entities: SketchEntity[], axes: SketchAxes = null): number {
    const entityById = new Map(entities.map(e => [e.id, e]));
    const allPts: Pt2[] = [];

    for (const id of loop.entityIds) {
      const e = entityById.get(id);
      if (!e) continue;
      const pts = sampleEntityPoints(e, 8, axes);
      // Avoid duplicating connection points between adjacent entities
      if (allPts.length > 0 && pts.length > 0) {
        const last = allPts[allPts.length - 1];
        const first = pts[0];
        if (dist2(last, first) < 1e-9) {
          allPts.push(...pts.slice(1));
        } else {
          allPts.push(...pts);
        }
      } else {
        allPts.push(...pts);
      }
    }

    if (allPts.length < 3) return 0;

    // Shoelace formula
    let area = 0;
    const n = allPts.length;
    for (let i = 0; i < n; i++) {
      const a = allPts[i];
      const b = allPts[(i + 1) % n];
      area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
  }

  // -------------------------------------------------------------------------
  // findSelfIntersections
  // -------------------------------------------------------------------------
  static findSelfIntersections(
    entities: SketchEntity[],
    tol = 0.01,
    axes: SketchAxes = null,
  ): Array<{ entityIdA: string; entityIdB: string; point: { x: number; y: number } }> {
    const results: Array<{ entityIdA: string; entityIdB: string; point: { x: number; y: number } }> = [];

    // Collect only line-type entities for segment intersection tests
    const lines = entities.filter(
      e => (e.type === 'line' || e.type === 'construction-line' || e.type === 'centerline') &&
        e.points.length >= 2 && !e.isConstruction
    );

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i];
        const b = lines[j];

        const p = projectPt(a.points[0], axes);
        const q = projectPt(a.points[1], axes);
        const r = projectPt(b.points[0], axes);
        const s = projectPt(b.points[1], axes);

        const inter = segmentIntersect(p, q, r, s, tol);
        if (inter) {
          results.push({ entityIdA: a.id, entityIdB: b.id, point: inter });
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // estimateDOF
  // -------------------------------------------------------------------------
  static estimateDOF(entities: SketchEntity[], constraints: SketchConstraint[]): number {
    // DOF per entity type
    let totalDof = 0;
    for (const e of entities) {
      if (e.isConstruction) continue;
      switch (e.type) {
        case 'line':
        case 'construction-line':
        case 'centerline':
          totalDof += 4; // 2 endpoints × 2 coords
          break;
        case 'circle':
          totalDof += 3; // cx, cy, r
          break;
        case 'arc':
          totalDof += 5; // cx, cy, r, startAngle, endAngle
          break;
        case 'ellipse':
          totalDof += 5; // cx, cy, majorRadius, minorRadius, rotation
          break;
        case 'elliptical-arc':
          totalDof += 7; // cx, cy, majorRadius, minorRadius, rotation, startAngle, endAngle
          break;
        case 'spline':
          // Each control point = 2 DOF
          totalDof += e.points.length * 2;
          break;
        case 'polygon':
          totalDof += 4; // center (2) + circumradius (1) + rotation (1)
          break;
        case 'rectangle':
          totalDof += 5; // center (2) + width (1) + height (1) + rotation (1)
          break;
        case 'slot':
          totalDof += 5; // two endpoint (4) + radius (1)
          break;
        case 'point':
          totalDof += 2;
          break;
        default:
          totalDof += 2;
      }
    }

    // Constraint removal
    let constraintRemoval = 0;
    for (const c of constraints) {
      switch (c.type) {
        case 'horizontal':
        case 'vertical':
          constraintRemoval += 1;
          break;
        case 'coincident':
          constraintRemoval += 2;
          break;
        case 'parallel':
        case 'perpendicular':
        case 'equal':
        case 'collinear':
        case 'concentric':
        case 'tangent':
        case 'curvature':
        case 'midpoint':
          constraintRemoval += 1;
          break;
        case 'fix':
          constraintRemoval += 2;
          break;
        case 'symmetric':
          constraintRemoval += 2;
          break;
        default:
          constraintRemoval += 1;
      }
    }

    return Math.max(0, totalDof - constraintRemoval);
  }

  // -------------------------------------------------------------------------
  // findRedundantEntities
  // -------------------------------------------------------------------------
  static findRedundantEntities(entities: SketchEntity[], tol = 0.01, axes: SketchAxes = null): string[] {
    const redundant = new Set<string>();

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (redundant.has(a.id)) continue;

      // Zero-length lines
      if (
        (a.type === 'line' || a.type === 'construction-line' || a.type === 'centerline') &&
        a.points.length >= 2
      ) {
        const d = dist2(projectPt(a.points[0], axes), projectPt(a.points[1], axes));
        if (d <= tol) {
          redundant.add(a.id);
          continue;
        }
      }

      // Zero-radius circles
      if (a.type === 'circle' && (a.radius ?? 0) <= tol) {
        redundant.add(a.id);
        continue;
      }

      // Duplicate detection: same type + same geometry
      for (let j = i + 1; j < entities.length; j++) {
        const b = entities[j];
        if (redundant.has(b.id)) continue;
        if (a.type !== b.type) continue;

        if (entitiesAreDuplicate(a, b, tol, axes)) {
          redundant.add(b.id);
        }
      }
    }

    return Array.from(redundant);
  }
}

// ---------------------------------------------------------------------------
// Private geometry utilities
// ---------------------------------------------------------------------------

/**
 * Segment intersection using parametric form.
 * Segments: P + t*(Q-P) and R + s*(S-R), t,s ∈ [0,1]
 * Returns intersection point if found, else null.
 */
function segmentIntersect(
  p: Pt2, q: Pt2, r: Pt2, s: Pt2, tol: number,
): { x: number; y: number } | null {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = s.x - r.x;
  const dy2 = s.y - r.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear

  const dx3 = r.x - p.x;
  const dy3 = r.y - p.y;

  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;

  // Exclude endpoint touches (adjacent segments share endpoints)
  const eps = tol;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return {
      x: p.x + t * dx1,
      y: p.y + t * dy1,
    };
  }
  return null;
}

/**
 * Determine if two entities of the same type are geometric duplicates.
 */
function entitiesAreDuplicate(a: SketchEntity, b: SketchEntity, tol: number, axes: SketchAxes = null): boolean {
  switch (a.type) {
    case 'line':
    case 'construction-line':
    case 'centerline': {
      if (a.points.length < 2 || b.points.length < 2) return false;
      const pa0 = projectPt(a.points[0], axes);
      const pa1 = projectPt(a.points[1], axes);
      const pb0 = projectPt(b.points[0], axes);
      const pb1 = projectPt(b.points[1], axes);
      // Same direction or reversed
      return (
        (dist2(pa0, pb0) <= tol && dist2(pa1, pb1) <= tol) ||
        (dist2(pa0, pb1) <= tol && dist2(pa1, pb0) <= tol)
      );
    }
    case 'circle': {
      if (a.points.length < 1 || b.points.length < 1) return false;
      const ca = projectPt(a.points[0], axes);
      const cb = projectPt(b.points[0], axes);
      return dist2(ca, cb) <= tol && Math.abs((a.radius ?? 0) - (b.radius ?? 0)) <= tol;
    }
    case 'arc': {
      if (a.points.length < 1 || b.points.length < 1) return false;
      const ca = projectPt(a.points[0], axes);
      const cb = projectPt(b.points[0], axes);
      return (
        dist2(ca, cb) <= tol &&
        Math.abs((a.radius ?? 0) - (b.radius ?? 0)) <= tol &&
        Math.abs((a.startAngle ?? 0) - (b.startAngle ?? 0)) <= 0.01 &&
        Math.abs((a.endAngle ?? 0) - (b.endAngle ?? 0)) <= 0.01
      );
    }
    default:
      return false;
  }
}

// Re-export the bucketKey helper so consumers can use it if needed
export { bucketKey };

import type { SketchEntity, Sketch, SketchConstraint } from '../types/cad';
import {
  buildSketchAxes,
  dist2,
  entitiesAreDuplicate,
  entityEndpoints,
  projectPt,
  sampleEntityPoints,
  segmentIntersect,
  type Pt2,
  type SketchAxes,
} from './sketchAnalyzer/helpers';


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
        // Entity not in any loop â€” treat as isolated
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
        ((e.type === 'spline' || e.type === 'fixed-spline') && e.closed)
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

    // Build endpoint â†’ entity adjacency map using bucket snapping
    // Each entity contributes two endpoints (start, end)
    // Map: bucketKey â†’ Array<{ entityId, endpointIndex (0=start, 1=end) }>
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
            // "flip" it â€” but since we're just tracking IDs in order, we track the
            // connection for the purpose of the next tip:
            // The "other end" of the neighbor entity becomes the new tip
            const nbEps = endpointOf.get(nb.entityId);
            if (!nbEps) continue;
            chain.push(nb.entityId);
            // If we connected at endpoint 1 of the neighbor, next tip is endpoint 0
            // We store the orientation implicitly via chain order; walkForward
            // always uses endpoint[1] of the last entity. So if we connected to
            // endpoint 1, we need to swap the interpretation â€” but since we only
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
          // Try all tip combinations â€” the actual "free" ends depend on orientation
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
          totalDof += 4; // 2 endpoints Ã— 2 coords
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
 * Segments: P + t*(Q-P) and R + s*(S-R), t,s âˆˆ [0,1]
 * Returns intersection point if found, else null.
 */

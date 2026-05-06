/**
 * ConstraintSolver.ts — Newton-Raphson 2D geometric constraint solver.
 * Pure TypeScript math; no React, no Three.js, no store imports.
 */
import type { SketchEntity, SketchConstraint, SketchDimension } from '../types/cad';

// ─── Public types ──────────────────────────────────────────────────────────

export interface SolverPoint {
  id: string;    // e.g. "e123-p0" — entity id + point index
  x: number;
  y: number;
  fixed: boolean;
}

export interface SolverConstraint {
  type: SketchConstraint['type'] | 'dimension-linear' | 'dimension-aligned' | 'dimension-radial' | 'dimension-diameter';
  entityIds: string[];
  pointIndices?: number[];
  value?: number;
  orientation?: SketchDimension['orientation'];
  surfacePlane?: SketchConstraint['surfacePlane'];
}

export interface SolverResult {
  solved: boolean;
  iterations: number;
  updatedPoints: Map<string, { x: number; y: number }>;
  residual: number;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Gaussian elimination with partial pivoting on square system A·x = b. */
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] !== 0 ? row[i] : 1));
}

/** Solve overdetermined/underdetermined system via normal equations: (JᵀJ)Δp = -Jᵀf */
function solveNormalEquations(J: number[][], f: number[]): number[] {
  const m = J.length;    // number of residuals
  const n = J[0]?.length ?? 0; // number of parameters
  if (n === 0) return [];

  // JᵀJ (n×n)
  const JtJ: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  // Jᵀf (n)
  const Jtf: number[] = new Array<number>(n).fill(0);

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      Jtf[j] += J[i][j] * f[i];
      for (let k = 0; k < n; k++) {
        JtJ[j][k] += J[i][j] * J[i][k];
      }
    }
  }

  // Add small Tikhonov regularisation to avoid singular systems
  const lambda = 1e-8;
  for (let j = 0; j < n; j++) JtJ[j][j] += lambda;

  return gaussianElimination(JtJ, Jtf);
}

// ─── Parameter extraction ─────────────────────────────────────────────────

/**
 * Build a flat parameter vector from all free (non-fixed) point coordinates.
 * Returns the vector and a lookup from param index → { pointId, coord ('x'|'y') }.
 */
function buildParams(
  entities: SketchEntity[],
  fixedEntityIds: Set<string>
): {
  params: number[];
  pointMap: Map<string, SolverPoint>;
  paramIndex: { pointId: string; coord: 'x' | 'y' }[];
} {
  const pointMap = new Map<string, SolverPoint>();
  const paramIndex: { pointId: string; coord: 'x' | 'y' }[] = [];
  const params: number[] = [];

  for (const entity of entities) {
    const fixed = fixedEntityIds.has(entity.id);
    for (let pi = 0; pi < entity.points.length; pi++) {
      const pt = entity.points[pi];
      const id = `${entity.id}-p${pi}`;
      if (pointMap.has(id)) continue; // deduplicate (shouldn't happen but guard)
      pointMap.set(id, { id, x: pt.x, y: pt.y, fixed });
    }
    // Also store radius / angles as special synthetic point slots if needed
    // (circle: points[0] = center, radius stored separately)
  }

  // Build ordered param list from non-fixed points
  for (const sp of pointMap.values()) {
    if (!sp.fixed) {
      paramIndex.push({ pointId: sp.id, coord: 'x' });
      params.push(sp.x);
      paramIndex.push({ pointId: sp.id, coord: 'y' });
      params.push(sp.y);
    }
  }

  return { params, pointMap, paramIndex };
}

/** Apply updated param vector back into pointMap. */
function applyParams(
  params: number[],
  paramIndex: { pointId: string; coord: 'x' | 'y' }[],
  pointMap: Map<string, SolverPoint>
): void {
  for (let i = 0; i < params.length; i++) {
    const { pointId, coord } = paramIndex[i];
    const sp = pointMap.get(pointId)!;
    if (coord === 'x') sp.x = params[i];
    else sp.y = params[i];
  }
}

// ─── Residual computation ─────────────────────────────────────────────────

/**
 * Returns the x,y coords of a specific point on an entity from the live pointMap.
 * pointIndex is the index into entity.points[].
 */
function getPoint(
  entityId: string,
  pointIndex: number,
  pointMap: Map<string, SolverPoint>
): { x: number; y: number } {
  const sp = pointMap.get(`${entityId}-p${pointIndex}`);
  if (!sp) return { x: 0, y: 0 };
  return { x: sp.x, y: sp.y };
}

function parseDimensionReference(raw: string | undefined): {
  entityId: string;
  edgeIndex?: number;
  vertexIndex?: number;
  isCenter: boolean;
} | null {
  if (!raw) return null;
  const [edgeEntityId, edgePart] = raw.split('::edge:');
  if (edgePart !== undefined) {
    const edgeIndex = Number(edgePart);
    return {
      entityId: edgeEntityId,
      edgeIndex: Number.isInteger(edgeIndex) ? edgeIndex : undefined,
      isCenter: false,
    };
  }

  const [vertexEntityId, vertexPart] = raw.split('::vertex:');
  if (vertexPart !== undefined) {
    const vertexIndex = Number(vertexPart);
    return {
      entityId: vertexEntityId,
      vertexIndex: Number.isInteger(vertexIndex) ? vertexIndex : undefined,
      isCenter: false,
    };
  }

  const [centerEntityId, centerPart] = raw.split('::center');
  if (centerPart !== undefined) return { entityId: centerEntityId, isCenter: true };
  return { entityId: raw, isCenter: false };
}

function resolveDimensionSegment(
  raw: string | undefined,
  entityMap: Map<string, SketchEntity>,
  pointMap: Map<string, SolverPoint>,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const ref = parseDimensionReference(raw);
  if (!ref) return null;
  const entity = entityMap.get(ref.entityId);
  if (!entity) return null;

  if (ref.isCenter) {
    const center = getPoint(entity.id, 0, pointMap);
    return { start: center, end: center };
  }

  if (ref.vertexIndex !== undefined) {
    if (ref.vertexIndex < 0 || ref.vertexIndex >= entity.points.length) return null;
    const vertex = getPoint(entity.id, ref.vertexIndex, pointMap);
    return { start: vertex, end: vertex };
  }

  if (entity.type === 'rectangle' && entity.points.length >= 2) {
    const p0 = getPoint(entity.id, 0, pointMap);
    const p1 = getPoint(entity.id, 1, pointMap);
    const corners = [
      p0,
      { x: p1.x, y: p0.y },
      p1,
      { x: p0.x, y: p1.y },
    ];
    if (ref.edgeIndex !== undefined) {
      if (ref.edgeIndex < 0 || ref.edgeIndex > 3) return null;
      return { start: corners[ref.edgeIndex], end: corners[(ref.edgeIndex + 1) % corners.length] };
    }
    return { start: p0, end: p1 };
  }

  if (entity.points.length >= 2) {
    return {
      start: getPoint(entity.id, 0, pointMap),
      end: getPoint(entity.id, entity.points.length - 1, pointMap),
    };
  }

  if (entity.points.length === 1) {
    const point = getPoint(entity.id, 0, pointMap);
    return { start: point, end: point };
  }

  return null;
}

function dimensionAxisDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  orientation: SketchDimension['orientation'],
): number {
  if (orientation === 'vertical') return Math.abs(b.y - a.y);
  if (orientation === 'horizontal') return Math.abs(b.x - a.x);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function dimensionsToSolverConstraints(dimensions: SketchDimension[] = []): SolverConstraint[] {
  return dimensions
    .filter((dimension) => !dimension.driven)
    .flatMap((dimension): SolverConstraint[] => {
      switch (dimension.type) {
        case 'linear':
          return [{
            type: 'dimension-linear',
            entityIds: dimension.entityIds,
            value: dimension.value,
            orientation: dimension.orientation,
          }];
        case 'aligned':
          return [{ type: 'dimension-aligned', entityIds: dimension.entityIds, value: dimension.value }];
        case 'radial':
          return [{ type: 'dimension-radial', entityIds: dimension.entityIds, value: dimension.value }];
        case 'diameter':
          return [{ type: 'dimension-diameter', entityIds: dimension.entityIds, value: dimension.value }];
        default:
          return [];
      }
    });
}

/**
 * Compute all residuals for the current parameter state.
 * Returns a flat array of residual values (one scalar per dimension).
 */
function computeResiduals(
  constraints: SolverConstraint[],
  entityMap: Map<string, SketchEntity>,
  pointMap: Map<string, SolverPoint>
): number[] {
  const residuals: number[] = [];

  for (const c of constraints) {
    switch (c.type) {
      case 'horizontal': {
        // Line is horizontal: y of first point == y of last point
        const e = entityMap.get(c.entityIds[0]);
        if (!e || e.points.length < 2) break;
        const p0 = getPoint(e.id, 0, pointMap);
        const p1 = getPoint(e.id, e.points.length - 1, pointMap);
        residuals.push(p1.y - p0.y);
        break;
      }
      case 'vertical': {
        const e = entityMap.get(c.entityIds[0]);
        if (!e || e.points.length < 2) break;
        const p0 = getPoint(e.id, 0, pointMap);
        const p1 = getPoint(e.id, e.points.length - 1, pointMap);
        residuals.push(p1.x - p0.x);
        break;
      }
      case 'coincident': {
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB) break;
        const piA = c.pointIndices?.[0] ?? 0;
        const piB = c.pointIndices?.[1] ?? 0;
        const pA = getPoint(eA.id, piA, pointMap);
        const pB = getPoint(eB.id, piB, pointMap);
        residuals.push(pA.x - pB.x);
        residuals.push(pA.y - pB.y);
        break;
      }
      case 'collinear': {
        // Three points collinear: cross product of (B-A) × (C-A) = 0
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB || eA.points.length < 2 || eB.points.length < 2) break;
        const a0 = getPoint(eA.id, 0, pointMap);
        const a1 = getPoint(eA.id, eA.points.length - 1, pointMap);
        const b0 = getPoint(eB.id, 0, pointMap);
        // (a1-a0) × (b0-a0) = 0
        residuals.push((a1.x - a0.x) * (b0.y - a0.y) - (a1.y - a0.y) * (b0.x - a0.x));
        break;
      }
      case 'parallel': {
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB || eA.points.length < 2 || eB.points.length < 2) break;
        const a0 = getPoint(eA.id, 0, pointMap);
        const a1 = getPoint(eA.id, eA.points.length - 1, pointMap);
        const b0 = getPoint(eB.id, 0, pointMap);
        const b1 = getPoint(eB.id, eB.points.length - 1, pointMap);
        // cross product = 0
        residuals.push((a1.x - a0.x) * (b1.y - b0.y) - (a1.y - a0.y) * (b1.x - b0.x));
        break;
      }
      case 'perpendicular': {
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB || eA.points.length < 2 || eB.points.length < 2) break;
        const a0 = getPoint(eA.id, 0, pointMap);
        const a1 = getPoint(eA.id, eA.points.length - 1, pointMap);
        const b0 = getPoint(eB.id, 0, pointMap);
        const b1 = getPoint(eB.id, eB.points.length - 1, pointMap);
        // dot product = 0
        residuals.push((a1.x - a0.x) * (b1.x - b0.x) + (a1.y - a0.y) * (b1.y - b0.y));
        break;
      }
      case 'equal': {
        // Equal length for lines; equal radius for circles
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB) break;
        const lenOf = (e: SketchEntity): number => {
          if (e.type === 'circle') return e.radius ?? 0;
          if (e.points.length < 2) return 0;
          const p0 = getPoint(e.id, 0, pointMap);
          const p1 = getPoint(e.id, e.points.length - 1, pointMap);
          return Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
        };
        residuals.push(lenOf(eA) - lenOf(eB));
        break;
      }
      case 'concentric': {
        // Centers coincide
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB) break;
        const cA = getPoint(eA.id, 0, pointMap); // points[0] = center for circle/arc
        const cB = getPoint(eB.id, 0, pointMap);
        residuals.push(cA.x - cB.x);
        residuals.push(cA.y - cB.y);
        break;
      }
      case 'midpoint': {
        // points[0] of entity B lies at midpoint of entity A
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB || eA.points.length < 2) break;
        const a0 = getPoint(eA.id, 0, pointMap);
        const a1 = getPoint(eA.id, eA.points.length - 1, pointMap);
        const b0 = getPoint(eB.id, 0, pointMap);
        residuals.push(b0.x - (a0.x + a1.x) / 2);
        residuals.push(b0.y - (a0.y + a1.y) / 2);
        break;
      }
      case 'fix':
        // fix: handled via fixed flags
        break;
      case 'tangent': {
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB) break;
        const line = eA.points.length >= 2 && (eA.type === 'line' || eA.type === 'construction-line' || eA.type === 'centerline') ? eA
          : eB.points.length >= 2 && (eB.type === 'line' || eB.type === 'construction-line' || eB.type === 'centerline') ? eB
            : null;
        const curve = line === eA ? eB : eA;
        if (!line || !(curve.type === 'circle' || curve.type === 'arc')) break;
        const a0 = getPoint(line.id, 0, pointMap);
        const a1 = getPoint(line.id, line.points.length - 1, pointMap);
        const center = getPoint(curve.id, 0, pointMap);
        const dx = a1.x - a0.x;
        const dy = a1.y - a0.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-12) break;
        const distance = Math.abs(dy * center.x - dx * center.y + a1.x * a0.y - a1.y * a0.x) / len;
        residuals.push(distance - (curve.radius ?? 0));
        break;
      }
      case 'symmetric': {
        // entityIds: [axisId, entityAId, entityBId]
        // Mirror each point of entity A across the axis entity's line;
        // residual = mirror(pA) - pB (must be zero when symmetric).
        if (c.entityIds.length < 3) break;
        const axisEntity = entityMap.get(c.entityIds[0]);
        const entityA    = entityMap.get(c.entityIds[1]);
        const entityB    = entityMap.get(c.entityIds[2]);
        if (!axisEntity || !entityA || !entityB) break;
        if (axisEntity.points.length < 2) break;

        const axisP0 = getPoint(axisEntity.id, 0, pointMap);
        const axisP1 = getPoint(axisEntity.id, axisEntity.points.length - 1, pointMap);
        const adx = axisP1.x - axisP0.x;
        const ady = axisP1.y - axisP0.y;
        const len2 = adx * adx + ady * ady;
        if (len2 < 1e-12) break; // degenerate axis

        const nPairs = Math.min(entityA.points.length, entityB.points.length);
        for (let pi = 0; pi < nPairs; pi++) {
          const pA = getPoint(entityA.id, pi, pointMap);
          const pB = getPoint(entityB.id, pi, pointMap);

          // Foot of perpendicular from pA onto axis line
          const t = ((pA.x - axisP0.x) * adx + (pA.y - axisP0.y) * ady) / len2;
          const footX = axisP0.x + t * adx;
          const footY = axisP0.y + t * ady;

          // Mirror of pA across the axis
          const mirrorX = 2 * footX - pA.x;
          const mirrorY = 2 * footY - pA.y;

          residuals.push(mirrorX - pB.x);
          residuals.push(mirrorY - pB.y);
        }
        break;
      }
      case 'offset': {
        // SK-A9: parametric offset — enforces two residuals on two lines:
        //  1. Parallel: (a1-a0) × (b1-b0) = 0  (direction cross product)
        //  2. Distance: |(b0-a0) × (a1-a0)| / |a1-a0| - value = 0
        if (c.entityIds.length < 2) break;
        const eA = entityMap.get(c.entityIds[0]);
        const eB = entityMap.get(c.entityIds[1]);
        if (!eA || !eB || eA.points.length < 2 || eB.points.length < 2) break;
        const a0 = getPoint(eA.id, 0, pointMap);
        const a1 = getPoint(eA.id, eA.points.length - 1, pointMap);
        const b0 = getPoint(eB.id, 0, pointMap);
        const b1 = getPoint(eB.id, eB.points.length - 1, pointMap);
        const adx = a1.x - a0.x;
        const ady = a1.y - a0.y;
        const bdx = b1.x - b0.x;
        const bdy = b1.y - b0.y;
        // 1. Parallel residual
        residuals.push(adx * bdy - ady * bdx);
        // 2. Perpendicular distance residual: signed cross / |a| - value
        const aLen = Math.sqrt(adx * adx + ady * ady);
        if (aLen > 1e-10) {
          const crossBA = (b0.x - a0.x) * ady - (b0.y - a0.y) * adx;
          residuals.push(crossBA / aLen - (c.value ?? 10));
        }
        break;
      }
      case 'curvature': {
        // G2 curvature continuity between two spline entities at their junction.
        // entityIds: [entityAId, entityBId]  (A's end meets B's start)
        if (c.entityIds.length < 2) break;
        const entityA = entityMap.get(c.entityIds[0]);
        const entityB = entityMap.get(c.entityIds[1]);
        if (!entityA || !entityB) break;

        // For non-spline entities curvature is zero — no constraint needed.
        if (entityA.type !== 'spline' || entityB.type !== 'spline') {
          residuals.push(0);
          break;
        }

        // Require at least 3 control points on each spline to have a second
        // derivative.
        if (entityA.points.length >= 3 && entityB.points.length >= 3) {
          const nA = entityA.points.length;

          // Second-difference (discrete second derivative) at A's end
          const pA2 = getPoint(entityA.id, nA - 1, pointMap); // last
          const pA1 = getPoint(entityA.id, nA - 2, pointMap); // second-to-last
          const pA0 = getPoint(entityA.id, nA - 3, pointMap); // third-to-last
          const d2Ax = pA2.x - 2 * pA1.x + pA0.x;
          const d2Ay = pA2.y - 2 * pA1.y + pA0.y;

          // Second-difference at B's start
          const pB0 = getPoint(entityB.id, 0, pointMap);
          const pB1 = getPoint(entityB.id, 1, pointMap);
          const pB2 = getPoint(entityB.id, 2, pointMap);
          const d2Bx = pB0.x - 2 * pB1.x + pB2.x;
          const d2By = pB0.y - 2 * pB1.y + pB2.y;

          residuals.push(d2Ax - d2Bx);
          residuals.push(d2Ay - d2By);
        } else {
          residuals.push(0);
        }
        break;
      }
      case 'coincident-surface': {
        // Point (entityIds[0], pointIndices[0] ?? 0) lies on plane: nu*px + nv*py + d = 0
        if (!c.surfacePlane) break;
        const e = entityMap.get(c.entityIds[0]);
        if (!e) break;
        const pi = c.pointIndices?.[0] ?? 0;
        const p = getPoint(e.id, pi, pointMap);
        residuals.push(c.surfacePlane.nu * p.x + c.surfacePlane.nv * p.y + c.surfacePlane.d);
        break;
      }
      case 'perpendicular-surface': {
        // Line direction (dx, dy) is parallel to surface normal (nu, nv): cross = 0
        // i.e., line is NORMAL TO the surface → direction aligns with surface normal
        if (!c.surfacePlane || c.entityIds.length < 1) break;
        const e = entityMap.get(c.entityIds[0]);
        if (!e || e.points.length < 2) break;
        const p0 = getPoint(e.id, 0, pointMap);
        const p1 = getPoint(e.id, e.points.length - 1, pointMap);
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const { nu, nv } = c.surfacePlane;
        // cross(line_dir, normal_dir) = 0
        residuals.push(dx * nv - dy * nu);
        break;
      }
      case 'line-on-surface': {
        // Both endpoints of line lie on the plane: nu*px + nv*py + d = 0 for both
        if (!c.surfacePlane || c.entityIds.length < 1) break;
        const e = entityMap.get(c.entityIds[0]);
        if (!e || e.points.length < 2) break;
        const p0 = getPoint(e.id, 0, pointMap);
        const p1 = getPoint(e.id, e.points.length - 1, pointMap);
        const { nu, nv, d } = c.surfacePlane;
        residuals.push(nu * p0.x + nv * p0.y + d);
        residuals.push(nu * p1.x + nv * p1.y + d);
        break;
      }
      case 'distance-surface': {
        // Signed distance from point to plane = value
        // dist = (nu*px + nv*py + d) / sqrt(nu²+nv²) - value = 0
        if (!c.surfacePlane || c.entityIds.length < 1) break;
        const e = entityMap.get(c.entityIds[0]);
        if (!e) break;
        const pi = c.pointIndices?.[0] ?? 0;
        const p = getPoint(e.id, pi, pointMap);
        const { nu, nv, d } = c.surfacePlane;
        const len = Math.sqrt(nu * nu + nv * nv);
        if (len < 1e-10) break;
        residuals.push((nu * p.x + nv * p.y + d) / len - (c.value ?? 0));
        break;
      }
      case 'dimension-linear':
      case 'dimension-aligned': {
        const targetValue = c.value;
        if (targetValue === undefined || !Number.isFinite(targetValue)) break;
        const first = resolveDimensionSegment(c.entityIds[0], entityMap, pointMap);
        if (!first) break;
        const second = resolveDimensionSegment(c.entityIds[1], entityMap, pointMap);

        if (second) {
          const firstPoint = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y) < 1e-8
            ? first.start
            : { x: (first.start.x + first.end.x) / 2, y: (first.start.y + first.end.y) / 2 };
          const secondPoint = Math.hypot(second.end.x - second.start.x, second.end.y - second.start.y) < 1e-8
            ? second.start
            : { x: (second.start.x + second.end.x) / 2, y: (second.start.y + second.end.y) / 2 };
          const distance = c.type === 'dimension-aligned'
            ? Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
            : dimensionAxisDistance(firstPoint, secondPoint, c.orientation);
          residuals.push(distance - targetValue);
          break;
        }

        const distance = c.type === 'dimension-aligned'
          ? Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y)
          : dimensionAxisDistance(first.start, first.end, c.orientation);
        residuals.push(distance - targetValue);
        break;
      }
      case 'dimension-radial':
      case 'dimension-diameter': {
        const ref = parseDimensionReference(c.entityIds[0]);
        const entity = ref ? entityMap.get(ref.entityId) : null;
        if (!entity || !Number.isFinite(c.value)) break;
        const radius = entity.radius ?? 0;
        residuals.push(radius - (c.type === 'dimension-diameter' ? (c.value ?? 0) / 2 : c.value ?? 0));
        break;
      }
      default:
        break;
    }
  }

  return residuals;
}

// ─── Jacobian ─────────────────────────────────────────────────────────────

function computeJacobian(
  params: number[],
  paramIndex: { pointId: string; coord: 'x' | 'y' }[],
  constraints: SolverConstraint[],
  entityMap: Map<string, SketchEntity>,
  pointMap: Map<string, SolverPoint>
): number[][] {
  const h = 1e-7;
  const m = computeResiduals(constraints, entityMap, pointMap).length;
  const n = params.length;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));

  for (let j = 0; j < n; j++) {
    // Forward perturbation
    params[j] += h;
    applyParams(params, paramIndex, pointMap);
    const fPlus = computeResiduals(constraints, entityMap, pointMap);

    // Backward perturbation
    params[j] -= 2 * h;
    applyParams(params, paramIndex, pointMap);
    const fMinus = computeResiduals(constraints, entityMap, pointMap);

    // Restore
    params[j] += h;
    applyParams(params, paramIndex, pointMap);

    for (let i = 0; i < m; i++) {
      J[i][j] = (fPlus[i] - fMinus[i]) / (2 * h);
    }
  }

  return J;
}

// ─── Main entry point ─────────────────────────────────────────────────────

export function solveConstraints(
  entities: SketchEntity[],
  constraints: SolverConstraint[],
  options?: { maxIterations?: number; tolerance?: number; stepSize?: number }
): SolverResult {
  const maxIterations = options?.maxIterations ?? 100;
  const tolerance = options?.tolerance ?? 1e-6;
  const stepSize = options?.stepSize ?? 1.0;

  // Collect entity ids that should be fixed
  const fixedEntityIds = new Set<string>(
    constraints.filter((c) => c.type === 'fix').flatMap((c) => c.entityIds)
  );

  const entityMap = new Map<string, SketchEntity>(entities.map((e) => [e.id, e]));

  const { params: initialParams, pointMap, paramIndex } = buildParams(entities, fixedEntityIds);

  // Nothing can move; still evaluate residuals so fixed, inconsistent geometry is blocked.
  if (initialParams.length === 0 || constraints.length === 0) {
    const residuals = computeResiduals(constraints, entityMap, pointMap);
    const residual = residuals.length === 0 ? 0 : Math.max(...residuals.map(Math.abs));
    const updatedPoints = new Map<string, { x: number; y: number }>();
    for (const [id, sp] of pointMap) updatedPoints.set(id, { x: sp.x, y: sp.y });
    return { solved: residual < tolerance, iterations: 0, updatedPoints, residual };
  }

  let params = [...initialParams];

  let finalResidual = 0;
  let finalIter = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    applyParams(params, paramIndex, pointMap);
    const f = computeResiduals(constraints, entityMap, pointMap);

    if (f.length === 0) {
      finalIter = iter;
      finalResidual = 0;
      break;
    }

    finalResidual = Math.max(...f.map(Math.abs));
    finalIter = iter;

    if (finalResidual < tolerance) break;

    const J = computeJacobian(params, paramIndex, constraints, entityMap, pointMap);
    const delta = solveNormalEquations(J, f);

    if (delta.length !== params.length) break;

    params = params.map((p, i) => p - stepSize * delta[i]);
  }

  // Final apply
  applyParams(params, paramIndex, pointMap);

  const updatedPoints = new Map<string, { x: number; y: number }>();
  for (const [id, sp] of pointMap) updatedPoints.set(id, { x: sp.x, y: sp.y });

  return {
    solved: finalResidual < tolerance,
    iterations: finalIter,
    updatedPoints,
    residual: finalResidual,
  };
}

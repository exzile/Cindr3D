/**
 * ConstraintSolver.ts — Newton-Raphson 2D geometric constraint solver.
 * Pure TypeScript math; no React, no Three.js, no store imports.
 */
import type { SketchEntity, SketchConstraint } from '../types/cad';

// ─── Public types ──────────────────────────────────────────────────────────

export interface SolverPoint {
  id: string;    // e.g. "e123-p0" — entity id + point index
  x: number;
  y: number;
  fixed: boolean;
}

export interface SolverConstraint {
  type: SketchConstraint['type'];
  entityIds: string[];
  pointIndices?: number[];
  value?: number;
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

/**
 * Compute all residuals for the current parameter state.
 * Returns a flat array of residual values (one scalar per dimension).
 */
function computeResiduals(
  constraints: SketchConstraint[],
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
      case 'tangent':
      case 'symmetric':
      case 'curvature':
        // fix: handled via fixed flags; tangent/symmetric/curvature: deferred
        break;
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
  constraints: SketchConstraint[],
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
  constraints: SketchConstraint[],
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

  // Nothing to solve
  if (initialParams.length === 0 || constraints.length === 0) {
    const updatedPoints = new Map<string, { x: number; y: number }>();
    for (const [id, sp] of pointMap) updatedPoints.set(id, { x: sp.x, y: sp.y });
    return { solved: true, iterations: 0, updatedPoints, residual: 0 };
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

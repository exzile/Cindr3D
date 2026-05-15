/**
 * sketchSolveInputs.ts — single source of truth for the entities + constraints
 * fed into the Newton-Raphson `solveConstraints`.
 *
 * Both the *real* solve (`solveSketch` in
 * store/cad/slices/selectionAndSketchOps/constraintAndViewActions.ts) and the
 * *trial* over-constraint check (`engine/overConstraintCheck.ts`) build their
 * solver inputs here. Extracting this once and calling it twice guarantees the
 * prediction matches reality — if the projection or constraint assembly drifts
 * between the two call sites the over-constraint prompt would lie.
 *
 * Pure TypeScript: no React, no store imports. Depends only on GeometryEngine's
 * plane-axis math (the SoT for sketch t1/t2) and the dimension→constraint
 * converter.
 */
import { GeometryEngine } from './GeometryEngine';
import { dimensionsToSolverConstraints } from './ConstraintSolver';
import type { SolverConstraint } from './ConstraintSolver';
import type { Sketch, SketchEntity } from '../types/cad';

/** Solver options used by the real solve — kept here so the trial solve can reuse the exact same values. */
export const SKETCH_SOLVE_OPTIONS: { maxIterations?: number; tolerance?: number; stepSize?: number } | undefined =
  undefined;

/**
 * Project a sketch's 3D entity points into the sketch plane's local 2D frame
 * (z forced to 0), exactly as the real `solveSketch` does. Always uses
 * `GeometryEngine.getSketchAxes` (named- and custom-plane aware) — never raw
 * p.x/p.y, which is wrong on non-XY planes.
 */
export function projectSketchEntities(sketch: Sketch): SketchEntity[] {
  const { t1, t2 } = GeometryEngine.getSketchAxes(sketch);
  const origin = sketch.planeOrigin;
  return sketch.entities.map((e) => ({
    ...e,
    points: e.points.map((pt) => {
      const dx = pt.x - origin.x;
      const dy = pt.y - origin.y;
      const dz = pt.z - origin.z;
      return {
        ...pt,
        x: dx * t1.x + dy * t1.y + dz * t1.z,
        y: dx * t2.x + dy * t2.y + dz * t2.z,
        z: 0,
      };
    }),
  }));
}

/**
 * Build the `{ entities, constraints }` pair the solver consumes for a sketch.
 * Mirrors `solveSketch` 1:1: projected entities + the concatenation of the
 * sketch's geometric constraints with the non-driven dimension constraints
 * (`dimensionsToSolverConstraints` already filters `driven:true`).
 */
export function buildSketchSolveInputs(sketch: Sketch): {
  entities: SketchEntity[];
  constraints: SolverConstraint[];
} {
  const entities = projectSketchEntities(sketch);
  const constraints: SolverConstraint[] = [
    ...(sketch.constraints ?? []),
    ...dimensionsToSolverConstraints(sketch.dimensions ?? []),
  ];
  return { entities, constraints };
}

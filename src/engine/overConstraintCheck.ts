/**
 * overConstraintCheck.ts — Fusion-360-style *predictive* over-constraint test.
 *
 * Pure TypeScript: no React, no store imports. Runs a trial solve so the
 * dimension commit / edit paths can intercept a constraint that would break
 * the sketch BEFORE mutating geometry (the real solve only detects it
 * post-fact, after geometry has silently failed to update).
 *
 * Correctness contract: the trial MUST use the exact same projected entities
 * and constraint assembly as the real solve. That is why it goes through the
 * shared `buildSketchSolveInputs` (the single source of truth also used by
 * `solveSketch`) and through the same `solveConstraints` with the same
 * `SKETCH_SOLVE_OPTIONS`. Build once, call twice ⇒ prediction == reality.
 */
import { solveConstraints } from './ConstraintSolver';
import { buildSketchSolveInputs, SKETCH_SOLVE_OPTIONS } from './sketchSolveInputs';
import type { Sketch, SketchDimension } from '../types/cad';

/**
 * Would adding `candidate` to `sketch` over-constrain it?
 *
 * The candidate is appended to the sketch's existing dimensions and the whole
 * thing is fed through the shared solver input builder so the prediction
 * matches what `solveSketch` would later compute. A driven (reference)
 * candidate can never over-constrain (it never reaches the solver — see
 * `dimensionsToSolverConstraints`), so it short-circuits to `false`.
 *
 * For the *edit* path the caller passes a sketch whose `.dimensions` already
 * has the dimension-being-edited removed; `candidate` is the same dimension
 * with the new value. For the *add* path the sketch is the live sketch and
 * `candidate` is the brand-new dimension.
 */
export function wouldOverConstrain(sketch: Sketch, candidate: SketchDimension): boolean {
  // Driven/reference dimensions are annotation-only — they are filtered out by
  // `dimensionsToSolverConstraints` and so can NEVER add a solver constraint.
  if (candidate.driven) return false;

  const trialSketch: Sketch = {
    ...sketch,
    dimensions: [...(sketch.dimensions ?? []), candidate],
  };
  const { entities, constraints } = buildSketchSolveInputs(trialSketch);

  // No solvable system (e.g. a candidate that couldn't be expressed as a
  // solver constraint) cannot over-constrain.
  if (constraints.length === 0) return false;

  const result = solveConstraints(entities, constraints, SKETCH_SOLVE_OPTIONS);
  return !result.solved;
}

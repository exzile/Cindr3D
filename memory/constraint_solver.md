---
name: Constraint Solver Architecture
description: Newton-Raphson 2D sketch constraint solver — DOF model, SolverResult shape, scalar DOFs, rank-based over-constraint detection
type: project
---

Solver: `src/engine/ConstraintSolver.ts`. Pure TS, no React/Three. Called from `constraintAndViewActions.solveSketch()`.

## Parameter model (B1 — 2026-05-31)

`buildParams()` emits:
- **Point DOFs**: `"${entityId}-p${i}"` → x + y params (2 entries in paramIndex)
- **Scalar DOFs**: `"${entityId}::radius"` / `"::startAngle"` / `"::endAngle"` → x only (1 entry)

Scalar DOF IDs contain `"::"` — use this to distinguish from point DOFs when iterating `pointMap`.

`getScalarDof(entityId, suffix, pointMap, fallback)` reads live scalar from pointMap with entity field fallback.

## SolverResult shape

```ts
{ solved, iterations, residual,
  updatedPoints: Map<"entityId-pN", {x,y}>,   // projected 2D coords
  updatedScalars: Map<"entityId::suffix", number>, // radius/startAngle/endAngle
  rank, nParams }  // B6: for DOF / over-constraint detection
```

`constraintAndViewActions.solveSketch()` un-projects updatedPoints back to 3D and applies updatedScalars to entity `radius`/`startAngle`/`endAngle`.

## Over-constraint detection (B6/B7)

`rank >= nParams && residual > tol` → genuine conflict (flag `overConstrained`).  
`rank < nParams && !solved` → non-convergence or underdetermined — do NOT flag overConstrained (was a false positive for pre-B1 radial dims).  
`rank >= nParams && solved` → `fullyConstrained = true` (turns geometry black in future DOF coloring).

## Fix constraint granularity (B9)

`fix` with **no** `pointIndices` → whole entity fixed (all points + radius scalar).  
`fix` with `pointIndices` → only those specific points fixed; radius remains free.

## Tangent constraint (B4)

- **line-curve**: `dist(center, line) = radius` (reads live radius from solver params).
- **curve-curve**: `dist(cA, cB) = rA ± rB`. External vs internal chosen by which target is geometrically closer at solve start.

## Equal constraint (B2)

Circle/arc pairs now produce residual `rA - rB = 0` (radius is a DOF). Line+circle pairs rejected at the tool level with a user message.

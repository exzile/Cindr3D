/**
 * unifyShape.ts — wrap OCCT's ShapeUpgrade_UnifySameDomain.
 *
 * OCC boolean operations + extrude/sweep often leave a shape with many small
 * faces and edges that are C1-continuous with their neighbours.  Example:
 *   - A circle profile gets sampled into 64 line segments before extrude →
 *     the resulting "cylinder" is 64 flat side faces with 64 shared edges.
 *   - Each boolean cut/union introduces seam edges at the intersection that
 *     could be merged back once the operation is done.
 *
 * ShapeUpgrade_UnifySameDomain walks the topology and merges:
 *   - Adjacent faces that share the same underlying surface (e.g. coplanar)
 *   - Adjacent edges that share the same underlying curve (e.g. collinear)
 *   - When ConcatBSplines is true, it will also join C1 BSpline curves
 *
 * The result is the SAME geometry with a much smaller TopoDS graph — fewer
 * spurious edges show up in pickers, fillet/chamfer edge counts drop, and
 * tessellation is faster.
 */
import type { OcctRaw } from '../types';
import { makeBRepBodyFromOccShape, occDeref, type BRepBody } from '../brepBody';

interface OccUnifier {
  Build(): void;
  Shape(): unknown;
  delete?(): void;
}

type OccUnifyApi = OcctRaw & {
  ShapeUpgrade_UnifySameDomain_2?: new (
    shape: unknown,
    unifyEdges: boolean,
    unifyFaces: boolean,
    concatBSplines: boolean,
  ) => OccUnifier;
  ShapeUpgrade_UnifySameDomain_1?: new () => OccUnifier & {
    Initialize(
      shape: unknown,
      unifyEdges: boolean,
      unifyFaces: boolean,
      concatBSplines: boolean,
    ): void;
  };
};

export interface UnifyShapeOptions {
  unifyEdges?: boolean;
  unifyFaces?: boolean;
  /** Merge consecutive C1 BSpline edges/curves into one. Default: false. */
  concatBSplines?: boolean;
}

/**
 * Apply ShapeUpgrade_UnifySameDomain to a BRepBody (high-level wrapper).
 * Returns a new BRepBody with merged same-domain faces/edges, or null if the
 * binding is unavailable or the operation fails.
 *
 * The returned body keeps the unifier alive via ownedResources so that the
 * shape VIEW returned by unifier.Shape() remains valid for the lifetime of the
 * body.  The caller is responsible for disposing the original body.
 */
export function occUnifyBodyWithInstance(
  oc: OcctRaw,
  body: BRepBody,
  options: UnifyShapeOptions & { sourceFeatureId?: string } = {},
): BRepBody | null {
  const rawShape = occDeref(oc, body.shape, oc.TopoDS_Shape);
  const result = unifyRawShape(oc, rawShape, options);
  if (!result) return null;
  const newBody = makeBRepBodyFromOccShape(oc, result.rawShape, {
    sourceFeatureId: options.sourceFeatureId,
  });
  // Keep the unifier alive so the shape VIEW stays valid.
  (newBody.ownedResources ??= []).push(result.unifier);
  return newBody;
}

/**
 * Apply ShapeUpgrade_UnifySameDomain to a raw OCC TopoDS_Shape.
 * Returns a NEW raw shape (the unifier's Shape() result) — the caller owns
 * the unifier and must keep it alive while the new shape is used (because
 * Shape() is a VIEW into the unifier's internal storage in this build).
 *
 * Returns { rawShape, unifier } so caller can stash unifier as ownedResources
 * before disposing, OR null if the binding is unavailable.
 *
 * On failure (Build throws), returns null and the unifier is cleaned up.
 */

export function unifyRawShape(
  oc: OcctRaw,
  rawShape: unknown,
  options: UnifyShapeOptions = {},
): { rawShape: unknown; unifier: { delete?: () => void } } | null {
  const api = oc as OccUnifyApi;
  const unifyEdges = options.unifyEdges ?? true;
  const unifyFaces = options.unifyFaces ?? true;
  const concatBSplines = options.concatBSplines ?? false;

  let unifier: OccUnifier | null = null;
  try {
    if (api.ShapeUpgrade_UnifySameDomain_2) {
      unifier = new api.ShapeUpgrade_UnifySameDomain_2(
        rawShape,
        unifyEdges,
        unifyFaces,
        concatBSplines,
      );
    } else if (api.ShapeUpgrade_UnifySameDomain_1) {
      const u = new api.ShapeUpgrade_UnifySameDomain_1();
      u.Initialize(rawShape, unifyEdges, unifyFaces, concatBSplines);
      unifier = u;
    } else {
      return null;
    }
    const activeUnifier = unifier;
    if (!activeUnifier) return null;
    activeUnifier.Build();
    const unified = activeUnifier.Shape();
    if (!unified) {
      activeUnifier.delete?.();
      return null;
    }
    return { rawShape: unified, unifier: activeUnifier };
  } catch (e) {
    console.warn('[unifyShape] ShapeUpgrade_UnifySameDomain failed:', e);
    unifier?.delete?.();
    return null;
  }
}

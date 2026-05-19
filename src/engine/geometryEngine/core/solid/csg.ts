import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import { extractEdgeTopology, type BodyTopology } from './edgeTopology';
import { weldAndCleanSolid } from './weldClean';

const csgEvaluator = new Evaluator();
csgEvaluator.useGroups = false;

function ensureUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  const count = (geometry.attributes.position as THREE.BufferAttribute).count;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
}

export function csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureUVs(a);
  ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  const result = csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
  // Non-indexed geometry gives each triangle its own vertices so normals at
  // cut edges are computed independently per face — no averaging across the
  // outer-surface/cut-wall boundary.  This makes the depth of the cut clearly
  // visible (cut walls are distinct faces, not blurred into the outer surface).
  // toNonIndexed gives each triangle its own vertices → per-face normals at
  // cut edges are not averaged with outer-surface normals → depth is visible.
  // Skip if already non-indexed (three-bvh-csg sometimes returns non-indexed geometry).
  const nonIndexed = result.geometry.index
    ? result.geometry.toNonIndexed()
    : result.geometry;
  nonIndexed.computeVertexNormals();
  if (nonIndexed !== result.geometry) result.geometry.dispose();
  return nonIndexed;
}

/**
 * Like {@link csgSubtract} but ALSO extracts the result's model-edge topology
 * (whole creases / boundary loops as polylines) from the INDEXED result —
 * before the `toNonIndexed()` split destroys connectivity — and attaches it as
 * `geometry.userData.topology`. The returned render geometry is byte-identical
 * to what `csgSubtract` produces (same `toNonIndexed()` + per-face normals), so
 * rendering, slicing and export are unaffected; the topology is purely
 * additive metadata consumed by the edge picker / fillet / chamfer.
 *
 * Phase 1: the topology is computed and attached but no existing caller is
 * rewired yet — this lets it be validated in isolation.
 */
export function csgSubtractWithTopology(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; topology: BodyTopology } {
  ensureUVs(a);
  ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  const result = csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);

  // three-bvh-csg's raw output is a NON-MANIFOLD soup: every flat face the
  // cut crossed is exploded into a giant skewed "broken-face fan", and seam
  // verts are coincident-but-unshared. Extracting edge topology from THAT
  // produces phantom creases (fan struts mis-paired by HalfEdgeMap's
  // disjoint matching) AND drops real edges bordering the cut — the
  // un-selectable / un-chamferable spurious lines. So WELD + CLEAN first
  // (collapses the fan back to a minimal manifold triangulation — the exact
  // same battle-tested pass fillet/chamfer already run on CSG results), then
  // extract topology from the clean manifold: every real box/rim edge has a
  // proper manifold sibling, no fan struts exist, so the crease test yields
  // the true model edges with zero spurious. The cleaned geometry is also a
  // strictly better render mesh, so it is what we return.
  let solid: THREE.BufferGeometry;
  try {
    solid = weldAndCleanSolid(result.geometry);
    result.geometry.dispose();
  } catch {
    // Cleaning failed — fall back to the raw (correct, if soupy) result so a
    // CSG hiccup never breaks the modelling pipeline.
    solid = result.geometry.index
      ? result.geometry.toNonIndexed()
      : result.geometry;
    if (solid !== result.geometry) result.geometry.dispose();
    solid.computeVertexNormals();
  }

  let topology: BodyTopology;
  try {
    topology = extractEdgeTopology(solid);
  } catch {
    topology = { edges: [] };
  }
  solid.userData.topology = topology;
  return { geometry: solid, topology };
}

export function csgUnion(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureUVs(a);
  ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  const result = csgEvaluator.evaluate(brushA, brushB, ADDITION);
  result.geometry.computeVertexNormals();
  return result.geometry;
}

export function csgIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureUVs(a);
  ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  const result = csgEvaluator.evaluate(brushA, brushB, INTERSECTION);
  result.geometry.computeVertexNormals();
  return result.geometry;
}

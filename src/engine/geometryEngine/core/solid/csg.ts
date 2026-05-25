/**
 * csg.ts — Boolean solid subtract (slicer use only).
 *
 * Engine: three-bvh-csg
 *   • `csgSubtract` is used by plateGeometryOps.ts for slicer hollow/plane-cut.
 *   • All production CAD solid operations use the OCC pipeline instead.
 *
 * NOTE: The WithTopology variants, csgUnion, and csgIntersect were removed
 * 2026-05-24 when the CAD pipeline was fully ported to OCC.
 */
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { MeshBVH } from 'three-mesh-bvh';

// ─── Shared three-bvh-csg evaluator ─────────────────────────────────────────

const _csgEvaluator = new Evaluator();
_csgEvaluator.useGroups = false;

function _ensureUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  const count = (geometry.attributes.position as THREE.BufferAttribute).count;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
}

function _ensureIndex(geometry: THREE.BufferGeometry): void {
  if (geometry.index) return;
  const count = (geometry.attributes.position as THREE.BufferAttribute).count;
  const array = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i += 1) array[i] = i;
  const attribute = count > 65535
    ? new THREE.Uint32BufferAttribute(array, 1)
    : new THREE.Uint16BufferAttribute(array, 1);
  geometry.setIndex(attribute);
}

function _prepareBrushGeometry(geometry: THREE.BufferGeometry): void {
  _ensureUVs(geometry);
  _ensureIndex(geometry);
  if (!geometry.boundsTree) {
    geometry.boundsTree = new MeshBVH(geometry, { maxLeafSize: 3, indirect: true });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Subtract geometry `b` from geometry `a`. Returns a new non-indexed geometry.
 * Used by plateGeometryOps.ts (slicer hollow / plane cut).
 */
export function csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  _prepareBrushGeometry(a);
  _prepareBrushGeometry(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
  } catch (err) {
    if (typeof brushA.geometry?.disposeBoundsTree === 'function') brushA.geometry.disposeBoundsTree();
    if (typeof brushB.geometry?.disposeBoundsTree === 'function') brushB.geometry.disposeBoundsTree();
    throw err;
  }
  const nonIndexed = result.geometry.index
    ? result.geometry.toNonIndexed()
    : result.geometry;
  try {
    nonIndexed.computeVertexNormals();
  } catch (err) {
    nonIndexed.dispose();
    if (nonIndexed !== result.geometry) result.geometry.dispose();
    throw err;
  }
  if (nonIndexed !== result.geometry) result.geometry.dispose();
  return nonIndexed;
}

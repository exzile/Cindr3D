/**
 * csg.ts — Boolean solid operations (subtract, union, intersect).
 *
 * Primary engine: manifold-3d (WebAssembly)
 *   • Guaranteed-manifold output — no post-processing soup repair needed.
 *   • 10–50× faster than JS BVH on complex meshes (parallel C++ BVH).
 *   • Correct results on non-convex solids and after chained operations.
 *   • Output is always a valid manifold — edges, normals, and topology
 *     extraction all work reliably on the result.
 *
 * Fallback engine: three-bvh-csg + weldAndCleanSolid
 *   • Used when Manifold WASM hasn't finished loading yet (startup race)
 *     or throws on pathological geometry (non-manifold source mesh from
 *     legacy files saved before Manifold was added).
 *   • Logs a console.warn so the fallback is visible during development.
 *   • three-bvh-csg can be removed once Manifold is proven stable on all
 *     input geometry in production.
 *
 * ALL callers (extrusionInternals, shellSolid, lipGroove,
 * pipe, snapFit, featureMeshActions, ExtrudePreview) use the same four
 * exports with identical signatures — no caller changes required.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { extractEdgeTopology, type BodyTopology } from './edgeTopology';
import { weldAndCleanSolid } from './weldClean';
import { getManifoldModule } from './manifoldWasm';

// ─── Shared three-bvh-csg evaluator (legacy / fallback path) ────────────────

const _csgEvaluator = new Evaluator();
_csgEvaluator.useGroups = false;

function _ensureUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.attributes.uv) return;
  const count = (geometry.attributes.position as THREE.BufferAttribute).count;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
}

// ─── Manifold conversion ─────────────────────────────────────────────────────

/**
 * Convert a THREE.BufferGeometry to a Manifold instance.
 *
 * Manifold requires indexed geometry (triVerts) with Float32 positions.
 * Returns null when:
 *   • Manifold WASM not loaded yet (startup race → caller falls back)
 *   • Geometry is empty / degenerate
 *   • Manifold rejects it as non-manifold (logs a warning)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toManifold(geo: THREE.BufferGeometry): any | null {
  const wasm = getManifoldModule();
  if (!wasm) return null;

  // Ensure indexed AND position-deduplicated.  Three.js's primitive geometries
  // (BoxGeometry, CylinderGeometry, etc.) ARE indexed but emit separate vertex
  // COPIES per face for UV/normal mapping — each box corner has 3 copies, same
  // position, different indices.  Manifold-rs treats those as topologically
  // disconnected (every edge looks like a 1-triangle edge) and throws
  // "NotManifold", forcing the BVH fallback whose CSG fan output produces the
  // "wing" visual.  ALWAYS run mergeVertices so position-duplicates collapse
  // to single indices and Manifold sees a true closed manifold.  Tolerance is
  // bbox-scaled (same convention as the rest of weldClean).
  const bbox = new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute);
  const diag = Math.max(bbox.min.distanceTo(bbox.max), 1);
  const weldTol = Math.max(diag * 1e-5, 1e-6);
  // mergeVertices welds by ALL attributes; drop normal/uv so it unifies on
  // position only (same pattern weldAndCleanSolid uses).
  const posOnly = new THREE.BufferGeometry();
  posOnly.setAttribute('position', geo.attributes.position as THREE.BufferAttribute);
  if (geo.index) posOnly.setIndex(geo.index);
  const indexed: THREE.BufferGeometry = mergeVertices(posOnly, weldTol);
  posOnly.dispose();
  const disposeIndexed = true;

  const posAttr = indexed.attributes.position as THREE.BufferAttribute | undefined;
  const idxAttr = indexed.index;
  if (!posAttr || !idxAttr || posAttr.count < 4 || idxAttr.count < 12) {
    if (disposeIndexed) indexed.dispose();
    return null; // degenerate (< 1 tetrahedron)
  }

  // Build flat Float32Array of xyz positions (numProp = 3)
  const vertProperties = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    vertProperties[i * 3]     = posAttr.getX(i);
    vertProperties[i * 3 + 1] = posAttr.getY(i);
    vertProperties[i * 3 + 2] = posAttr.getZ(i);
  }

  // Build Uint32 triangle index array
  const triVerts = new Uint32Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) {
    triVerts[i] = idxAttr.getX(i);
  }

  if (disposeIndexed) indexed.dispose();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mesh = new (wasm as any).Mesh({ numProp: 3, vertProperties, triVerts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (wasm as any).Manifold(mesh);
  } catch (err) {
    // Non-manifold input: Manifold throws 'NotManifold'. Fall back.
    console.warn('[csg] manifold×(non-manifold?) → fbk:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Convert a Manifold operation result back to a THREE.BufferGeometry.
 * Returns non-indexed geometry with per-face normals (same as legacy path).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _fromManifold(result: any): THREE.BufferGeometry | null {
  // An empty Manifold result (e.g. non-overlapping intersect or fully-enclosed subtract)
  // returns zero-triangle mesh data. Treat it as null so callers fall back to BVH.
  if (typeof result.isEmpty === 'function' && result.isEmpty()) {
    if (typeof result.delete === 'function') result.delete();
    return null;
  }
  const mesh = result.getMesh() as { vertProperties: Float32Array; triVerts: Uint32Array };
  const { vertProperties, triVerts } = mesh;
  if (!vertProperties?.length || !triVerts?.length) {
    if (typeof result.delete === 'function') result.delete();
    return null;
  }

  // Build indexed geometry from manifold's flat arrays
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertProperties), 3));
  indexed.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));

  // Convert to non-indexed → per-face normals at sharp edges
  // (consistent with legacy three-bvh-csg behaviour expected by all callers)
  const nonIndexed = indexed.toNonIndexed();
  nonIndexed.computeVertexNormals();
  indexed.dispose();

  // Free the Manifold result (C++ heap)
  if (typeof result.delete === 'function') result.delete();

  return nonIndexed;
}

// ─── Manifold boolean ops ────────────────────────────────────────────────────

/**
 * Attempt a Manifold subtract. Returns null on any failure so the caller can
 * fall back to three-bvh-csg.
 */
function _manifoldSubtract(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const ma = _toManifold(a);
  if (!ma) return null;
  const mb = _toManifold(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.subtract(mb);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] sub× → fbk:', err instanceof Error ? err.message : err);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return null;
  }
}

function _manifoldUnion(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const ma = _toManifold(a);
  if (!ma) return null;
  const mb = _toManifold(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.add(mb);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] union× → fbk:', err instanceof Error ? err.message : err);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return null;
  }
}

function _manifoldIntersect(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const ma = _toManifold(a);
  if (!ma) return null;
  const mb = _toManifold(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.intersect(mb);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] intersect× → fbk:', err instanceof Error ? err.message : err);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return null;
  }
}

// ─── three-bvh-csg fallback ops ─────────────────────────────────────────────

function _bvhSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
  } catch (err) {
    // evaluate() failed — release BVH structures the library may have built
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

function _bvhUnion(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);
  } catch (err) {
    if (typeof brushA.geometry?.disposeBoundsTree === 'function') brushA.geometry.disposeBoundsTree();
    if (typeof brushB.geometry?.disposeBoundsTree === 'function') brushB.geometry.disposeBoundsTree();
    throw err;
  }
  const nonIndexedUnion = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
  try {
    nonIndexedUnion.computeVertexNormals();
  } catch (err) {
    nonIndexedUnion.dispose();
    if (nonIndexedUnion !== result.geometry) result.geometry.dispose();
    throw err;
  }
  if (nonIndexedUnion !== result.geometry) result.geometry.dispose();
  return nonIndexedUnion;
}

function _bvhIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, INTERSECTION);
  } catch (err) {
    if (typeof brushA.geometry?.disposeBoundsTree === 'function') brushA.geometry.disposeBoundsTree();
    if (typeof brushB.geometry?.disposeBoundsTree === 'function') brushB.geometry.disposeBoundsTree();
    throw err;
  }
  const nonIndexedIntersect = result.geometry.index ? result.geometry.toNonIndexed() : result.geometry;
  try {
    nonIndexedIntersect.computeVertexNormals();
  } catch (err) {
    nonIndexedIntersect.dispose();
    throw err;
  }
  if (nonIndexedIntersect !== result.geometry) result.geometry.dispose();
  return nonIndexedIntersect;
}

// ─── Public API (identical signatures to before) ─────────────────────────────

/**
 * Subtract geometry `b` from geometry `a`. Returns a new non-indexed geometry.
 * Prefers Manifold; falls back to three-bvh-csg on failure.
 */
export function csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  return _manifoldSubtract(a, b) ?? _bvhSubtract(a, b);
}

/**
 * Union of geometries `a` and `b`. Returns a new geometry.
 * Prefers Manifold; falls back to three-bvh-csg on failure.
 */
export function csgUnion(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  return _manifoldUnion(a, b) ?? _bvhUnion(a, b);
}

/**
 * Intersection of geometries `a` and `b`. Returns a new geometry.
 * Prefers Manifold; falls back to three-bvh-csg on failure.
 */
export function csgIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  return _manifoldIntersect(a, b) ?? _bvhIntersect(a, b);
}

/**
 * Union `a` and `b` AND extract the result's edge topology.
 * Mirrors csgSubtractWithTopology exactly — same Manifold-first / BVH-fallback
 * structure, same weldAndCleanSolid repair on the fallback path.
 */
export function csgUnionWithTopology(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; topology: BodyTopology } {
  const manifoldResult = _manifoldUnion(a, b);
  if (manifoldResult) {
    let topology: BodyTopology;
    try {
      const forTopo = mergeVertices(manifoldResult, 1e-6);
      topology = extractEdgeTopology(forTopo);
      forTopo.dispose();
    } catch {
      topology = { edges: [] };
    }
    manifoldResult.userData.topology = topology;
    return { geometry: manifoldResult, topology };
  }

  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);
  } catch (err) {
    if (typeof brushA.geometry?.disposeBoundsTree === 'function') brushA.geometry.disposeBoundsTree();
    if (typeof brushB.geometry?.disposeBoundsTree === 'function') brushB.geometry.disposeBoundsTree();
    throw err;
  }

  let solid: THREE.BufferGeometry;
  try {
    solid = weldAndCleanSolid(result.geometry);
    result.geometry.dispose();
  } catch {
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

/**
 * Intersect `a` and `b` AND extract the result's edge topology.
 */
export function csgIntersectWithTopology(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; topology: BodyTopology } {
  const manifoldResult = _manifoldIntersect(a, b);
  if (manifoldResult) {
    let topology: BodyTopology;
    try {
      const forTopo = mergeVertices(manifoldResult, 1e-6);
      topology = extractEdgeTopology(forTopo);
      forTopo.dispose();
    } catch {
      topology = { edges: [] };
    }
    manifoldResult.userData.topology = topology;
    return { geometry: manifoldResult, topology };
  }

  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  let result: InstanceType<typeof Brush>;
  try {
    result = _csgEvaluator.evaluate(brushA, brushB, INTERSECTION);
  } catch (err) {
    if (typeof brushA.geometry?.disposeBoundsTree === 'function') brushA.geometry.disposeBoundsTree();
    if (typeof brushB.geometry?.disposeBoundsTree === 'function') brushB.geometry.disposeBoundsTree();
    throw err;
  }

  let solid: THREE.BufferGeometry;
  try {
    solid = weldAndCleanSolid(result.geometry);
    result.geometry.dispose();
  } catch {
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

/**
 * Subtract `b` from `a` AND extract the result's edge topology.
 *
 * When Manifold succeeds: the output is already a clean manifold — no
 * weldAndCleanSolid repair pass needed. Topology is extracted directly.
 *
 * When falling back to three-bvh-csg: runs weldAndCleanSolid first (the
 * soup repair pass) then extracts topology from the cleaned result.
 */
export function csgSubtractWithTopology(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): { geometry: THREE.BufferGeometry; topology: BodyTopology } {
  // ── Manifold path ────────────────────────────────────────────────────────
  const manifoldResult = _manifoldSubtract(a, b);
  if (manifoldResult) {
    // Manifold output is a clean manifold — extract topology directly on the
    // non-indexed result. mergeVertices re-indexes it for edgeTopology which
    // needs a connected mesh. The non-indexed form is returned for rendering.
    let topology: BodyTopology;
    try {
      // Re-index temporarily for topology extraction (needs adjacency info)
      const forTopo = mergeVertices(manifoldResult, 1e-6);
      topology = extractEdgeTopology(forTopo);
      forTopo.dispose();
    } catch {
      topology = { edges: [] };
    }
    manifoldResult.userData.topology = topology;
    return { geometry: manifoldResult, topology };
  }

  // ── three-bvh-csg fallback ───────────────────────────────────────────────
  _ensureUVs(a);
  _ensureUVs(b);
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

  // three-bvh-csg outputs non-manifold soup — repair before topology extraction
  let solid: THREE.BufferGeometry;
  try {
    solid = weldAndCleanSolid(result.geometry);
    result.geometry.dispose();
  } catch {
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

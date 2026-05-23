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
 * ALL callers (edgeCutCore, extrusionInternals, shellSolid, lipGroove,
 * pipe, snapFit, featureMeshActions, ExtrudePreview) use the same four
 * exports with identical signatures — no caller changes required.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { extractEdgeTopology, type BodyTopology } from './edgeTopology';
import { weldAndCleanSolid, repairNonManifoldVertices } from './weldClean';
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
 * Check signed volume of an indexed triangle mesh.  If negative (inverted
 * winding — inward-facing normals), swap indices 1↔2 in every triangle to
 * flip to outward-facing CCW winding.  Mutates `triVerts` in-place.
 *
 * Manifold accepts consistently-wound meshes with either orientation, but an
 * inward-wound mesh represents the *complement* of the intended solid.  CSG
 * subtract on a complement produces no visible change because the cutter sits
 * inside the original shape (the complement's "exterior").  This check catches
 * inverted meshes from THREE.js ExtrudeGeometry, BVH-CSG, and similar sources.
 */
function _fixWindingIfInverted(vertProperties: Float32Array, triVerts: Uint32Array): void {
  let signedVol6 = 0;
  const nTris = triVerts.length / 3;
  for (let ti = 0; ti < nTris; ti++) {
    const i0 = triVerts[ti * 3] * 3;
    const i1 = triVerts[ti * 3 + 1] * 3;
    const i2 = triVerts[ti * 3 + 2] * 3;
    const ax = vertProperties[i0], ay = vertProperties[i0 + 1], az = vertProperties[i0 + 2];
    const bx = vertProperties[i1], by = vertProperties[i1 + 1], bz = vertProperties[i1 + 2];
    const cx = vertProperties[i2], cy = vertProperties[i2 + 1], cz = vertProperties[i2 + 2];
    signedVol6 += ax * (by * cz - bz * cy)
                + ay * (bz * cx - bx * cz)
                + az * (bx * cy - by * cx);
  }
  if (signedVol6 < 0) {
    for (let ti = 0; ti < nTris; ti++) {
      const tmp = triVerts[ti * 3 + 1];
      triVerts[ti * 3 + 1] = triVerts[ti * 3 + 2];
      triVerts[ti * 3 + 2] = tmp;
    }
    console.warn(`[csg] _fixWindingIfInverted: flipped winding (signedVol6=${signedVol6.toFixed(2)})`);
  }
}

/**
 * Convert a THREE.BufferGeometry to a Manifold instance.
 *
 * Manifold requires indexed geometry (triVerts) with Float32 positions.
 * Returns null when:
 *   • Manifold WASM not loaded yet (startup race → caller falls back)
 *   • Geometry is empty / degenerate
 *   • Manifold rejects it as non-manifold (logs a warning)
 */
/**
 * Build a Manifold-compatible { vertProperties, triVerts } from a BufferGeometry.
 * Always expands to non-indexed triangle soup first (toNonIndexed if indexed),
 * strips non-position attributes, then welds by position (mergeVertices).
 *
 * THREE.js indexed primitives (BoxGeometry, CylinderGeometry, SphereGeometry)
 * duplicate vertices at face boundaries so each face-edge is an open boundary
 * for Manifold. toNonIndexed() + strip-attrs + mergeVertices fuses those
 * duplicates correctly regardless of whether the input is indexed or not.
 *
 * Returns null if WASM not loaded, geometry is degenerate, or Manifold rejects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toManifold(geo: THREE.BufferGeometry): any | null {
  const wasm = getManifoldModule();
  if (!wasm) return null;

  // Fast path: geometry came from _fromManifold and carries the exact
  // Manifold-format vertex/index data stored before the WASM heap was freed.
  // Reimport it directly, skipping mergeVertices.  mergeVertices on non-indexed
  // triangle-soup can corrupt topology at corners where two cutter volumes share
  // a single point: it merges those co-positional vertices into a figure-8 that
  // Manifold rejects as non-manifold, forcing a BVH fallback that creates the
  // spike artefact.  Using the cached data guarantees a clean round-trip because
  // Manifold's own output is always valid input for Manifold.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const md = (geo.userData as any)?._manifoldData as
    | { vertProperties: Float32Array; triVerts: Uint32Array }
    | undefined;
  if (md) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = new (wasm as any).Mesh({ numProp: 3, vertProperties: md.vertProperties, triVerts: md.triVerts });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mf = new (wasm as any).Manifold(m);
      return mf;
    } catch (err) {
      console.warn('[csg] _manifoldData fast-path reimport failed, falling through:', err);
      // fall through to the normal path below
    }
  }

  // Expand to triangle soup (3 verts per tri, no shared indices),
  // then strip non-position attributes, then weld by position.
  let soup: THREE.BufferGeometry;
  let ownSoup = false;
  if (geo.index) {
    soup = geo.toNonIndexed();
    ownSoup = true;
  } else {
    soup = geo;
  }

  const posOnly = new THREE.BufferGeometry();
  posOnly.setAttribute('position', soup.attributes.position as THREE.BufferAttribute);
  if (ownSoup) { soup.dispose(); }

  const bb = new THREE.Box3().setFromBufferAttribute(posOnly.attributes.position as THREE.BufferAttribute);
  const diag = Math.max(bb.min.distanceTo(bb.max), 1);
  const indexed = mergeVertices(posOnly, Math.max(diag * 1e-5, 1e-6));
  posOnly.dispose();

  const posAttr = indexed.attributes.position as THREE.BufferAttribute | undefined;
  const idxAttr = indexed.index;
  if (!posAttr || !idxAttr || posAttr.count < 4 || idxAttr.count < 12) {
    indexed.dispose();
    return null;
  }

  const vertProperties = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    vertProperties[i * 3]     = posAttr.getX(i);
    vertProperties[i * 3 + 1] = posAttr.getY(i);
    vertProperties[i * 3 + 2] = posAttr.getZ(i);
  }
  const triVerts = new Uint32Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) triVerts[i] = idxAttr.getX(i);

  indexed.dispose();

  // Fix inverted winding before building Manifold (see _fixWindingIfInverted).
  _fixWindingIfInverted(vertProperties, triVerts);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mesh = new (wasm as any).Mesh({ numProp: 3, vertProperties, triVerts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mf = new (wasm as any).Manifold(mesh);
    return mf;
  } catch (err) {
    console.warn(
      `[csg] Manifold rejected input: verts=${posAttr.count} tris=${idxAttr.count / 3} err="${err}"`,
    );
    return null;
  }
}

/**
 * Convert an already-indexed geometry to Manifold WITHOUT calling mergeVertices.
 * Used after repairNonManifoldVertices: the repair splits figure-8 vertices by
 * assigning the same position to two different indices; calling mergeVertices
 * would re-merge them, undoing the fix. This function skips merging and passes
 * the indexed geometry directly to Manifold.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toManifoldFromSplit(indexed: THREE.BufferGeometry): any | null {
  const wasm = getManifoldModule();
  if (!wasm || !indexed.index) return null;

  const posAttr = indexed.attributes.position as THREE.BufferAttribute | undefined;
  const idxAttr = indexed.index;
  if (!posAttr || posAttr.count < 4 || idxAttr.count < 12) return null;

  const vertProperties = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    vertProperties[i * 3]     = posAttr.getX(i);
    vertProperties[i * 3 + 1] = posAttr.getY(i);
    vertProperties[i * 3 + 2] = posAttr.getZ(i);
  }
  const triVerts = new Uint32Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) triVerts[i] = idxAttr.getX(i);

  // Signed-volume winding fix (same as _toManifold slow path — see comment there).
  _fixWindingIfInverted(vertProperties, triVerts);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mesh = new (wasm as any).Mesh({ numProp: 3, vertProperties, triVerts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (wasm as any).Manifold(mesh);
  } catch (err) {
    console.warn(
      `[csg] Manifold rejected split-repaired input: verts=${posAttr.count} tris=${idxAttr.count / 3} err="${err}"`,
    );
    return null;
  }
}

/**
 * Convert a Manifold operation result back to a THREE.BufferGeometry.
 * Returns non-indexed geometry with per-face normals (same as legacy path).
 *
 * The raw Manifold vertex/index data is cached in userData._manifoldData so
 * that when this geometry is later passed back to _toManifold (e.g. when
 * chaining csgUnion calls), it can be reimported directly without going through
 * mergeVertices.  mergeVertices causes precision-induced topology corruption on
 * union results whose vertices touch at a corner — exactly the geometry produced
 * by combining two edge-fillet cutters — which prevents re-import into Manifold
 * and forces a BVH fallback that produces the spike artefact.  Caching and
 * replaying the exact Manifold-format data keeps the chain in Manifold space.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _fromManifold(result: any): THREE.BufferGeometry {
  const mesh = result.getMesh() as { vertProperties: Float32Array; triVerts: Uint32Array };

  // Copy WASM heap data before result.delete() frees it.
  const vpCopy = new Float32Array(mesh.vertProperties);
  const tvCopy = new Uint32Array(mesh.triVerts);

  // Build indexed geometry from manifold's flat arrays
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vpCopy), 3));
  indexed.setIndex(new THREE.BufferAttribute(new Uint32Array(tvCopy), 1));

  // Convert to non-indexed → per-face normals at sharp edges
  // (consistent with legacy three-bvh-csg behaviour expected by all callers)
  const nonIndexed = indexed.toNonIndexed();
  nonIndexed.computeVertexNormals();
  indexed.dispose();

  // Cache the raw Manifold mesh data so _toManifold can do a direct round-trip
  // without mergeVertices (see _toManifold fast-path for details).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (nonIndexed.userData as any)._manifoldData = { vertProperties: vpCopy, triVerts: tvCopy };

  // Free the Manifold result (C++ heap)
  if (typeof result.delete === 'function') result.delete();

  return nonIndexed;
}

/**
 * Like _toManifold but applies progressive repair passes on failure:
 *
 * 1. Direct convert (fast path).
 * 2. Split non-manifold vertices (repairNonManifoldVertices): fixes the figure-8
 *    topology produced by EarCut hole bridging in THREE.js ExtrudeGeometry. The
 *    bridge vertex appears with two disconnected triangle fans at the same index;
 *    splitting it into two vertices at the same position restores a valid manifold.
 *    This is the primary repair needed for solid bodies with holes.
 * 3. Full weld + retriangulate (weldAndCleanSolid): handles any remaining
 *    non-manifold seams left by three-bvh-csg on previous CSG results.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _toManifoldWithRepair(geo: THREE.BufferGeometry): any | null {
  // Pass 1: direct
  let m = _toManifold(geo);
  if (m) return m;

  // Pass 2: split non-manifold vertices, then direct-to-Manifold (no re-merge).
  // _toManifoldFromSplit skips mergeVertices so the splits aren't undone.
  let split: THREE.BufferGeometry | null = null;
  try {
    split = repairNonManifoldVertices(geo);
    m = _toManifoldFromSplit(split);
    if (m) return m;
  } catch { /* non-fatal */ } finally {
    split?.dispose();
    split = null;
  }

  // Pass 3: full weld + retriangulate, then try split again on the result
  let repaired: THREE.BufferGeometry | null = null;
  try {
    repaired = weldAndCleanSolid(geo, false);
    m = _toManifold(repaired);
    if (m) return m;
    let repairedSplit: THREE.BufferGeometry | null = null;
    try {
      repairedSplit = repairNonManifoldVertices(repaired);
      m = _toManifoldFromSplit(repairedSplit);
      if (m) return m;
    } catch { /* non-fatal */ } finally {
      repairedSplit?.dispose();
    }
  } catch { /* non-fatal */ } finally {
    repaired?.dispose();
  }
  return null;
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
  const ma = _toManifoldWithRepair(a);
  if (!ma) { console.warn('[csg] _manifoldSubtract: solid→Manifold failed'); return null; }
  const mb = _toManifoldWithRepair(b);
  if (!mb) { console.warn('[csg] _manifoldSubtract: cutter→Manifold failed'); if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const maVerts = typeof ma.numVert === 'function' ? ma.numVert() : -1;
    const maTris  = typeof ma.numTri  === 'function' ? ma.numTri()  : -1;

    const result = ma.subtract(mb);
    const mrVerts = typeof result.numVert === 'function' ? result.numVert() : -1;
    const mrTris  = typeof result.numTri  === 'function' ? result.numTri()  : -1;

    // If Manifold produced zero geometric change (result ≡ solid), the body's
    // Manifold representation is degenerate (mergeVertices figure-8 topology at
    // a boss/bracket junction).  Fall to BVH; the fillet pipeline runs
    // removeSpikeComponents after weldAndCleanSolid to clean up the BVH output.
    if (mrVerts === maVerts && mrTris === maTris && maVerts > 0) {
      if (typeof result.delete === 'function') result.delete();
      if (typeof ma.delete === 'function') ma.delete();
      if (typeof mb.delete === 'function') mb.delete();
      return null;
    }

    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] Manifold subtract failed, using fallback:', err);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return null;
  }
}

function _manifoldUnion(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const ma = _toManifoldWithRepair(a);
  if (!ma) return null;
  const mb = _toManifoldWithRepair(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.add(mb);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] Manifold union failed, using fallback:', err);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return null;
  }
}

function _manifoldIntersect(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry | null {
  const ma = _toManifoldWithRepair(a);
  if (!ma) return null;
  const mb = _toManifoldWithRepair(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.intersect(mb);
    if (typeof ma.delete === 'function') ma.delete();
    if (typeof mb.delete === 'function') mb.delete();
    return _fromManifold(result);
  } catch (err) {
    console.warn('[csg] Manifold intersect failed, using fallback:', err);
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
  const result = _csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);
  const nonIndexed = result.geometry.index
    ? result.geometry.toNonIndexed()
    : result.geometry;
  nonIndexed.computeVertexNormals();
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
  const result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);
  result.geometry.computeVertexNormals();
  return result.geometry;
}

function _bvhIntersect(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  _ensureUVs(a);
  _ensureUVs(b);
  const brushA = new Brush(a);
  const brushB = new Brush(b);
  brushA.updateMatrixWorld();
  brushB.updateMatrixWorld();
  const result = _csgEvaluator.evaluate(brushA, brushB, INTERSECTION);
  result.geometry.computeVertexNormals();
  return result.geometry;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Specification for a rolling-ball corner blend at a trihedral vertex.
 * Passed to `csgSubtractMany` so the blend is applied directly in Manifold
 * space using native sphere/cube primitives — no Three.js mesh roundtrip.
 *
 * The cutter is `cornerBox − sphere`:
 *   cornerBox  = axis-aligned box from `boxMin` to `boxMax` covering the
 *                prism-intersection region at the corner vertex.
 *   sphere     = rolling-ball sphere of `sphereRadius` centred at `sphereCenter`.
 *
 * Subtracting this cutter from the solid (after the three edge cuts) removes
 * the Steinmetz spike and leaves the spherical rolling-ball patch.
 */
export interface CornerBlendSpec {
  /** World-space centre of the rolling-ball sphere. */
  sphereCenter: [number, number, number];
  /**
   * Sphere radius.  Use fillet_radius × 1.1 — exact radius r makes the sphere
   * tangent to all three face planes at single points, which Manifold rejects
   * as degenerate cusps.  1.1r gives definite intersection circles (radius
   * ≈ 0.46r) on each face while still removing the spike tip (at ≈ 1.225r).
   */
  sphereRadius: number;
  /** Min corner of the AABB that covers the prism-intersection region. */
  boxMin: [number, number, number];
  /** Max corner of the AABB. */
  boxMax: [number, number, number];
}

/**
 * Subtract geometry `b` from geometry `a`. Returns a new non-indexed geometry.
 * Prefers Manifold; falls back to three-bvh-csg on failure.
 */
export function csgSubtract(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  return _manifoldSubtract(a, b) ?? _bvhSubtract(a, b);
}

/**
 * Per-edge fillet cutter built ENTIRELY in Manifold-native space.
 *
 * Background — why this exists:
 *   The Three.js path (`new THREE.BoxGeometry(...) − new THREE.CylinderGeometry(...)`
 *   via `csgSubtract`) produces a cutter mesh that Manifold subsequently rejects
 *   as non-manifold when it tries to apply the cutter to the body.  That forces
 *   the body subtract onto the BVH fallback, whose sliver-triangle output is
 *   visible as the fillet "spike" artefact at corner regions.
 *
 *   Building the cutter directly from `Manifold.cube` − `Manifold.cylinder`
 *   keeps every triangle vertex in Manifold's exact-arithmetic grid; the
 *   returned BufferGeometry carries `_manifoldData` so the next CSG call
 *   re-imports it as a guaranteed-valid manifold via the fast path, and the
 *   whole fillet stays in the exact CSG kernel — no spikes.
 *
 * Geometry — the cutter is the same shape as the legacy Three.js path:
 *   - Prism: axis-aligned box of size (setback, length+2eps, setback) in the
 *     edge-local frame (axisX, edgeDir, axisZ) with one corner at edge start `a`.
 *   - Cylinder: radius `radius`, length `length+2eps`, axis passing through
 *     `a + bis·axisDist` and `a + length·edgeDir + bis·axisDist`.
 *   - Cutter = prism − cylinder.
 *
 * Returns null when Manifold WASM is not yet available (caller falls back).
 */
export function buildFilletCutterManifold(
  a: THREE.Vector3,
  edgeDir: THREE.Vector3,
  length: number,
  axisX: THREE.Vector3,
  axisZ: THREE.Vector3,
  bis: THREE.Vector3,
  setback: number,
  axisDist: number,
  radius: number,
  eps: number,
  radialSeg: number,
): THREE.BufferGeometry | null {
  const wasm = getManifoldModule();
  if (!wasm) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ManifoldCtor = (wasm as any).Manifold;
  if (!ManifoldCtor) return null;

  const totalLen = length + 2 * eps;

  // ── Cylinder axis midpoint (world space) ───────────────────────────────────
  const axisMid = a.clone()
    .addScaledVector(bis, axisDist)
    .addScaledVector(edgeDir, length / 2);

  // ── Prism: parallelipiped built from world-space vertices ──────────────────
  // axisX and axisZ are the in-face perpendiculars u1/u2.  When the dihedral
  // angle φ ≠ 90° these vectors are NOT orthogonal (dot = cos φ).  The old
  // approach decomposed a non-orthogonal basis into Euler angles via
  // setFromRotationMatrix, but Euler angles can only represent orthonormal
  // rotations — the decomposition silently produced wrong angles, causing the
  // prism to be misaligned and barely intersect the body.
  //
  // Fix: compute the 8 parallelipiped vertices directly in world space and
  // build the Manifold mesh from raw vertices + triangle indices.  This works
  // for any dihedral angle.
  const eBack = edgeDir.clone().multiplyScalar(-eps);
  const eFwd  = edgeDir.clone().multiplyScalar(length + eps);

  // Extend the prism slightly PAST the body surface in the −axisX and −axisZ
  // directions.  Without this, the prism's boundary faces at axisX=0 and
  // axisZ=0 are exactly coplanar with the body's adjacent faces (e.g. the
  // front face at z=41 and top face at y=19.25).  Manifold CSG produces a
  // degenerate zero-thickness intersection at coplanar boundaries, so the
  // subtraction removes almost no material.  The extra `pad` extends the
  // prism past the body surface; the overshoot is outside the body and gets
  // ignored by the final body−cutter subtract.
  const pad = Math.max(setback * 0.02, 1e-3);
  const sx  = axisX.clone().multiplyScalar(setback + pad);
  const sz  = axisZ.clone().multiplyScalar(setback + pad);
  const originShift = new THREE.Vector3()
    .addScaledVector(axisX, -pad)
    .addScaledVector(axisZ, -pad);

  // 8 vertices: 4 at edge-start (−eps), 4 at edge-end (+eps).
  //   v0 = corner slightly past the body surface (shifted by −pad in both
  //        face directions so the prism extends past the edge)
  //   v3/v7 = opposite corner (full setback + pad in both face directions)
  const v0 = a.clone().add(eBack).add(originShift);
  const v1 = v0.clone().add(sx);
  const v2 = v0.clone().add(sz);
  const v3 = v0.clone().add(sx).add(sz);
  const v4 = a.clone().add(eFwd).add(originShift);
  const v5 = v4.clone().add(sx);
  const v6 = v4.clone().add(sz);
  const v7 = v4.clone().add(sx).add(sz);

  const vertProperties = new Float32Array([
    v0.x, v0.y, v0.z,  // 0
    v1.x, v1.y, v1.z,  // 1
    v2.x, v2.y, v2.z,  // 2
    v3.x, v3.y, v3.z,  // 3
    v4.x, v4.y, v4.z,  // 4
    v5.x, v5.y, v5.z,  // 5
    v6.x, v6.y, v6.z,  // 6
    v7.x, v7.y, v7.z,  // 7
  ]);

  // 12 triangles (6 quad faces).  Winding is CCW when viewed from outside,
  // producing outward-pointing normals.  The (axisX, edgeDir, axisZ) basis
  // is always right-handed (buildFilletCutter swaps for left-handed cases).
  const triVerts = new Uint32Array([
    0, 1, 3,  0, 3, 2,   // back  (−edgeDir end)
    4, 6, 7,  4, 7, 5,   // front (+edgeDir end)
    0, 4, 5,  0, 5, 1,   // bottom (axisZ = 0 face)
    2, 3, 7,  2, 7, 6,   // top    (axisZ = setback face)
    0, 2, 6,  0, 6, 4,   // left   (axisX = 0 face)
    1, 5, 7,  1, 7, 3,   // right  (axisX = setback face)
  ]);

  // Cylinder rotation: rotate local Z onto edgeDir.  Use a quaternion to derive
  // a clean rotation matrix, then convert to Euler 'XYZ' degrees for Manifold.
  // (This decomposition is valid because setFromUnitVectors produces a genuine
  // orthonormal rotation — unlike the old prism path.)
  const RAD2DEG = 180 / Math.PI;
  const zAxis = new THREE.Vector3(0, 0, 1);
  const edgeDirN = edgeDir.clone().normalize();
  const cylQuat = new THREE.Quaternion().setFromUnitVectors(zAxis, edgeDirN);
  const cylRotMat = new THREE.Matrix4().makeRotationFromQuaternion(cylQuat);
  const cylEuler = new THREE.Euler().setFromRotationMatrix(cylRotMat, 'XYZ');
  const cylDeg: [number, number, number] = [
    cylEuler.x * RAD2DEG,
    cylEuler.y * RAD2DEG,
    cylEuler.z * RAD2DEG,
  ];

  const segs = Math.max(8, Math.min(96, radialSeg));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cylM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cutterM: any = null;
  try {
    // Prism: build from raw mesh data (handles non-orthogonal axisX/axisZ).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismMesh = new (wasm as any).Mesh({ numProp: 3, vertProperties, triVerts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismM = new (wasm as any).Manifold(prismMesh);
    // Snapshot prism counts BEFORE the subtract so we can detect a no-change
    // result (cylinder didn't intersect the prism — degenerate raw-mesh Manifold).
    const prismVerts = typeof prismM.numVert === 'function' ? prismM.numVert() : -1;
    const prismTris  = typeof prismM.numTri  === 'function' ? prismM.numTri()  : -1;

    // Cylinder: along local Z from 0 to totalLen.  Centre on its own Z (subtract
    // totalLen/2), rotate so local Z lands on edgeDir, then translate to axisMid.
    cylM = ManifoldCtor.cylinder(totalLen, radius, radius, segs)
      .translate([0, 0, -totalLen / 2])
      .rotate(cylDeg)
      .translate([axisMid.x, axisMid.y, axisMid.z]);

    cutterM = prismM.subtract(cylM);

    const cutterVerts = typeof cutterM.numVert === 'function' ? cutterM.numVert() : -1;
    const cutterTris  = typeof cutterM.numTri  === 'function' ? cutterM.numTri()  : -1;

    if (typeof prismM.delete === 'function') prismM.delete();
    if (typeof cylM.delete === 'function') cylM.delete();
    prismM = null;
    cylM = null;

    // Zero-change guard: if prism.subtract(cyl) returned the unchanged prism,
    // the cylinder didn't intersect (raw-mesh Manifold degenerate for this
    // corner region).  Return null so the caller falls through to the Three.js
    // BoxGeometry + CylinderGeometry path, which builds the cutter with clean
    // THREE.js primitives whose Manifold import always succeeds.
    if (prismVerts > 0 && cutterVerts === prismVerts && cutterTris === prismTris) {
      console.warn(
        `[csg] buildFilletCutterManifold: prism.subtract(cyl) no change ` +
        `(v=${prismVerts} t=${prismTris}) — cylinder did not intersect prism, ` +
        `falling through to Three.js path`,
      );
      if (typeof cutterM.delete === 'function') cutterM.delete();
      return null;
    }

    const result = _fromManifold(cutterM); // also deletes cutterM
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (result.userData as any)._manifoldData;
    const vCount = md?.vertProperties?.length ? md.vertProperties.length / 3 : 0;
    if (vCount === 0) {
      console.warn(`[csg] buildFilletCutterManifold produced EMPTY cutter — cylDeg=[${cylDeg.map(d => d.toFixed(1))}] setback=${setback.toFixed(3)} r=${radius.toFixed(3)} axisDist=${axisDist.toFixed(3)}`);
      result.dispose();
      return null; // let caller fall through to Three.js path
    }
    return result;
  } catch (err) {
    console.warn('[csg] Manifold-native fillet cutter build failed:', err);
    try { if (prismM && typeof prismM.delete === 'function') prismM.delete(); } catch {}
    try { if (cylM && typeof cylM.delete === 'function') cylM.delete(); } catch {}
    try { if (cutterM && typeof cutterM.delete === 'function') cutterM.delete(); } catch {}
    return null;
  }
}

/**
 * Build the loop-cutter for a circular-rim fillet entirely in Manifold space.
 *
 * The cutter geometry is: annular ring − torus
 *   ring  = outer cylinder (radius=ringOuterR, height=ringLen) minus
 *           inner cylinder (radius=innerR, height=ringLen+4*pad)
 *           both centred at `ringCenter`, axis = `bodyAxial`
 *   torus = Manifold.revolve of a circle (majorR, minorR) around axis `A`,
 *           centred at `torusCenter`
 *   cutter = ring − torus
 *
 * Building natively in Manifold avoids the T-junction artefacts that
 * `csgSubtractRaw(outerCyl, innerCyl)` (Three.js BVH path) produces, which
 * prevent the loop-cutter from being re-imported into Manifold and force the
 * entire fillet onto the BVH path — the root cause of the Steinmetz spike at
 * the junction between the circular-rim fillet and adjacent straight edges.
 *
 * Returns null when Manifold WASM is not yet loaded or the build fails so
 * the caller can fall back to the Three.js BVH path.
 */
export function buildFilletLoopCutterManifold(
  majorR: number,
  minorR: number,
  ringOuterR: number,
  innerR: number,
  ringLen: number,
  pad: number,
  ringCenter: THREE.Vector3,
  torusCenter: THREE.Vector3,
  bodyAxial: THREE.Vector3,
  A: THREE.Vector3,
  tubSeg: number,
  radSeg: number,
): THREE.BufferGeometry | null {
  const wasm = getManifoldModule();
  if (!wasm) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ManifoldCtor = (wasm as any).Manifold;
  if (!ManifoldCtor) return null;

  const RAD2DEG = 180 / Math.PI;
  const zAxis = new THREE.Vector3(0, 0, 1);

  /** Euler XYZ degrees that rotate local +Z onto `target`. */
  const zToEulerDeg = (target: THREE.Vector3): [number, number, number] => {
    const t = target.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(zAxis, t);
    const mat = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const euler = new THREE.Euler().setFromRotationMatrix(mat, 'XYZ');
    return [euler.x * RAD2DEG, euler.y * RAD2DEG, euler.z * RAD2DEG];
  };

  const cylDeg = zToEulerDeg(bodyAxial); // ring cylinders: local Z → bodyAxial
  const torDeg = zToEulerDeg(A);         // torus revolution axis: local Z → A

  // Torus cross-section polygon: a circle of radius `minorR` centred at
  // (majorR, 0) in the Manifold revolve cross-section plane.
  // Manifold.revolve revolves around Y, then aliases Y → Z in the result, so:
  //   cross-section X = radial distance from the revolution axis (≥ 0)
  //   cross-section Y = axial position along the revolution axis
  // `majorR > minorR` is validated by the caller so all X values are > 0.
  const crossSeg = Math.max(8, radSeg);
  const circlePts: [number, number][] = [];
  for (let i = 0; i < crossSeg; i++) {
    const t = (i / crossSeg) * 2 * Math.PI;
    circlePts.push([majorR + minorR * Math.cos(t), minorR * Math.sin(t)]);
  }

  const segs = Math.max(8, tubSeg);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outerCylM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let innerCylM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ringM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let torusM: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cutterM: any = null;

  try {
    // Ring: outer minus inner.  Manifold.cylinder spans z=[0, height]; shift by
    // -height/2 to centre at origin before rotating and positioning.
    outerCylM = ManifoldCtor.cylinder(ringLen, ringOuterR, ringOuterR, segs)
      .translate([0, 0, -ringLen / 2])
      .rotate(cylDeg)
      .translate([ringCenter.x, ringCenter.y, ringCenter.z]);

    const innerLen = ringLen + 4 * pad;
    innerCylM = ManifoldCtor.cylinder(innerLen, innerR, innerR, segs)
      .translate([0, 0, -innerLen / 2])
      .rotate(cylDeg)
      .translate([ringCenter.x, ringCenter.y, ringCenter.z]);

    ringM = outerCylM.subtract(innerCylM);
    if (typeof outerCylM.delete === 'function') outerCylM.delete();
    if (typeof innerCylM.delete === 'function') innerCylM.delete();
    outerCylM = null;
    innerCylM = null;

    // Torus: revolve the circle cross-section (Manifold revolves around Y →
    // result Z = revolution axis), then rotate Z → A and translate to centre.
    torusM = ManifoldCtor.revolve([circlePts], segs)
      .rotate(torDeg)
      .translate([torusCenter.x, torusCenter.y, torusCenter.z]);

    cutterM = ringM.subtract(torusM);
    if (typeof ringM.delete === 'function') ringM.delete();
    if (typeof torusM.delete === 'function') torusM.delete();
    ringM = null;
    torusM = null;

    const result = _fromManifold(cutterM); // also deletes cutterM
    cutterM = null;

    // Validate non-empty result before returning.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (result.userData as any)._manifoldData;
    if (!md?.vertProperties?.length) {
      result.dispose();
      return null;
    }
    return result;
  } catch (err) {
    console.warn('[csg] buildFilletLoopCutterManifold failed:', err);
    try { if (outerCylM && typeof outerCylM.delete === 'function') outerCylM.delete(); } catch { /* no-op */ }
    try { if (innerCylM && typeof innerCylM.delete === 'function') innerCylM.delete(); } catch { /* no-op */ }
    try { if (ringM && typeof ringM.delete === 'function') ringM.delete(); } catch { /* no-op */ }
    try { if (torusM && typeof torusM.delete === 'function') torusM.delete(); } catch { /* no-op */ }
    try { if (cutterM && typeof cutterM.delete === 'function') cutterM.delete(); } catch { /* no-op */ }
    return null;
  }
}

/**
 * Subtract multiple cutters from a solid, keeping all operations in Manifold
 * space when possible to avoid the spike artifact at 3+-edge corners.
 *
 * Path A — solid IS Manifold-convertible: convert solid once, then subtract
 *   each cutter one-by-one in Manifold space. Manifold→Manifold chaining
 *   eliminates the spike artifact entirely because every intermediate result
 *   is a valid manifold. Cutters that fail Manifold conversion fall back to
 *   sequential BVH subtracts on the accumulated result.
 *
 * Path B — solid is NOT Manifold-convertible: union all Manifold-convertible
 *   cutters in Manifold space (guaranteed clean union), then ONE BVH subtract.
 *   Non-Manifold cutters applied sequentially via BVH.
 *
 * `cornerBlends` (optional) — rolling-ball corner specs applied directly in
 *   Manifold space using native cube/sphere primitives after all edge cutters.
 *   This avoids the Three.js↔Manifold roundtrip that makes the pre-built
 *   geometry approach fragile.
 *
 * Neither `solid` nor `cutters` are consumed — caller disposes all inputs.
 */
export function csgSubtractMany(
  solid: THREE.BufferGeometry,
  cutters: THREE.BufferGeometry[],
  cornerBlends?: CornerBlendSpec[],
): THREE.BufferGeometry {
  const hasCorners = (cornerBlends?.length ?? 0) > 0;
  if (cutters.length === 0 && !hasCorners) return solid.clone();
  if (cutters.length === 1 && !hasCorners) return csgSubtract(solid, cutters[0]);

  // ── Path A: solid → Manifold, chain-subtract each cutter in Manifold space ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accM: any = _toManifoldWithRepair(solid);
  if (accM) {
    const solidVerts = typeof accM.numVert === 'function' ? accM.numVert() : -1;
    const solidTris  = typeof accM.numTri  === 'function' ? accM.numTri()  : -1;
    const bvhCutters: THREE.BufferGeometry[] = [];
    for (const cutter of cutters) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mc: any = _toManifoldWithRepair(cutter);
      if (!mc) { bvhCutters.push(cutter); continue; }
      try {
        const next = accM.subtract(mc);
        const nextVerts = typeof next.numVert === 'function' ? next.numVert() : -1;
        const nextTris  = typeof next.numTri  === 'function' ? next.numTri()  : -1;
        if (nextVerts === solidVerts && nextTris === solidTris && solidVerts > 0) {
          // Manifold produced no change — body Manifold is degenerate in this
          // region (mergeVertices figure-8 issue).  Use BVH for this cutter.
          console.warn('[csg] Manifold batch subtract produced no change — routing to BVH');
          if (typeof next.delete === 'function') next.delete();
          if (typeof mc.delete === 'function') mc.delete();
          bvhCutters.push(cutter);
          continue;
        }
        if (typeof accM.delete === 'function') accM.delete();
        if (typeof mc.delete === 'function') mc.delete();
        accM = next;
      } catch (err) {
        console.warn('[csg] Manifold batch subtract step failed:', err);
        if (typeof mc.delete === 'function') mc.delete();
        bvhCutters.push(cutter);
      }
    }

    // ── Apply corner blends in Manifold space only when ALL edge cuts ran in ──
    // Manifold (bvhCutters empty).  If any edge cut fell to BVH the blend is
    // deferred to after the BVH loop below so it always runs AFTER the edges
    // are fully cut — applying it to the pre-cut solid would leave the spike.
    if (hasCorners && bvhCutters.length === 0) {
      const wasm = getManifoldModule();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ManifoldCtor = wasm ? (wasm as any).Manifold : null;
      if (ManifoldCtor) {
        for (const blend of cornerBlends!) {
          const [bminx, bminy, bminz] = blend.boxMin;
          const [bmaxx, bmaxy, bmaxz] = blend.boxMax;
          const bsz: [number, number, number] = [bmaxx - bminx, bmaxy - bminy, bmaxz - bminz];
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const boxM: any  = ManifoldCtor.cube(bsz).translate([bminx, bminy, bminz]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sphM: any  = ManifoldCtor.sphere(blend.sphereRadius, 64)
              .translate(blend.sphereCenter);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cutM: any  = boxM.subtract(sphM);
            if (typeof boxM.delete === 'function') boxM.delete();
            if (typeof sphM.delete === 'function') sphM.delete();
            const next = accM.subtract(cutM);
            if (typeof accM.delete === 'function') accM.delete();
            if (typeof cutM.delete === 'function') cutM.delete();
            accM = next;
          } catch (err) {
            console.warn('[csg] corner blend subtract failed:', err);
          }
        }
      } else {
        console.warn('[csg] Manifold not available for corner blends — skipping');
      }
    }

    let result = _fromManifold(accM); // also calls accM.delete()
    for (const c of bvhCutters) {
      const next = _bvhSubtract(result, c);
      result.dispose();
      result = next;
    }

    // ── Corner blends deferred: run AFTER BVH edge cuts when any cutter ──────
    // fell back to BVH.  Built as Three.js box-minus-sphere geometry and
    // subtracted via BVH (or Manifold if the geometry converts cleanly).
    if (hasCorners && bvhCutters.length > 0) {
      for (const blend of cornerBlends!) {
        const [bminx, bminy, bminz] = blend.boxMin;
        const [bmaxx, bmaxy, bmaxz] = blend.boxMax;
        const bsz = new THREE.Vector3(bmaxx - bminx, bmaxy - bminy, bmaxz - bminz);
        const bctr = new THREE.Vector3(
          (bminx + bmaxx) / 2, (bminy + bmaxy) / 2, (bminz + bmaxz) / 2,
        );
        const cbox = new THREE.BoxGeometry(bsz.x, bsz.y, bsz.z);
        cbox.translate(bctr.x, bctr.y, bctr.z);
        const csph = new THREE.SphereGeometry(blend.sphereRadius, 32, 24);
        csph.translate(...blend.sphereCenter);
        const blendCutter = _manifoldSubtract(cbox, csph) ?? _bvhSubtract(cbox, csph);
        cbox.dispose(); csph.dispose();
        const cnt = (blendCutter.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
        if (cnt > 0) {
          const next = _bvhSubtract(result, blendCutter);
          result.dispose();
          result = next;
        }
        blendCutter.dispose();
      }
    }
    return result;
  }

  // ── Path B: solid is non-Manifold — union cutters in Manifold space ──────────
  // Corner blends are built as Three.js geometries and added to the BVH path.
  const extraBvhCutters: THREE.BufferGeometry[] = [];
  if (hasCorners) {
    for (const blend of cornerBlends!) {
      const [bminx, bminy, bminz] = blend.boxMin;
      const [bmaxx, bmaxy, bmaxz] = blend.boxMax;
      const bsz = new THREE.Vector3(bmaxx - bminx, bmaxy - bminy, bmaxz - bminz);
      const bctr = new THREE.Vector3(
        (bminx + bmaxx) / 2, (bminy + bmaxy) / 2, (bminz + bmaxz) / 2,
      );
      const cbox = new THREE.BoxGeometry(bsz.x, bsz.y, bsz.z);
      cbox.translate(bctr.x, bctr.y, bctr.z);
      const csph = new THREE.SphereGeometry(blend.sphereRadius, 32, 24);
      csph.translate(...blend.sphereCenter);
      const blendCutter = _manifoldSubtract(cbox, csph) ?? _bvhSubtract(cbox, csph);
      cbox.dispose(); csph.dispose();
      const cnt = (blendCutter.attributes.position as THREE.BufferAttribute | undefined)?.count ?? 0;
      if (cnt > 0) extraBvhCutters.push(blendCutter);
      else blendCutter.dispose();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mCombined: any = null;
  const bvhOnlyCutters: THREE.BufferGeometry[] = [];
  for (const cutter of cutters) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mc: any = _toManifoldWithRepair(cutter);
    if (!mc) { bvhOnlyCutters.push(cutter); continue; }
    if (!mCombined) { mCombined = mc; continue; }
    try {
      const next = mCombined.add(mc);
      if (typeof mCombined.delete === 'function') mCombined.delete();
      if (typeof mc.delete === 'function') mc.delete();
      mCombined = next;
    } catch {
      if (typeof mc.delete === 'function') mc.delete();
      bvhOnlyCutters.push(cutter);
    }
  }

  let cur: THREE.BufferGeometry;
  if (mCombined) {
    const combinedGeo = _fromManifold(mCombined); // frees mCombined
    cur = _bvhSubtract(solid, combinedGeo);
    combinedGeo.dispose();
  } else if (bvhOnlyCutters.length > 0) {
    cur = _bvhSubtract(solid, bvhOnlyCutters[0]);
    bvhOnlyCutters.splice(0, 1);
  } else {
    cur = solid.clone();
  }
  for (const c of bvhOnlyCutters) {
    const next = _bvhSubtract(cur, c);
    cur.dispose();
    cur = next;
  }
  for (const c of extraBvhCutters) {
    const next = _bvhSubtract(cur, c);
    cur.dispose();
    cur = next;
    c.dispose();
  }
  return cur;
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
  const result = _csgEvaluator.evaluate(brushA, brushB, ADDITION);

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
  const result = _csgEvaluator.evaluate(brushA, brushB, INTERSECTION);

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
  const result = _csgEvaluator.evaluate(brushA, brushB, SUBTRACTION);

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

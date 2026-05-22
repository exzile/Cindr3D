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
      console.warn(`[csg] _manifoldData fast-path hit: verts=${md.vertProperties.length / 3} tris=${md.triVerts.length / 3}`);
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

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mesh = new (wasm as any).Mesh({ numProp: 3, vertProperties, triVerts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (wasm as any).Manifold(mesh);
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
  if (!ma) return null;
  const mb = _toManifoldWithRepair(b);
  if (!mb) { if (typeof ma.delete === 'function') ma.delete(); return null; }
  try {
    const result = ma.subtract(mb);
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
    const bvhCutters: THREE.BufferGeometry[] = [];
    for (const cutter of cutters) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mc: any = _toManifoldWithRepair(cutter);
      if (!mc) { bvhCutters.push(cutter); continue; }
      try {
        const next = accM.subtract(mc);
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

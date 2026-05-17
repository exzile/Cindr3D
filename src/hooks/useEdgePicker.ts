/**
 * useEdgePicker — reusable edge-picking hook for R3F components.
 *
 * Raycasts against pickable meshes to get a face hit, then finds the
 * nearest triangle edge to the hit point (by closest-point-on-segment
 * distance in world space).
 *
 * Same patterns as useFacePicker: module-level scratch, optionsRef for
 * stale-closure safety, hoverRef for no-op guards.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isGizmoDragging } from '../components/viewport/scene/gizmoDragGuard';
import type { EdgePickResult, UseEdgePickerOptions } from '../types/edge-picker.types';
export type { EdgePickResult, UseEdgePickerOptions } from '../types/edge-picker.types';

// ---------------------------------------------------------------------------
// Module-level scratch — no per-event allocation
// ---------------------------------------------------------------------------
const _mouse = new THREE.Vector2();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
// Occlusion / proximity scratch
const _occRay = new THREE.Raycaster();
const _occPt = new THREE.Vector3();   // world point on edge nearest the cursor
const _occNdc = new THREE.Vector3();  // that point projected to NDC
const _occNdc2 = new THREE.Vector2();
const _projA = new THREE.Vector3();
const _projB = new THREE.Vector3();

/** Max distance (CSS px) the cursor may be from an edge to pick/hover it. */
const EDGE_PICK_PX = 12;

/** Squared distance (px²) from point P to segment AB, all in screen pixels. */
function segDistSqPx(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const abx = bx - ax; const aby = by - ay;
  const apx = px - ax; const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq)) : 0;
  const cx = ax + abx * t; const cy = ay + aby * t;
  const dx = px - cx; const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Visibility + proximity gate for a candidate edge.
 *
 * - Occlusion: casts camera → (point on the edge nearest the cursor hit) and
 *   rejects the edge if the solid is struck meaningfully nearer than that
 *   point — i.e. the edge is behind the body from the current view. You must
 *   rotate so the edge is actually visible before it can be picked.
 * - Proximity: rejects the edge if the cursor is further than EDGE_PICK_PX
 *   screen pixels from the projected edge segment — you must point AT the
 *   line, not anywhere on the face it bounds.
 */
function edgeIsPickable(
  result: EdgePickResult,
  hitPoint: THREE.Vector3,
  camera: THREE.Camera,
  pickables: THREE.Mesh[],
  cursorPx: number,
  cursorPy: number,
  rectW: number,
  rectH: number,
): boolean {
  const ea = result.edgeVertexA;
  const eb = result.edgeVertexB;

  // ── Proximity (screen space) ──────────────────────────────────────────────
  _projA.copy(ea).project(camera);
  _projB.copy(eb).project(camera);
  // Behind the camera → not pickable here.
  if (_projA.z > 1 || _projB.z > 1) return false;
  const ax = (_projA.x * 0.5 + 0.5) * rectW;
  const ay = (1 - (_projA.y * 0.5 + 0.5)) * rectH;
  const bx = (_projB.x * 0.5 + 0.5) * rectW;
  const by = (1 - (_projB.y * 0.5 + 0.5)) * rectH;
  if (segDistSqPx(cursorPx, cursorPy, ax, ay, bx, by) > EDGE_PICK_PX * EDGE_PICK_PX) {
    return false;
  }

  // ── Occlusion (depth) ─────────────────────────────────────────────────────
  // Point on the edge nearest the cursor's surface hit, in world space.
  closestPointOnSegment(hitPoint, ea, eb, _occPt);
  // Build the view ray through that point via its NDC — correct for BOTH
  // perspective and orthographic cameras (this app uses an ortho camera, where
  // rays are parallel, not emanating from camera.position).
  _occNdc.copy(_occPt).project(camera);
  _occNdc2.set(_occNdc.x, _occNdc.y);
  _occRay.setFromCamera(_occNdc2, camera);
  const distToEdge = _occRay.ray.origin.distanceTo(_occPt);
  if (distToEdge < 1e-6) return true;
  _occRay.far = distToEdge * 1.5;
  const occHits = _occRay.intersectObjects(pickables, false);
  if (occHits.length > 0) {
    // Tolerance: the edge sits on the body surface, so the view ray through it
    // legitimately strikes the body at ~distToEdge. Only treat it as occluded
    // when something is hit clearly in front of that.
    const eps = Math.max(distToEdge * 0.01, 1e-3);
    if (occHits[0].distance < distToEdge - eps) return false;
  }
  return true;
}
// Extra scratch for face-normal computation (isFeatureEdge)
const _fnP0 = new THREE.Vector3();
const _fnP1 = new THREE.Vector3();
const _fnP2 = new THREE.Vector3();
const _fnE1 = new THREE.Vector3();
const _fnN1 = new THREE.Vector3();
const _fnN2 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Feature-edge detection
//
// A "feature edge" is one where adjacent face normals diverge by more than
// HARD_EDGE_COS_THRESHOLD radians — i.e. it is NOT a coplanar triangulation
// diagonal. Only feature edges are shown as fillet/chamfer candidates.
//
// The adjacency map is built lazily per geometry and cached in a WeakMap so
// it is computed at most once per BufferGeometry instance.
// ---------------------------------------------------------------------------

/** cos(5°) — edges whose adjacent faces share a smaller angle are coplanar */
const HARD_EDGE_COS_THRESHOLD = Math.cos(5 * Math.PI / 180); // ≈ 0.9962

/** geometry → Map<posKey_posKey, faceIndex[]> — built once, evicted when geom is GC'd */
const _edgeAdjCache = new WeakMap<THREE.BufferGeometry, Map<string, number[]>>();

/**
 * Position-based vertex key — matches vertices that occupy the same point in
 * local space regardless of whether they share an index. This is critical for
 * non-indexed (CSG/extrude) geometry where every triangle has its own unique
 * vertex indices even at shared edge positions.
 */
function vposKey(posAttr: THREE.BufferAttribute, i: number): string {
  // Round to 4 decimal places — handles floating-point noise while staying
  // precise enough for typical mm-scale CAD geometry.
  return `${Math.round(posAttr.getX(i) * 1e4)}_${Math.round(posAttr.getY(i) * 1e4)}_${Math.round(posAttr.getZ(i) * 1e4)}`;
}

function buildEdgeAdj(geom: THREE.BufferGeometry): Map<string, number[]> {
  const cached = _edgeAdjCache.get(geom);
  if (cached) return cached;

  const map = new Map<string, number[]>();
  const posAttr = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : posAttr.count / 3;
  const getI = (fi: number, c: number) => idx ? idx.getX(fi * 3 + c) : fi * 3 + c;

  for (let fi = 0; fi < triCount; fi++) {
    const i0 = getI(fi, 0), i1 = getI(fi, 1), i2 = getI(fi, 2);
    const k0 = vposKey(posAttr, i0);
    const k1 = vposKey(posAttr, i1);
    const k2 = vposKey(posAttr, i2);
    for (const [ka, kb] of [[k0, k1], [k1, k2], [k2, k0]] as [string, string][]) {
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let arr = map.get(key);
      if (!arr) { arr = []; map.set(key, arr); }
      arr.push(fi);
    }
  }

  _edgeAdjCache.set(geom, map);
  return map;
}

/** Compute world-space face normal for triangle fi into `out` (scratch-safe). */
function computeFaceNormal(
  posAttr: THREE.BufferAttribute,
  idx: THREE.BufferAttribute | null,
  fi: number,
  m: THREE.Matrix4,
  out: THREE.Vector3,
): void {
  const getI = (c: number) => idx ? idx.getX(fi * 3 + c) : fi * 3 + c;
  _fnP0.fromBufferAttribute(posAttr, getI(0)).applyMatrix4(m);
  _fnP1.fromBufferAttribute(posAttr, getI(1)).applyMatrix4(m);
  _fnP2.fromBufferAttribute(posAttr, getI(2)).applyMatrix4(m);
  _fnE1.subVectors(_fnP1, _fnP0);
  out.subVectors(_fnP2, _fnP0).cross(_fnE1).normalize();
}

/**
 * Returns true if the edge (ia, ib) in `geom` is a feature edge.
 * An edge is a feature edge when:
 *   – it is a boundary edge (only one adjacent triangle), or
 *   – the two adjacent triangles meet at a dihedral angle > 5°
 * Coplanar triangulation diagonals (angle ≈ 0°) are NOT feature edges.
 */
function isFeatureEdge(
  geom: THREE.BufferGeometry,
  ia: number,
  ib: number,
  m: THREE.Matrix4,
): boolean {
  const posAttr = geom.attributes.position as THREE.BufferAttribute;
  const adj = buildEdgeAdj(geom);
  const ka = vposKey(posAttr, ia);
  const kb = vposKey(posAttr, ib);
  const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  const faces = adj.get(key);
  if (!faces || faces.length < 2) return true; // boundary edge — always a feature edge

  computeFaceNormal(posAttr, geom.index, faces[0], m, _fnN1);
  computeFaceNormal(posAttr, geom.index, faces[1], m, _fnN2);

  // |dot| close to 1 → normals nearly parallel → coplanar → NOT a feature edge
  return Math.abs(_fnN1.dot(_fnN2)) < HARD_EDGE_COS_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Internal geometry helpers
// ---------------------------------------------------------------------------

/**
 * Returns the closest point on segment [a, b] to point p.
 * Result written into `out` (module-level scratch — caller must copy if needed).
 */
function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const lenSq = _ab.dot(_ab);
  if (lenSq === 0) {
    out.copy(a);
    return out;
  }
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / lenSq));
  out.copy(a).addScaledVector(_ab, t);
  return out;
}

// ---------------------------------------------------------------------------
// Internal: pick nearest FEATURE edge from a raycast hit
// ---------------------------------------------------------------------------

function pickNearestEdge(
  mesh: THREE.Mesh,
  faceIndex: number,
  hitPoint: THREE.Vector3,
): EdgePickResult | null {
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!posAttr) return null;

  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;

  const idxAttr = geom.index;
  const getIndices = (fi: number): [number, number, number] => {
    if (idxAttr) {
      return [
        idxAttr.getX(fi * 3),
        idxAttr.getX(fi * 3 + 1),
        idxAttr.getX(fi * 3 + 2),
      ];
    }
    return [fi * 3, fi * 3 + 1, fi * 3 + 2];
  };

  const [i0, i1, i2] = getIndices(faceIndex);

  // World-space vertices of the hit triangle
  _vA.fromBufferAttribute(posAttr, i0).applyMatrix4(m);
  _vB.fromBufferAttribute(posAttr, i1).applyMatrix4(m);
  _vC.fromBufferAttribute(posAttr, i2).applyMatrix4(m);

  // 3 edges: [A-B], [B-C], [C-A] — only consider feature (hard) edges
  const edges: [THREE.Vector3, THREE.Vector3, number, number][] = [
    [_vA, _vB, i0, i1],
    [_vB, _vC, i1, i2],
    [_vC, _vA, i2, i0],
  ];

  let bestDistSq = Infinity;
  let bestEdge: [THREE.Vector3, THREE.Vector3, number, number] | null = null;

  for (const [a, b, ia, ib] of edges) {
    if (!isFeatureEdge(geom, ia, ib, m)) continue; // skip coplanar triangulation diagonals
    closestPointOnSegment(hitPoint, a, b, _closest);
    const dSq = hitPoint.distanceToSquared(_closest);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestEdge = [a, b, ia, ib];
    }
  }

  if (!bestEdge) return null;

  const [ea, eb, eia, eib] = bestEdge;

  // Compute stable midpoint and direction (new allocations are fine here —
  // this only happens when we actually have a result to return).
  const midpoint = new THREE.Vector3().addVectors(ea, eb).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(eb, ea).normalize();

  return {
    mesh,
    faceIndex,
    edgeVertexA: ea.clone(),
    edgeVertexB: eb.clone(),
    edgeVertexIndexA: eia,
    edgeVertexIndexB: eib,
    midpoint,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEdgePicker(options: UseEdgePickerOptions): void {
  const { gl, camera, raycaster, scene } = useThree();

  const optionsRef = useRef(options);
  // eslint-disable-next-line react-hooks/refs
  optionsRef.current = options;

  const hoverRef = useRef<EdgePickResult | null>(null);

  useEffect(() => {
    if (!optionsRef.current.enabled) {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
      return;
    }

    const collectPickable = (): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh || !obj.userData?.pickable) return;
        if (optionsRef.current.filter && !optionsRef.current.filter(m)) return;
        out.push(m);
      });
      return out;
    };

    const updateMouse = (event: { clientX: number; clientY: number }) => {
      const r = gl.domElement.getBoundingClientRect();
      _mouse.set(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        -((event.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateMouse(event);
      raycaster.setFromCamera(_mouse, camera);
      const pickables = collectPickable();
      const hits = raycaster.intersectObjects(pickables, false);

      if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].point) {
        const hit = hits[0];
        const result = pickNearestEdge(
          hit.object as THREE.Mesh,
          hit.faceIndex!,
          hit.point,
        );
        if (result) {
          const r = gl.domElement.getBoundingClientRect();
          if (edgeIsPickable(
            result, hit.point, camera, pickables,
            event.clientX - r.left, event.clientY - r.top, r.width, r.height,
          )) {
            hoverRef.current = result;
            optionsRef.current.onHover?.(result);
            return;
          }
        }
      }

      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // The trailing synthetic click after a gizmo-arrow drag must not pick an
      // edge. EdgeOpGizmo clears this flag on a deferred (post-click) task.
      if (isGizmoDragging()) return;
      updateMouse(event);
      raycaster.setFromCamera(_mouse, camera);
      const pickables = collectPickable();
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length === 0) return;
      const hit = hits[0];
      if (hit.faceIndex === undefined || !hit.point) return;
      const result = pickNearestEdge(
        hit.object as THREE.Mesh,
        hit.faceIndex!,
        hit.point,
      );
      if (result) {
        const r = gl.domElement.getBoundingClientRect();
        if (!edgeIsPickable(
          result, hit.point, camera, pickables,
          event.clientX - r.left, event.clientY - r.top, r.width, r.height,
        )) return;
        optionsRef.current.onClick?.(result);
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('click', handleClick, true);

    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('click', handleClick, true);
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        optionsRef.current.onHover?.(null);
      }
    };
   
  }, [gl, camera, raycaster, scene, options.enabled]);
}

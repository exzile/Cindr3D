/**
 * EdgeOpGizmo — generic on-canvas drag handle for an edge-modification tool's
 * size parameter (fillet radius / chamfer distance).
 *
 * Active when the tool's dialog is open AND ≥1 edge is selected. A cone+line
 * arrow sits at the selected-edge centroid, offset along the operation's
 * OUTWARD direction (exterior bisector of the two adjacent faces) by the
 * current size. Dragging the cone along that axis updates the tool's live
 * value (throttled), which the dialog input reflects in real time.
 *
 * Shared by FilletGizmo / ChamferGizmo — they pass the store accessors and a
 * handle colour. Falls back to world-Y when the body isn't in the live-mesh
 * registry yet so the gizmo still functions.
 */

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { liveBodyMeshes } from '../../../../store/meshRegistry';
import { parseEdgeIds, computeEdgeGizmoDir } from '../../../../utils/geometry/edgeCutCore';
import { setGizmoDragging } from '../gizmoDragGuard';

// ── Module-level scratch (shared, no state — safe) ───────────────────────────
const _scratchRay = new THREE.Ray();
const _scratchW0 = new THREE.Vector3();
const _scratchOffset = new THREE.Vector3();
const _coneLocalUp = new THREE.Vector3(0, 1, 0);
const _scratchNdc = new THREE.Vector2();

interface EdgeOpGizmoProps {
  enabled: boolean;
  edgeIds: string[];
  /** Read the current live size from the store (no React subscription). */
  getLiveValue: () => number;
  /** Write the live size back to the store. */
  setLiveValue: (v: number) => void;
  /** Handle/arrow colour (per tool). */
  handleColor: number;
}

// Compute the gizmo's anchor centroid + the exterior bisector direction from
// the picked edges in one pass. Combines what used to be two separate useMemos
// (each parsing edgeIds independently) so the parse happens once per change.
//
// FIX (along the way): the previous standalone parseEdgeCentroid only read the
// FIRST chord of each edge ID (parts[1]/parts[2]), so a chained model edge
// stored as N+1 ordered points anchored the gizmo to its first chord's
// midpoint instead of the edge's full centroid. Using `parseEdgeIds` gives us
// every segment of the chain, matching what the cut pipeline actually sees.
function computeGizmoAnchor(edgeIds: string[]): {
  centroid: THREE.Vector3;
  dir: THREE.Vector3;
} {
  const fallbackDir = new THREE.Vector3(0, 1, 0);
  const empty = { centroid: new THREE.Vector3(), dir: fallbackDir };
  const parsed = parseEdgeIds(edgeIds);
  if (!parsed || parsed.edges.length === 0) return empty;

  const centroid = new THREE.Vector3();
  for (const e of parsed.edges) {
    centroid.x += (e.a.x + e.b.x) * 0.5;
    centroid.y += (e.a.y + e.b.y) * 0.5;
    centroid.z += (e.a.z + e.b.z) * 0.5;
  }
  centroid.divideScalar(parsed.edges.length);

  const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
  if (!liveMesh) return { centroid, dir: fallbackDir };
  let dir: THREE.Vector3 | null = null;
  try {
    dir = computeEdgeGizmoDir(liveMesh.geometry, parsed.edges);
  } catch (err) {
    console.error('[EdgeOpGizmo] gizmoDir threw:', err);
  }
  return { centroid, dir: dir ?? fallbackDir };
}

export default function EdgeOpGizmo({
  enabled,
  edgeIds,
  getLiveValue,
  setLiveValue,
  handleColor,
}: EdgeOpGizmoProps) {
  const active = enabled && edgeIds.length > 0;

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);

  // Per-instance materials (colour varies per tool, so not module singletons).
  const handleMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.3, metalness: 0.1, depthTest: false }),
    [handleColor],
  );
  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: handleColor, linewidth: 2, depthTest: false }),
    [handleColor],
  );
  useEffect(() => () => { handleMat.dispose(); }, [handleMat]);
  useEffect(() => () => { lineMat.dispose(); }, [lineMat]);

  // Centroid + direction share one parseEdgeIds (avoids parsing edge IDs
  // twice every time the selection changes). computeEdgeGizmoDir now handles
  // indexed geometry too (buildTriangleList walks the index when present),
  // so we hand it liveMesh.geometry directly — no clone / toNonIndexed.
  const { centroid: edgeCentroid, dir: gizmoDir } = useMemo(
    () => computeGizmoAnchor(edgeIds),
    [edgeIds],
  );

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const liveValueRef = useRef<number | null>(null);

  const coneRef = useRef<THREE.Mesh>(null);

  const lineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    return new THREE.Line(geom, lineMat);
  }, [lineMat]);
  useEffect(() => {
    return () => { lineObj.geometry.dispose(); };
  }, [lineObj]);

  const tipScratch = useRef(new THREE.Vector3());
  // Last applied value — used to skip the no-op invalidate+upload when the
  // store value (or drag offset) hasn't moved since the previous frame.
  // R3F's frameloop="demand" means an unconditional invalidate() keeps the
  // render loop spinning even when the gizmo is idle; guarding here lets the
  // canvas actually settle.
  const lastAppliedValueRef = useRef<number | null>(null);
  useFrame(({ invalidate }) => {
    if (!active) return;
    const value = draggingRef.current && liveValueRef.current !== null
      ? liveValueRef.current
      : getLiveValue();
    if (value === lastAppliedValueRef.current) return; // idle frame; nothing changed
    lastAppliedValueRef.current = value;

    const pos = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tip = tipScratch.current
      .copy(edgeCentroid)
      .add(_scratchOffset.copy(gizmoDir).multiplyScalar(value));
    pos.setXYZ(0, edgeCentroid.x, edgeCentroid.y, edgeCentroid.z);
    pos.setXYZ(1, tip.x, tip.y, tip.z);
    pos.needsUpdate = true;

    if (coneRef.current) {
      /* eslint-disable react-hooks/immutability */
      coneRef.current.position.copy(tip);
      coneRef.current.quaternion.setFromUnitVectors(_coneLocalUp, gizmoDir);
      /* eslint-enable react-hooks/immutability */
    }
    invalidate();
  });

  // When the gizmo direction or centroid changes (different edges picked), the
  // cached "last value" is stale relative to the new orientation — force a
  // recompute next frame by clearing the guard.
  useEffect(() => { lastAppliedValueRef.current = null; }, [gizmoDir, edgeCentroid]);

  const rayToAxis = useCallback((ndc: THREE.Vector2): number | null => {
    _scratchRay.origin.setFromMatrixPosition(camera.matrixWorld);
    _scratchRay.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(_scratchRay.origin).normalize();
    const w0 = _scratchW0.copy(_scratchRay.origin).sub(edgeCentroid);
    const b = _scratchRay.direction.dot(gizmoDir);
    const d = _scratchRay.direction.dot(w0);
    const e = gizmoDir.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null;
    return (e - b * d) / denom;
  }, [camera, edgeCentroid, gizmoDir]);

  const onPointerDown = useCallback((ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    _scratchNdc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const sAtPointer = rayToAxis(_scratchNdc);
    if (sAtPointer === null) return;
    draggingRef.current = true;
    // Suppress window/lasso marquee + edge-pick for the duration of this drag
    // (and the trailing synthetic click). Cleared on pointer-up below.
    setGizmoDragging(true);
    const current = getLiveValue();
    dragOffsetRef.current = current - sAtPointer;
    liveValueRef.current = current;
    /* eslint-disable react-hooks/immutability */
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'ns-resize';
    /* eslint-enable react-hooks/immutability */
  }, [gl, rayToAxis, controls, getLiveValue]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const THROTTLE_MS = 16;
  const lastFlushRef = useRef(0);
  const pendingTimeoutRef = useRef(0);

  useEffect(() => {
    const flushToStore = () => {
      pendingTimeoutRef.current = 0;
      if (!mountedRef.current || liveValueRef.current === null) return;
      lastFlushRef.current = performance.now();
      setLiveValue(liveValueRef.current);
    };

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current || !mountedRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const s = rayToAxis(ndc);
      if (s === null) return;
      liveValueRef.current = Math.max(0.01, Math.round((s + dragOffsetRef.current) * 100) / 100);
      if (!pendingTimeoutRef.current) {
        const elapsed = performance.now() - lastFlushRef.current;
        const delay = Math.max(0, THROTTLE_MS - elapsed);
        pendingTimeoutRef.current = window.setTimeout(flushToStore, delay);
      }
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (pendingTimeoutRef.current) { clearTimeout(pendingTimeoutRef.current); pendingTimeoutRef.current = 0; }
      if (mountedRef.current && liveValueRef.current !== null) {
        setLiveValue(liveValueRef.current);
      }
      liveValueRef.current = null;
      /* eslint-disable react-hooks/immutability */
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
      /* eslint-enable react-hooks/immutability */
      // Defer clearing past the trailing synthetic `click` (which fires after
      // pointerup, before a 0ms task) so useEdgePicker still bails on it.
      window.setTimeout(() => setGizmoDragging(false), 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      // Never strand the guard true if we unmount mid-drag (HMR / dialog close).
      setGizmoDragging(false);
    };
  }, [gl, rayToAxis, controls, setLiveValue]);

  if (!active) return null;

  return (
    <group renderOrder={2000}>
      <primitive object={lineObj} />
      <mesh
        ref={coneRef}
        onPointerDown={onPointerDown}
        /* eslint-disable react-hooks/immutability */
        onPointerOver={() => { gl.domElement.style.cursor = 'ns-resize'; }}
        onPointerOut={() => { if (!draggingRef.current) gl.domElement.style.cursor = ''; }}
        /* eslint-enable react-hooks/immutability */
      >
        <coneGeometry args={[1.2, 4, 16]} />
        <primitive object={handleMat} attach="material" />
      </mesh>
    </group>
  );
}

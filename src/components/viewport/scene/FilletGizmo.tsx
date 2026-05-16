/**
 * FilletGizmo — on-canvas drag handle for the fillet radius.
 *
 * Active when activeDialog === 'fillet' AND at least one edge is selected.
 * Shows a cone + line arrow positioned at the centroid of selected edges,
 * offset along the fillet's OUTWARD direction by the current radius. The
 * outward direction is the exterior bisector of the two faces adjacent to
 * the picked edge(s) — perpendicular to the edge, pointing away from the
 * solid (toward where the sharp corner was). Dragging the cone along that
 * axis updates filletLiveRadius (throttled), which the FilletDialog input
 * reflects in real time — same pattern as ExtrudeGizmo / extrudeDistance.
 *
 * Falls back to world-Y only when the geometry can't be resolved (e.g. the
 * body isn't in the live-mesh registry yet).
 */

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { liveBodyMeshes } from '../../../store/meshRegistry';
import { parseFilletEdgeIds, computeFilletGizmoDir } from '../../../utils/geometry/filletGeometry';

// ── Module-level singletons ───────────────────────────────────────────────────
const _scratchRay = new THREE.Ray();
const _scratchW0 = new THREE.Vector3();
const _scratchOffset = new THREE.Vector3(); // reused in useFrame for tip = centroid + dir*r
const _scratchQuat = new THREE.Quaternion(); // reused to orient the cone along dir
const _coneLocalUp = new THREE.Vector3(0, 1, 0); // coneGeometry apex axis (+Y)

const HANDLE_MAT = new THREE.MeshStandardMaterial({
  color: 0xff8800,
  roughness: 0.3,
  metalness: 0.1,
  depthTest: false,
});
HANDLE_MAT.userData.shared = true;

const LINE_MAT = new THREE.LineBasicMaterial({
  color: 0xff8800,
  linewidth: 2,
  depthTest: false,
});
LINE_MAT.userData.shared = true;

// ── Helper: parse edge centroid from filletEdgeIds ────────────────────────────
// Edge ID format: `${featureId}|${meshUuid}:${ax,ay,az}:${bx,by,bz}`  (new)
//            or:  `${meshUuid}:${ax,ay,az}:${bx,by,bz}`                (legacy)
function parseEdgeCentroid(edgeIds: string[]): THREE.Vector3 | null {
  const centroid = new THREE.Vector3();
  let count = 0;
  for (const id of edgeIds) {
    let rest = id;
    const pipe = id.indexOf('|');
    if (pipe > 0) rest = id.slice(pipe + 1);
    const parts = rest.split(':');
    if (parts.length < 3) continue;
    const a = parts[1].split(',').map(Number);
    const b = parts[2].split(',').map(Number);
    if (a.length !== 3 || b.length !== 3) continue;
    centroid.x += (a[0] + b[0]) / 2;
    centroid.y += (a[1] + b[1]) / 2;
    centroid.z += (a[2] + b[2]) / 2;
    count++;
  }
  if (count === 0) return null;
  return centroid.divideScalar(count);
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function FilletGizmo() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const filletEdgeIds = useCADStore((s) => s.filletEdgeIds);

  const enabled = activeDialog === 'fillet' && filletEdgeIds.length > 0;

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);

  // Centroid of selected edge midpoints — re-computed when edges change.
  const edgeCentroid = useMemo(
    () => parseEdgeCentroid(filletEdgeIds) ?? new THREE.Vector3(),
    [filletEdgeIds],
  );

  // Outward direction for the handle — exterior bisector of the two faces
  // adjacent to the picked edge(s). Resolved against the live rendered mesh
  // (same registry commitFillet/FilletPreview use). Falls back to world-Y
  // when the body isn't registered yet so the gizmo still functions.
  const gizmoDir = useMemo(() => {
    const fallback = new THREE.Vector3(0, 1, 0);
    const parsed = parseFilletEdgeIds(filletEdgeIds);
    if (!parsed) return fallback;
    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) return fallback;
    const srcGeo = liveMesh.geometry.clone().toNonIndexed();
    const dir = computeFilletGizmoDir(srcGeo, parsed.edges);
    srcGeo.dispose();
    return dir ?? fallback;
  }, [filletEdgeIds]);

  // ── Drag state refs ───────────────────────────────────────────────────────
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const liveRadiusRef = useRef<number | null>(null);

  // ── Three.js objects ──────────────────────────────────────────────────────
  const coneRef = useRef<THREE.Mesh>(null);

  const lineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    return new THREE.Line(geom, LINE_MAT);
  }, []);

  useEffect(() => {
    return () => { lineObj.geometry.dispose(); };
  }, [lineObj]);

  // ── useFrame: update arrow visuals imperatively ───────────────────────────
  const tipScratch = useRef(new THREE.Vector3());
  useFrame(({ invalidate }) => {
    if (!enabled) return;
    invalidate();
    const radius = draggingRef.current && liveRadiusRef.current !== null
      ? liveRadiusRef.current
      : useCADStore.getState().filletLiveRadius;

    // Line: from centroid outward along gizmoDir by `radius`.
    const pos = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tip = tipScratch.current
      .copy(edgeCentroid)
      .add(_scratchOffset.copy(gizmoDir).multiplyScalar(radius));
    pos.setXYZ(0, edgeCentroid.x, edgeCentroid.y, edgeCentroid.z);
    pos.setXYZ(1, tip.x, tip.y, tip.z);
    pos.needsUpdate = true;

    // Cone at the tip, pointing along gizmoDir (away from the edge).
    if (coneRef.current) {
      /* eslint-disable react-hooks/immutability */
      coneRef.current.position.copy(tip);
      coneRef.current.quaternion.setFromUnitVectors(_coneLocalUp, gizmoDir);
      /* eslint-enable react-hooks/immutability */
    }
  });

  // ── Raycast: project pointer onto the gizmoDir axis through edgeCentroid ──
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

  // ── Pointer down on cone ──────────────────────────────────────────────────
  const onPointerDown = useCallback((ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const sAtPointer = rayToAxis(ndc);
    if (sAtPointer === null) return;
    draggingRef.current = true;
    const currentRadius = useCADStore.getState().filletLiveRadius;
    dragOffsetRef.current = currentRadius - sAtPointer;
    liveRadiusRef.current = currentRadius;
    /* eslint-disable react-hooks/immutability */
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'ns-resize';
    /* eslint-enable react-hooks/immutability */
  }, [gl, rayToAxis, controls]);

  // ── Global drag listeners ─────────────────────────────────────────────────
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const THROTTLE_MS = 50;
  const lastFlushRef = useRef(0);
  const pendingTimeoutRef = useRef(0);

  useEffect(() => {
    const flushToStore = () => {
      pendingTimeoutRef.current = 0;
      if (!mountedRef.current || liveRadiusRef.current === null) return;
      lastFlushRef.current = performance.now();
      useCADStore.getState().setFilletLiveRadius(liveRadiusRef.current);
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
      liveRadiusRef.current = Math.max(0.01, Math.round((s + dragOffsetRef.current) * 100) / 100);
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
      if (mountedRef.current && liveRadiusRef.current !== null) {
        useCADStore.getState().setFilletLiveRadius(liveRadiusRef.current);
      }
      liveRadiusRef.current = null;
      /* eslint-disable react-hooks/immutability */
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
      /* eslint-enable react-hooks/immutability */
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    };
  }, [gl, rayToAxis, controls]);

  if (!enabled) return null;

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
        <primitive object={HANDLE_MAT} attach="material" />
      </mesh>
    </group>
  );
}

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

// ── Module-level scratch (shared, no state — safe) ───────────────────────────
const _scratchRay = new THREE.Ray();
const _scratchW0 = new THREE.Vector3();
const _scratchOffset = new THREE.Vector3();
const _coneLocalUp = new THREE.Vector3(0, 1, 0);

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

  const edgeCentroid = useMemo(
    () => parseEdgeCentroid(edgeIds) ?? new THREE.Vector3(),
    [edgeIds],
  );

  const gizmoDir = useMemo(() => {
    const fallback = new THREE.Vector3(0, 1, 0);
    const parsed = parseEdgeIds(edgeIds);
    if (!parsed) return fallback;
    const liveMesh = liveBodyMeshes.get(parsed.meshUuid);
    if (!liveMesh) return fallback;
    const srcGeo = liveMesh.geometry.clone().toNonIndexed();
    const dir = computeEdgeGizmoDir(srcGeo, parsed.edges);
    srcGeo.dispose();
    return dir ?? fallback;
  }, [edgeIds]);

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
  useFrame(({ invalidate }) => {
    if (!active) return;
    invalidate();
    const value = draggingRef.current && liveValueRef.current !== null
      ? liveValueRef.current
      : getLiveValue();

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
  });

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
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const sAtPointer = rayToAxis(ndc);
    if (sAtPointer === null) return;
    draggingRef.current = true;
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

  const THROTTLE_MS = 50;
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
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
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

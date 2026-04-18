import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { setGizmoDragActive } from '../ExtrudeTool';
import { GeometryEngine } from '../../../engine/GeometryEngine';
import type { Sketch } from '../../../types/cad';
import {
  ARROW_MATERIAL,
  ARROW_MATERIAL_CUT,
  ARROW_LINE_MATERIAL,
  ARROW_LINE_MATERIAL_CUT,
} from './materials';

export default function ExtrudeGizmo({ sketch }: { sketch: Sketch }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);

  // NO reactive subscription to extrudeDistance — that caused the infinite
  // re-render loop.  Read from getState() only.

  // Compute centroid + world normal once per sketch
  const { centroid, normal } = useMemo(() => {
    const c = GeometryEngine.getSketchProfileCentroid(sketch) ?? new THREE.Vector3();
    return { centroid: c, normal: GeometryEngine.getSketchExtrudeNormal(sketch) };
  }, [sketch]);

  // ── Mutable refs for drag state ──
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  // Live distance — updated every pointermove during drag, read by useFrame.
  // Initialised lazily on first useFrame from the store.
  const liveDistRef = useRef<number | null>(null);

  // ── Three.js objects updated imperatively in useFrame ──
  const coneRef = useRef<THREE.Mesh>(null);

  // Stable line object — positions buffer updated in useFrame
  const lineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    return new THREE.Line(geom, ARROW_LINE_MATERIAL);
  }, []);

  useEffect(() => {
    return () => { lineObj.geometry.dispose(); };
  }, [lineObj]);

  // Cone quaternion helpers
  const normalQuat = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    return new THREE.Quaternion().setFromUnitVectors(up, normal);
  }, [normal]);
  const reverseQuat = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    return new THREE.Quaternion().setFromUnitVectors(up, normal.clone().negate());
  }, [normal]);

  // ── useFrame: update arrow visuals every frame ──
  // Scratch tip vector — reused across frames to comply with the no-alloc rule.
  const tipScratch = useRef(new THREE.Vector3());
  // Last applied isCut value so we only swap materials on transitions, not every frame.
  const lastIsCutRef = useRef<boolean | null>(null);
  useFrame(() => {
    // During drag use liveDistRef; otherwise read fresh from store
    const dist = draggingRef.current && liveDistRef.current !== null
      ? liveDistRef.current
      : useCADStore.getState().extrudeDistance;
    const isCut = dist < 0;

    // Update line positions — write tip into scratch instead of allocating
    const pos = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tip = tipScratch.current.copy(centroid).addScaledVector(normal, dist);
    pos.setXYZ(0, centroid.x, centroid.y, centroid.z);
    pos.setXYZ(1, tip.x, tip.y, tip.z);
    pos.needsUpdate = true;

    // Only swap materials when the cut/non-cut state actually flips
    /* eslint-disable react-hooks/immutability -- Three.js object mutations in useFrame */
    if (lastIsCutRef.current !== isCut) {
      lineObj.material = isCut ? ARROW_LINE_MATERIAL_CUT : ARROW_LINE_MATERIAL;
      if (coneRef.current) {
        (coneRef.current as THREE.Mesh).material = isCut ? ARROW_MATERIAL_CUT : ARROW_MATERIAL;
      }
      lastIsCutRef.current = isCut;
    }
    /* eslint-enable react-hooks/immutability */

    // Update cone position + orientation (cheap, every frame)
    if (coneRef.current) {
      coneRef.current.position.copy(tip);
      coneRef.current.quaternion.copy(isCut ? reverseQuat : normalQuat);
    }
  });

  // ── Raycast: project pointer onto (centroid, normal) axis ──
  const rayToAxisDistance = useCallback((ndc: THREE.Vector2): number | null => {
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
    const w0 = ray.origin.clone().sub(centroid);
    const b = ray.direction.dot(normal);
    const d = ray.direction.dot(w0);
    const e = normal.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null;
    return (e - b * d) / denom;
  }, [camera, centroid, normal]);

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const sAtPointer = rayToAxisDistance(ndc);
    if (sAtPointer === null) return;
    draggingRef.current = true;
    setGizmoDragActive(true); // Suppress profile-picker click on release
    const currentDist = useCADStore.getState().extrudeDistance;
    dragOffsetRef.current = currentDist - sAtPointer;
    liveDistRef.current = currentDist;
    /* eslint-disable react-hooks/immutability -- DOM/Three.js side-effects in drag handler */
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'ns-resize';
    /* eslint-enable react-hooks/immutability */
  }, [gl, rayToAxisDistance, controls]);

  // Track mounted state
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Drag listeners ──
  // pointermove: update liveDistRef immediately (gizmo arrow reads it in
  // useFrame for instant visual feedback).  Store is updated at most once
  // every THROTTLE_MS so ExtrudePreview/Panel update without overwhelming
  // React's render pipeline.
  const THROTTLE_MS = 50;
  const lastFlushRef = useRef(0);
  const pendingTimeoutRef = useRef(0);

  useEffect(() => {
    const flushToStore = () => {
      pendingTimeoutRef.current = 0;
      if (!mountedRef.current || liveDistRef.current === null) return;
      lastFlushRef.current = performance.now();
      const store = useCADStore.getState();
      store.setExtrudeDistance(liveDistRef.current);
      // Auto-toggle Join/Cut for Press-Pull based on drag direction:
      // dragging outward (positive) = join, inward (negative) = cut.
      const ids = store.extrudeSelectedSketchIds;
      if (ids.length > 0) {
        const skId = ids[0].split('::')[0];
        const sk = store.sketches.find((s: { id: string }) => s.id === skId);
        const isPressPull = sk?.name?.startsWith('Press Pull Profile');
        if (isPressPull) {
          const wantCut = liveDistRef.current < 0;
          const currentOp = store.extrudeOperation;
          if (wantCut && currentOp !== 'cut') store.setExtrudeOperation('cut');
          else if (!wantCut && currentOp !== 'join') store.setExtrudeOperation('join');
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !mountedRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const s = rayToAxisDistance(ndc);
      if (s === null) return;
      liveDistRef.current = Math.round((s + dragOffsetRef.current) * 100) / 100;

      // Throttle store updates so React doesn't cascade
      if (!pendingTimeoutRef.current) {
        const elapsed = performance.now() - lastFlushRef.current;
        const delay = Math.max(0, THROTTLE_MS - elapsed);
        pendingTimeoutRef.current = window.setTimeout(flushToStore, delay);
      }
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // Cancel pending throttled update
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = 0;
      }
      // Final store flush
      if (mountedRef.current && liveDistRef.current !== null) {
        useCADStore.getState().setExtrudeDistance(liveDistRef.current);
      }
      liveDistRef.current = null;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    };
  }, [gl, rayToAxisDistance, controls]);

  return (
    <group renderOrder={2000}>
      <primitive object={lineObj} />
      <mesh
        ref={coneRef}
        onPointerDown={onPointerDown}
        // eslint-disable-next-line react-hooks/immutability
        onPointerOver={() => { gl.domElement.style.cursor = 'ns-resize'; }}
        // eslint-disable-next-line react-hooks/immutability
        onPointerOut={() => { if (!draggingRef.current) gl.domElement.style.cursor = ''; }}
      >
        <coneGeometry args={[1.2, 4, 16]} />
        <primitive object={ARROW_MATERIAL} attach="material" />
      </mesh>
    </group>
  );
}

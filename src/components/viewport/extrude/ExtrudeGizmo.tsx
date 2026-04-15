import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
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
  const distance = useCADStore((s) => s.extrudeDistance);
  const setDistance = useCADStore((s) => s.setExtrudeDistance);

  // Cut mode = signed distance is negative (dragged into the body)
  const isCut = distance < 0;

  // Compute centroid + world normal once per sketch
  const { centroid, normal } = useMemo(() => {
    const c = GeometryEngine.getSketchProfileCentroid(sketch) ?? new THREE.Vector3();
    return { centroid: c, normal: GeometryEngine.getSketchExtrudeNormal(sketch) };
  }, [sketch]);

  // Arrow tip flips automatically with signed distance
  const arrowTip = useMemo(
    () => centroid.clone().addScaledVector(normal, distance),
    [centroid, normal, distance],
  );

  // Line geometry rebuilt whenever arrow tip moves
  const arrowLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([centroid, arrowTip]);
    return new THREE.Line(geom, isCut ? ARROW_LINE_MATERIAL_CUT : ARROW_LINE_MATERIAL);
  }, [centroid, arrowTip, isCut]);

  useEffect(() => {
    return () => { arrowLine.geometry.dispose(); };
  }, [arrowLine]);

  // Cone quaternion: rotate default +Y to the effective arrow direction.
  // Cut mode flips the cone to point INTO the body.
  const coneQuat = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const dir = isCut ? normal.clone().negate() : normal;
    return new THREE.Quaternion().setFromUnitVectors(up, dir);
  }, [normal, isCut]);

  // Drag: track pointer ray → project onto (centroid, normal) axis line
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);

  const rayToAxisDistance = useCallback((ndc: THREE.Vector2): number | null => {
    const ray = new THREE.Ray();
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
    const w0 = ray.origin.clone().sub(centroid);
    const b = ray.direction.dot(normal);
    const d = ray.direction.dot(w0);
    const e = normal.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-4) return null; // ray parallel to axis
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
    dragOffsetRef.current = useCADStore.getState().extrudeDistance - sAtPointer;
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'ns-resize';
  }, [gl, rayToAxisDistance, controls]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const s = rayToAxisDistance(ndc);
      if (s === null) return;
      // Signed distance — allow negative so dragging INTO the face becomes
      // press-pull cut. Snap to 0.01 but don't clamp out the zero crossing.
      const newDist = Math.round((s + dragOffsetRef.current) * 100) / 100;
      if (newDist !== useCADStore.getState().extrudeDistance) setDistance(newDist);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, rayToAxisDistance, setDistance, controls]);

  return (
    <group renderOrder={2000}>
      <primitive object={arrowLine} />
      <mesh
        position={arrowTip}
        quaternion={coneQuat}
        onPointerDown={onPointerDown}
        onPointerOver={() => { gl.domElement.style.cursor = 'ns-resize'; }}
        onPointerOut={() => { if (!draggingRef.current) gl.domElement.style.cursor = ''; }}
      >
        <coneGeometry args={[1.2, 4, 16]} />
        <primitive object={isCut ? ARROW_MATERIAL_CUT : ARROW_MATERIAL} attach="material" />
      </mesh>
    </group>
  );
}

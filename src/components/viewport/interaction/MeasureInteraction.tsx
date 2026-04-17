import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';
import { clearGroupChildren } from '../../../utils/threeDisposal';

/** Measure tool — click two points to measure distance, shows line + label in 3D scene */
export default function MeasureInteraction() {
  const { camera, gl, raycaster, scene } = useThree();
  const activeTool = useCADStore((s) => s.activeTool);
  const measurePoints = useCADStore((s) => s.measurePoints);
  const setMeasurePoints = useCADStore((s) => s.setMeasurePoints);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const units = useCADStore((s) => s.units);

  const [mousePos, setMousePos] = useState<THREE.Vector3 | null>(null);
  const previewRef = useRef<THREE.Group>(null);
  const matRef = useRef(new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 }));
  const dashedRef = useRef(new THREE.LineDashedMaterial({ color: 0xffaa00, linewidth: 1, dashSize: 1, gapSize: 0.5 }));

  // Reusable dot geometry + material — created once, never reallocated
  const dotGeoRef = useRef(new THREE.SphereGeometry(0.3, 8, 8));
  const dotMatRef = useRef(new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false }));
  // Two reusable sphere meshes (at most 2 dots are shown at a time)
  const dot1Ref = useRef<THREE.Mesh>(new THREE.Mesh());
  const dot2Ref = useRef<THREE.Mesh>(new THREE.Mesh());
  // Reusable line object — avoids allocating new BufferGeometry per frame
  const lineRef = useRef<THREE.Line>(new THREE.Line());
  const lineGeoRef = useRef<THREE.BufferGeometry>(new THREE.BufferGeometry());
  // Pre-allocated position buffer (2 vertices × xyz). Mutated in-place each frame
  // so we don't allocate a fresh Float32Array + BufferAttribute on every tick.
  const linePosArrayRef = useRef<Float32Array>(new Float32Array(6));
  const linePosAttrRef = useRef<THREE.BufferAttribute | null>(null);
  // Scratch Vector3s for useFrame — avoids per-frame allocation
  const _p1Scratch = useRef(new THREE.Vector3());
  const _endScratch = useRef(new THREE.Vector3());

  useEffect(() => {
    // Assign geometry + material to the reusable meshes once.
    // Mark them non-pickable so the Measure raycast can't hit its own preview.
    dot1Ref.current.geometry = dotGeoRef.current;
    dot1Ref.current.material = dotMatRef.current;
    dot1Ref.current.renderOrder = 999;
    dot1Ref.current.userData.measurePreview = true;
    dot2Ref.current.geometry = dotGeoRef.current;
    dot2Ref.current.material = dotMatRef.current;
    dot2Ref.current.renderOrder = 999;
    dot2Ref.current.userData.measurePreview = true;
    // Reusable line object for the measurement line between dots.
    // Bind the position attribute ONCE so useFrame can mutate the underlying array
    // in-place — no Float32Array / BufferAttribute allocations per tick.
    if (!linePosAttrRef.current) {
      linePosAttrRef.current = new THREE.BufferAttribute(linePosArrayRef.current, 3);
      lineGeoRef.current.setAttribute('position', linePosAttrRef.current);
    }
    lineRef.current.geometry = lineGeoRef.current;
    lineRef.current.material = matRef.current;
    lineRef.current.userData.measurePreview = true;

    const m1 = matRef.current;
    const m2 = dashedRef.current;
    const g = dotGeoRef.current;
    const dm = dotMatRef.current;
    const lg = lineGeoRef.current;
    return () => { m1.dispose(); m2.dispose(); g.dispose(); dm.dispose(); lg.dispose(); };
  }, []);

  // Raycast against scene geometry + ground plane fallback
  const getWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);

    // Try to hit meshes in the scene first — skip our own measure preview
    // objects so the raycast can't hit the marker dots / preview line.
    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && !obj.userData.measurePreview) {
        meshes.push(obj);
      }
    });
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) return hits[0].point.clone();

    // Fallback: intersect the ground plane (Y=0)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, pt)) return pt;
    return null;
  }, [camera, gl, raycaster, scene]);

  useEffect(() => {
    if (activeTool !== 'measure') return;

    const handleMouseMove = (event: MouseEvent) => {
      const point = getWorldPoint(event);
      if (point) {
        setMousePos(point);
        // Read latest from store to avoid stale closure
        const pts = useCADStore.getState().measurePoints;
        const u = useCADStore.getState().units;
        if (pts.length === 0) {
          setStatusMessage(`Measure: click first point — ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
        } else if (pts.length === 1) {
          const p1 = pts[0];
          const dist = point.distanceTo(new THREE.Vector3(p1.x, p1.y, p1.z));
          setStatusMessage(`Distance: ${dist.toFixed(3)} ${u} — click to confirm`);
        }
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = getWorldPoint(event);
      if (!point) return;

      const pts = useCADStore.getState().measurePoints;
      const u = useCADStore.getState().units;
      if (pts.length === 0) {
        setMeasurePoints([{ x: point.x, y: point.y, z: point.z }]);
        setStatusMessage('First point set — click second point');
      } else if (pts.length === 1) {
        const p1 = pts[0];
        const p2 = { x: point.x, y: point.y, z: point.z };
        setMeasurePoints([p1, p2]);
        const dist = point.distanceTo(new THREE.Vector3(p1.x, p1.y, p1.z));
        setStatusMessage(`Distance: ${dist.toFixed(3)} ${u}`);
      } else {
        // Already have 2 points — start a new measurement
        setMeasurePoints([{ x: point.x, y: point.y, z: point.z }]);
        setStatusMessage('New measurement — click second point');
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMeasurePoints([]);
        setMousePos(null);
        setStatusMessage('Measure cancelled');
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
    // measurePoints and units read via getState() inside handlers to avoid
    // tearing down listeners on every point placement or unit change.
  }, [activeTool, getWorldPoint, setMeasurePoints, setStatusMessage, gl]);

  // Draw measurement line / preview in the scene.
  // All objects (dots, line) are stable refs — no per-frame allocation.
  useFrame(() => {
    if (!previewRef.current) return;
    previewRef.current.userData.measurePreview = true;

    const group = previewRef.current;
    // Remove reusable objects before clearGroupChildren so their shared
    // geometry/material doesn't get disposed.
    group.remove(dot1Ref.current);
    group.remove(dot2Ref.current);
    group.remove(lineRef.current);
    clearGroupChildren(group, { disposeMeshMaterial: false });

    if (activeTool !== 'measure') return;

    // Read latest measurePoints from store to avoid stale closure issues
    const pts = useCADStore.getState().measurePoints;
    if (pts.length >= 1) {
      const p1v = _p1Scratch.current.set(pts[0].x, pts[0].y, pts[0].z);
      dot1Ref.current.position.copy(p1v);
      group.add(dot1Ref.current);

      const endPoint = pts.length >= 2
        ? _endScratch.current.set(pts[1].x, pts[1].y, pts[1].z)
        : mousePos;

      if (endPoint) {
        // Mutate the pre-allocated position buffer in-place — no per-frame allocation.
        const arr = linePosArrayRef.current;
        arr[0] = p1v.x; arr[1] = p1v.y; arr[2] = p1v.z;
        arr[3] = endPoint.x; arr[4] = endPoint.y; arr[5] = endPoint.z;
        if (linePosAttrRef.current) linePosAttrRef.current.needsUpdate = true;
        group.add(lineRef.current);

        if (pts.length >= 2) {
          dot2Ref.current.position.copy(endPoint);
          group.add(dot2Ref.current);
        }
      }
    }
  });

  if (activeTool !== 'measure') return null;

  const p1 = measurePoints.length >= 1 ? new THREE.Vector3(measurePoints[0].x, measurePoints[0].y, measurePoints[0].z) : null;
  const p2 = measurePoints.length >= 2 ? new THREE.Vector3(measurePoints[1].x, measurePoints[1].y, measurePoints[1].z) : null;

  // Compute midpoint for the distance label
  const showLabel = p1 && (p2 || mousePos);
  const labelEnd = p2 || mousePos;
  const midpoint = showLabel ? p1.clone().add(labelEnd!).multiplyScalar(0.5) : null;
  const dist = showLabel ? p1.distanceTo(labelEnd!) : 0;

  return (
    <>
      <group ref={previewRef} />
      {midpoint && dist > 0.001 && (
        <Html position={midpoint} center zIndexRange={[200, 0]}>
          <div className="measure-label-3d">{dist.toFixed(3)} {units}</div>
        </Html>
      )}
    </>
  );
}

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

  useEffect(() => {
    const m1 = matRef.current;
    const m2 = dashedRef.current;
    return () => { m1.dispose(); m2.dispose(); };
  }, []);

  // Raycast against scene geometry + ground plane fallback
  const getWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);

    // Try to hit meshes in the scene first
    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj);
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
        if (measurePoints.length === 0) {
          setStatusMessage(`Measure: click first point — ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
        } else if (measurePoints.length === 1) {
          const p1 = measurePoints[0];
          const dist = point.distanceTo(new THREE.Vector3(p1.x, p1.y, p1.z));
          setStatusMessage(`Distance: ${dist.toFixed(3)} ${units} — click to confirm`);
        }
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = getWorldPoint(event);
      if (!point) return;

      if (measurePoints.length === 0) {
        setMeasurePoints([{ x: point.x, y: point.y, z: point.z }]);
        setStatusMessage('First point set — click second point');
      } else if (measurePoints.length === 1) {
        const p1 = measurePoints[0];
        const p2 = { x: point.x, y: point.y, z: point.z };
        setMeasurePoints([p1, p2]);
        const dist = point.distanceTo(new THREE.Vector3(p1.x, p1.y, p1.z));
        setStatusMessage(`Distance: ${dist.toFixed(3)} ${units}`);
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
  }, [activeTool, measurePoints, getWorldPoint, setMeasurePoints, setStatusMessage, units, gl]);

  // Draw measurement line / preview in the scene
  useFrame(() => {
    if (!previewRef.current) return;
    clearGroupChildren(previewRef.current, { disposeMeshMaterial: true });

    if (activeTool !== 'measure') return;

    const mat = matRef.current;

    // Helper to add a small sphere at a point
    const addDot = (pos: THREE.Vector3) => {
      const geo = new THREE.SphereGeometry(0.3, 8, 8);
      const meshMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
      const m = new THREE.Mesh(geo, meshMat);
      m.position.copy(pos);
      m.renderOrder = 999;
      previewRef.current!.add(m);
    };

    if (measurePoints.length >= 1) {
      const p1v = new THREE.Vector3(measurePoints[0].x, measurePoints[0].y, measurePoints[0].z);
      addDot(p1v);

      const endPoint = measurePoints.length >= 2
        ? new THREE.Vector3(measurePoints[1].x, measurePoints[1].y, measurePoints[1].z)
        : mousePos;

      if (endPoint) {
        // Line between points
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1v, endPoint]);
        previewRef.current!.add(new THREE.Line(lineGeo, mat));
        if (measurePoints.length >= 2) addDot(endPoint);
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

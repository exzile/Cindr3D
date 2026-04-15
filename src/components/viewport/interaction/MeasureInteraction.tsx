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
  // Scratch Vector3s for useFrame — avoids per-frame allocation
  const _p1Scratch = useRef(new THREE.Vector3());
  const _endScratch = useRef(new THREE.Vector3());

  useEffect(() => {
    // Assign geometry + material to the reusable meshes once
    dot1Ref.current.geometry = dotGeoRef.current;
    dot1Ref.current.material = dotMatRef.current;
    dot1Ref.current.renderOrder = 999;
    dot2Ref.current.geometry = dotGeoRef.current;
    dot2Ref.current.material = dotMatRef.current;
    dot2Ref.current.renderOrder = 999;

    const m1 = matRef.current;
    const m2 = dashedRef.current;
    const g = dotGeoRef.current;
    const dm = dotMatRef.current;
    return () => { m1.dispose(); m2.dispose(); g.dispose(); dm.dispose(); };
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
    // Remove reusable dot meshes first so clearGroupChildren won't dispose their shared geometry
    previewRef.current.remove(dot1Ref.current);
    previewRef.current.remove(dot2Ref.current);
    clearGroupChildren(previewRef.current, { disposeMeshMaterial: false });

    if (activeTool !== 'measure') return;

    const mat = matRef.current;
    const group = previewRef.current;

    if (measurePoints.length >= 1) {
      const p1v = _p1Scratch.current.set(measurePoints[0].x, measurePoints[0].y, measurePoints[0].z);
      dot1Ref.current.position.copy(p1v);
      group.add(dot1Ref.current);

      const endPoint = measurePoints.length >= 2
        ? _endScratch.current.set(measurePoints[1].x, measurePoints[1].y, measurePoints[1].z)
        : mousePos;

      if (endPoint) {
        // Line between 2 points — geometry recreated per frame (2 verts, minimal GC)
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1v, endPoint]);
        const line = new THREE.Line(lineGeo, mat);
        group.add(line);
        if (measurePoints.length >= 2) {
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

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

interface OrbitControlsLike {
  target?: THREE.Vector3;
  update?: () => void;
}

export default function CameraController({ onQuaternionChange }: { onQuaternionChange: (q: THREE.Quaternion) => void }) {
  const { camera, controls, scene } = useThree();
  const cameraHomeCounter = useCADStore((s) => s.cameraHomeCounter);
  const zoomToFitCounter = useCADStore((s) => s.zoomToFitCounter);
  const zoomWindowTrigger = useCADStore((s) => s.zoomWindowTrigger);
  const clearZoomWindow = useCADStore((s) => s.clearZoomWindow);
  const cameraTargetQuaternion = useCADStore((s) => s.cameraTargetQuaternion);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const cameraTargetOrbit = useCADStore((s) => s.cameraTargetOrbit);
  const setCameraTargetOrbit = useCADStore((s) => s.setCameraTargetOrbit);
  const animatingRef = useRef(false);
  const animProgressRef = useRef(0);
  const startQuatRef = useRef(new THREE.Quaternion());
  const targetQuatRef = useRef(new THREE.Quaternion());
  // Orbit pivot lerp endpoints + radii captured on animation start.
  const startOrbitRef = useRef(new THREE.Vector3());
  const endOrbitRef = useRef(new THREE.Vector3());
  const startDistanceRef = useRef(0);
  const endDistanceRef = useRef(0);
  // Stable scratch objects — reused every frame to avoid per-frame GC pressure
  const _q = useRef(new THREE.Quaternion());
  const _dir = useRef(new THREE.Vector3());
  const _orbit = useRef(new THREE.Vector3());

  // Home button
  useEffect(() => {
    if (cameraHomeCounter === 0) return;
    const target = new THREE.Vector3(0, 0, 0);
    camera.position.set(50, 50, 50);
    camera.lookAt(target);
    const orbitControls = controls as OrbitControlsLike;
    if (orbitControls?.target) {
      orbitControls.target.copy(target);
      orbitControls.update?.();
    }
  }, [cameraHomeCounter, camera, controls]);

  // Zoom to Fit
  useEffect(() => {
    if (zoomToFitCounter === 0) return;
    const box = new THREE.Box3();
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.visible) {
        box.expandByObject(mesh);
      }
    });
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 1.2;
    const orbitControls = controls as OrbitControlsLike;
    if (orbitControls?.target) {
      orbitControls.target.copy(center);
    }
    const dir = camera.position.clone().sub(center).normalize();
    camera.position.copy(center).addScaledVector(dir, radius * 2);
    orbitControls?.update?.();
  }, [zoomToFitCounter, scene, camera, controls]);

  // Zoom Window (NAV-5): move camera to frame the chosen screen rect
  useEffect(() => {
    if (!zoomWindowTrigger) return;
    clearZoomWindow();
    const { x1, y1, x2, y2, vpW, vpH } = zoomWindowTrigger;
    const rectW = x2 - x1;
    const rectH = y2 - y1;
    if (rectW < 5 || rectH < 5) return;

    // How much to zoom: smaller dim of rect vs viewport drives zoom factor
    const zoomFactor = Math.min(vpW / rectW, vpH / rectH);

    // Rect center in NDC
    const ndcX = ((x1 + x2) / 2 / vpW) * 2 - 1;
    const ndcY = -((y1 + y2) / 2 / vpH) * 2 + 1;

    const orbitControls = controls as OrbitControlsLike;
    const currentTarget = (orbitControls?.target as THREE.Vector3 | undefined) ?? new THREE.Vector3();
    const currentDistance = camera.position.distanceTo(currentTarget);

    // Cast a ray through the rect center to find the new orbit target depth
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const newTarget = raycaster.ray.at(currentDistance, new THREE.Vector3());

    // New camera distance: zoom in by factor
    const newDistance = currentDistance / zoomFactor;
    const dir = camera.position.clone().sub(currentTarget).normalize();
    const newPos = newTarget.clone().addScaledVector(dir, newDistance);

    camera.position.copy(newPos);
    if (orbitControls?.target) orbitControls.target.copy(newTarget);
    orbitControls?.update?.();
  }, [zoomWindowTrigger, camera, controls, clearZoomWindow]);

  // Start animation when a target quaternion is set (ViewCube click / sketch entry)
  useEffect(() => {
    if (!cameraTargetQuaternion) return;
    startQuatRef.current.copy(camera.quaternion);
    targetQuatRef.current.copy(cameraTargetQuaternion);

    // Capture orbit pivot endpoints. If a cameraTargetOrbit was supplied (e.g.
    // sketch entry), lerp the pivot toward it; otherwise hold the current pivot.
    const orbitControls = controls as OrbitControlsLike;
    const currentOrbit = (orbitControls?.target as THREE.Vector3 | undefined) ?? new THREE.Vector3();
    startOrbitRef.current.copy(currentOrbit);
    endOrbitRef.current.copy(cameraTargetOrbit ?? currentOrbit);

    // Snapshot radii so the lerp is jump-free at t=0 and lands cleanly at t=1:
    //   t=0 → orbit=startOrbit, distance=startDistance → camera stays put
    //   t=1 → orbit=endOrbit,   distance=endDistance   → camera circles endOrbit
    startDistanceRef.current = camera.position.distanceTo(startOrbitRef.current);
    endDistanceRef.current = camera.position.distanceTo(endOrbitRef.current);

    animProgressRef.current = 0;
    animatingRef.current = true;
    setCameraTargetQuaternion(null);
    if (cameraTargetOrbit) setCameraTargetOrbit(null);
  }, [cameraTargetQuaternion, cameraTargetOrbit, camera, controls, setCameraTargetQuaternion, setCameraTargetOrbit]);

  useFrame((_, delta) => {
    onQuaternionChange(camera.quaternion);

    if (!animatingRef.current) return;
    animProgressRef.current = Math.min(animProgressRef.current + delta * 3.0, 1);
    const t = 1 - Math.pow(1 - animProgressRef.current, 3); // ease-out cubic

    // Slerp camera quaternion — reuse scratch refs, no per-frame allocation
    _q.current.slerpQuaternions(startQuatRef.current, targetQuatRef.current, t);

    // Lerp orbit pivot toward the requested endpoint (e.g. sketch origin) so
    // the camera ends up circling the sketch plane instead of whatever pivot
    // the user had panned to. Distance is lerped on the same curve to keep
    // the transition jump-free at t=0 and exact at t=1.
    _orbit.current.lerpVectors(startOrbitRef.current, endOrbitRef.current, t);
    const distance = startDistanceRef.current + (endDistanceRef.current - startDistanceRef.current) * t;
    _dir.current.set(0, 0, 1).applyQuaternion(_q.current).normalize();
    camera.position.copy(_orbit.current).add(_dir.current.multiplyScalar(distance));
    camera.quaternion.copy(_q.current);

    const orbitControls = controls as OrbitControlsLike;
    if (orbitControls?.target) {
      orbitControls.target.copy(_orbit.current);
    }
    if (orbitControls?.update) {
      orbitControls.update();
    }

    if (animProgressRef.current >= 1) {
      animatingRef.current = false;
    }
  });

  return null;
}

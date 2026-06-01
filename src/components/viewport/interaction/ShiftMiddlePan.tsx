import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// ── Shift + Middle-Mouse-Button pan handler ─────────────────────────────────
// OrbitControls maps middle button to dolly. This component intercepts
// Shift+Middle drag and converts it to panning (moves camera + target together).
export default function ShiftMiddlePan() {
  const { gl, camera, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;
  const rightRef = useRef(new THREE.Vector3());
  const upRef = useRef(new THREE.Vector3());
  const panRef = useRef(new THREE.Vector3());
  const originRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const canvas = gl.domElement;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let rectHeight = 1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        rectHeight = canvas.getBoundingClientRect().height || 1;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        if (controls) controls.enabled = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const target = controls ? controls.target : originRef.current.set(0, 0, 0);
      const dist = camera.position.distanceTo(target);
      // Scale pan speed with distance so it feels consistent at any zoom level
      const scale = (dist / rectHeight) * 2;

      // Build right/up vectors from camera orientation
      const right = rightRef.current.setFromMatrixColumn(camera.matrixWorld, 0);
      const up = upRef.current.setFromMatrixColumn(camera.matrixWorld, 1);
      const pan = panRef.current
        .copy(right)
        .multiplyScalar(-dx * scale)
        .addScaledVector(up, dy * scale);

      camera.position.add(pan);
      if (controls) {
        controls.target.add(pan);
        controls.update();
      }
      invalidate();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 1 && panning) {
        panning = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (controls) controls.enabled = true;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (controls) controls.enabled = true;
    };
  }, [gl, camera, controls, invalidate]);

  return null;
}

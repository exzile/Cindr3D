import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// ── Shift + Middle-Mouse-Button pan handler ─────────────────────────────────
// OrbitControls maps middle button to dolly. This component intercepts
// Shift+Middle drag and converts it to panning (moves camera + target together).
export default function ShiftMiddlePan() {
  const { gl, camera } = useThree();
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;

  useEffect(() => {
    const canvas = gl.domElement;
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
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

      const rect = canvas.getBoundingClientRect();
      const target = controls ? controls.target : new THREE.Vector3();
      const dist = camera.position.distanceTo(target);
      // Scale pan speed with distance so it feels consistent at any zoom level
      const scale = (dist / rect.height) * 2;

      // Build right/up vectors from camera orientation
      const right = new THREE.Vector3();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3();
      up.setFromMatrixColumn(camera.matrixWorld, 1);

      const pan = right.multiplyScalar(-dx * scale).add(
        up.multiplyScalar(dy * scale)
      );

      camera.position.add(pan);
      if (controls) {
        controls.target.add(pan);
        controls.update();
      }
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
  }, [gl, camera, controls]);

  return null;
}

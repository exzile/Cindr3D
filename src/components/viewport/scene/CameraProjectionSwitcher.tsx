import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

/**
 * NAV-20: Switches the active camera between perspective and orthographic.
 * Preserves camera position/quaternion across the switch.
 * Mounts inside <Canvas> so useThree() is available.
 */
export default function CameraProjectionSwitcher() {
  const { camera, set, size } = useThree();
  const cameraProjection = useCADStore((s) => s.cameraProjection);
  // Prevent double-switching on first mount if projection matches camera type
  const lastProjectionRef = useRef<string | null>(null);

  useEffect(() => {
    // Detect current camera type
    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    const currentType = isOrtho ? 'orthographic' : 'perspective';
    if (lastProjectionRef.current === cameraProjection) return;
    if (currentType === cameraProjection) {
      lastProjectionRef.current = cameraProjection;
      return;
    }
    lastProjectionRef.current = cameraProjection;

    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();

    if (cameraProjection === 'orthographic') {
      // Compute frustum half-height from perspective camera's fov + distance to origin
      const perspCam = camera as THREE.PerspectiveCamera;
      const fov = perspCam.fov ?? 45;
      const distance = pos.length() || 100;
      const halfH = distance * Math.tan((fov * Math.PI / 180) / 2);
      const aspect = size.width / size.height;
      const newCam = new THREE.OrthographicCamera(
        -halfH * aspect, halfH * aspect, halfH, -halfH, 0.01, 100000
      );
      newCam.zoom = 1;
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      newCam.updateProjectionMatrix();
      set({ camera: newCam });
    } else {
      const newCam = new THREE.PerspectiveCamera(45, size.width / size.height, 0.01, 100000);
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      newCam.updateProjectionMatrix();
      set({ camera: newCam });
    }
  }, [cameraProjection, camera, set, size]);

  return null;
}

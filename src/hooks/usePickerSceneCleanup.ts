import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Picker components imperatively add hover / selected / preview meshes to
 * the scene from `useFrame`, and tear them down inside the `!enabled`
 * branch. That works while the dialog is open — but if the picker
 * component itself unmounts (HMR, parent route swap, viewport teardown,
 * Strict Mode double-mount) the `useFrame` never reaches its cleanup
 * branch, leaving the meshes stranded as orphan children of the scene
 * with un-disposed BufferGeometries.
 *
 * This hook registers an unmount effect that walks the supplied refs,
 * removes any live mesh from the scene, and disposes its geometry.
 * Materials are skipped — pickers use module-level singletons whose
 * disposal would poison the next picker that mounts.
 *
 * Usage:
 *   const hoverRef = useRef<THREE.Object3D | null>(null);
 *   const selectedRef = useRef<THREE.Object3D | null>(null);
 *   usePickerSceneCleanup([hoverRef, selectedRef]);
 */
export function usePickerSceneCleanup(
  refs: Array<React.MutableRefObject<THREE.Object3D | null>>,
): void {
  const { scene } = useThree();
  useEffect(() => {
    return () => {
      for (const ref of refs) {
        const obj = ref.current;
        if (!obj) continue;
        scene.remove(obj);
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
            const geo = (child as THREE.Mesh).geometry;
            geo?.dispose?.();
          }
        });
        ref.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

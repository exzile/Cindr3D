import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCADStore } from '../../../store/cadStore';

// Singleton override materials — never disposed (shared across renders)
const WIREFRAME_MAT = new THREE.MeshBasicMaterial({ wireframe: true, color: 0x666666 });
const HIDDEN_LINES_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide });

/**
 * R3F scene component that applies Three.js scene.overrideMaterial based on
 * the visualStyle store value. 'shaded' and 'shadedEdges' clear the override.
 * NAV-10: wires the Display Settings visual style picker to actual rendering.
 */
export default function VisualStyleEffect() {
  const { scene } = useThree();
  const visualStyle = useCADStore((s) => s.visualStyle);

  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- Three.js scene property, not React state */
    switch (visualStyle) {
      case 'wireframe':
        scene.overrideMaterial = WIREFRAME_MAT;
        break;
      case 'hiddenLines':
        scene.overrideMaterial = HIDDEN_LINES_MAT;
        break;
      default:
        scene.overrideMaterial = null;
        break;
    }
    return () => { scene.overrideMaterial = null; };
    /* eslint-enable react-hooks/immutability */
  }, [scene, visualStyle]);

  return null;
}

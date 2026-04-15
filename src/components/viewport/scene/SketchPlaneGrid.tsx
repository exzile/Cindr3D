import { useEffect, useMemo } from 'react';
import { Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useThemeStore } from '../../../store/themeStore';

/**
 * Grid shown while a sketch is active — aligned to the sketch plane.
 *
 * Uses THREE.GridHelper (line-based, no shader tricks) so it renders correctly
 * for every orientation including vertical planes (XZ, YZ).
 *
 * GridHelper lies in the Three.js XZ ground plane (Y-normal) by default.
 * We wrap it in a <group> and rotate to match our sketch-plane conventions:
 *   XY  horizontal, Y-normal    → group rotation [0,     0, 0    ]
 *   XZ  vertical front, Z-normal → group rotation [-PI/2, 0, 0    ]
 *   YZ  vertical side,  X-normal → group rotation [0,     0, PI/2 ]
 */
export default function SketchPlaneGrid({
  plane,
  customNormal,
  customOrigin,
}: {
  plane: 'XY' | 'XZ' | 'YZ' | 'custom';
  customNormal?: THREE.Vector3;
  customOrigin?: THREE.Vector3;
}) {
  const themeColors = useThemeStore((s) => s.colors);

  const helper = useMemo(
    () => new THREE.GridHelper(1000, 100, themeColors.gridSection, themeColors.gridCell),
    [themeColors.gridSection, themeColors.gridCell],
  );

  useEffect(() => {
    return () => {
      helper.geometry.dispose();
      const mats = Array.isArray(helper.material) ? helper.material : [helper.material];
      (mats as THREE.Material[]).forEach((m) => m.dispose());
    };
  }, [helper]);

  if (plane === 'custom' && customNormal && customOrigin) {
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      customNormal.clone().normalize(),
    );
    return (
      <group position={customOrigin} quaternion={quat}>
        <primitive object={helper} />
      </group>
    );
  }

  const groupRotation: [number, number, number] =
    plane === 'XZ' ? [-Math.PI / 2, 0, 0] :
    plane === 'YZ' ? [0,            0, Math.PI / 2] :
    [0, 0, 0]; // XY

  return (
    <group rotation={groupRotation}>
      <primitive object={helper} />
    </group>
  );
}

/** Infinite ground-plane grid with fading (shown in 3-D mode only) */
export function GroundPlaneGrid() {
  const themeColors = useThemeStore((s) => s.colors);

  return (
    <Grid
      args={[300, 300]}
      cellSize={1}
      cellThickness={0.5}
      cellColor={themeColors.gridCell}
      sectionSize={10}
      sectionThickness={1}
      sectionColor={themeColors.gridSection}
      fadeDistance={200}
      fadeStrength={1.5}
      fadeFrom={0}
      followCamera={false}
      infiniteGrid
    />
  );
}

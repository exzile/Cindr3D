import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThemeStore } from '../../../store/themeStore';
import { useCADStore } from '../../../store/cadStore';

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
  const globalGridSize = useCADStore((s) => s.gridSize);
  const sketchGridSize = useCADStore((s) => s.sketchGridSize);
  const cellSize = sketchGridSize ?? globalGridSize;
  // GridHelper(size, divisions) — keep total size at 1000, divisions = total/cellSize
  const divisions = Math.round(Math.max(10, Math.min(500, 1000 / cellSize)));

  const helper = useMemo(
    () => new THREE.GridHelper(1000, divisions, themeColors.gridSection, themeColors.gridCell),
    [divisions, themeColors.gridSection, themeColors.gridCell],
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

/** Ground-plane grid shown outside sketch mode. */
export function GroundPlaneGrid() {
  const themeColors = useThemeStore((s) => s.colors);
  const gridSize = useCADStore((s) => s.gridSize);

  const helper = useMemo(() => {
    const size = 300;
    const divisions = Math.max(20, Math.min(150, Math.round(size / Math.max(0.1, gridSize))));
    const grid = new THREE.GridHelper(size, divisions, themeColors.gridSection, themeColors.gridCell);
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.58;
      material.depthWrite = false;
    });
    return grid;
  }, [gridSize, themeColors.gridCell, themeColors.gridSection]);

  useEffect(() => {
    return () => {
      helper.geometry.dispose();
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => material.dispose());
    };
  }, [helper]);

  return <primitive object={helper} />;
}

import { useCallback, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { computeStats, deviationColorThree, divergingColorThree } from '../utils';
import type { HeightMapData, HoverInfo } from './types';

export function HeightMapMesh({
  heightMap,
  diverging = false,
  scaleXY: scaleXYProp,
  mirrorX = false,
  onHover,
}: {
  heightMap: HeightMapData;
  diverging?: boolean;
  /** Shared scene scale — pass from Scene3D so all components use the same space. */
  scaleXY?: number;
  mirrorX?: boolean;
  onHover?: (info: HoverInfo | null) => void;
}) {
  const { geometry, scaleXY } = useMemo(() => {
    const stats = computeStats(heightMap);
    const geo = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
    const zScale = (1 / Math.max(Math.abs(stats.max), Math.abs(stats.min), 0.01)) * 0.3;
    const colorFn = diverging ? divergingColorThree : deviationColorThree;
    const sx = (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5);

    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const value = heightMap.points[yi]?.[xi] ?? 0;
        const x = sx(heightMap.xMin + xi * heightMap.xSpacing);
        const y = (heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5;
        vertices.push(x, value * zScale, -y);
        const color = colorFn(value, stats.min, stats.max);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let yi = 0; yi < heightMap.numY - 1; yi++) {
      for (let xi = 0; xi < heightMap.numX - 1; xi++) {
        const a = yi * heightMap.numX + xi;
        const b = a + 1;
        const c = a + heightMap.numX;
        const d = c + 1;
        // Winding flips with X mirror — swap to keep normals facing up
        if (mirrorX) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return { geometry: geo, scaleXY };
  }, [heightMap, diverging, scaleXYProp, mirrorX]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!onHover) return;
    e.stopPropagation();
    const scale = 1 / scaleXY;
    // Reverse the scene-space normalisation (accounting for optional X mirror):
    //   normal:   x_scene = bedX * scaleXY - 0.5  →  bedX = (x_scene + 0.5) / scaleXY
    //   mirrored: x_scene = 0.5 - bedX * scaleXY  →  bedX = (0.5 - x_scene) / scaleXY
    const bedX = mirrorX ? (0.5 - e.point.x) * scale : (e.point.x + 0.5) * scale;
    const bedY = (0.5 - e.point.z) * scale;
    // Snap to the nearest grid cell for the exact stored value
    const xi = Math.max(0, Math.min(heightMap.numX - 1,
      Math.round((bedX - heightMap.xMin) / heightMap.xSpacing)));
    const yi = Math.max(0, Math.min(heightMap.numY - 1,
      Math.round((bedY - heightMap.yMin) / heightMap.ySpacing)));
    const value = heightMap.points[yi]?.[xi] ?? 0;
    onHover({ bedX, bedY, value, screenX: e.nativeEvent.clientX, screenY: e.nativeEvent.clientY });
  }, [onHover, heightMap, scaleXY, mirrorX]);

  return (
    <mesh
      geometry={geometry}
      renderOrder={0}
      onPointerMove={onHover ? handlePointerMove : undefined}
    >
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.08} />
    </mesh>
  );
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { HeightMapData } from './types';

/** Surface-following wireframe overlay drawn on top of the deviation mesh. */
export function GridOverlay({
  heightMap,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  const geo = useMemo(() => {
    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);

    // Recompute zScale identically to HeightMapMesh so the grid sits on the surface
    let minV = Infinity, maxV = -Infinity;
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const v = heightMap.points[yi]?.[xi] ?? 0;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    const zScale = (1 / Math.max(Math.abs(maxV), Math.abs(minV), 0.01)) * 0.3;
    const LIFT = 0.0018; // tiny offset to prevent z-fighting with the mesh face

    // World-space → normalised-scene coordinate helpers
    const wx = (xi: number) => mirrorX
      ? 0.5 - (heightMap.xMin + xi * heightMap.xSpacing) * scaleXY
      : (heightMap.xMin + xi * heightMap.xSpacing) * scaleXY - 0.5;
    const wz = (yi: number) => -((heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5);
    const wy = (xi: number, yi: number) => (heightMap.points[yi]?.[xi] ?? 0) * zScale + LIFT;

    // Build flat position array — always in pairs so lineSegments never mis-pairs rows
    const pos: number[] = [];

    // Horizontal edges: xi → xi+1 at constant yi
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX - 1; xi++) {
        pos.push(wx(xi),     wy(xi,     yi), wz(yi));
        pos.push(wx(xi + 1), wy(xi + 1, yi), wz(yi));
      }
    }

    // Vertical edges: yi → yi+1 at constant xi
    for (let xi = 0; xi < heightMap.numX; xi++) {
      for (let yi = 0; yi < heightMap.numY - 1; yi++) {
        pos.push(wx(xi), wy(xi, yi),     wz(yi));
        pos.push(wx(xi), wy(xi, yi + 1), wz(yi + 1));
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [heightMap, scaleXYProp, mirrorX]);

  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <lineSegments geometry={geo} renderOrder={3}>
      <lineBasicMaterial color="#6b7280" opacity={0.55} transparent />
    </lineSegments>
  );
}

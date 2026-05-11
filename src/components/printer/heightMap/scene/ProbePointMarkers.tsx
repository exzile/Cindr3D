import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ConfiguredProbeGrid, HeightMapData, HoverInfo } from './types';

/**
 * Probe point markers — yellow spheres on the plate surface.
 *
 * One InstancedMesh draw call for all spheres.
 * Bottom of each sphere rests on the plate top face (y=0).
 * When `configuredGrid` is supplied the markers reflect the user-configured
 * M557 settings rather than the (potentially stale) loaded CSV grid.
 */
export function ProbePointMarkers({
  heightMap,
  configuredGrid,
  scaleXY: scaleXYProp,
  radiusScale = 1,
  mirrorX = false,
  onHover,
}: {
  heightMap: HeightMapData;
  configuredGrid?: ConfiguredProbeGrid;
  scaleXY?: number;
  radiusScale?: number;
  mirrorX?: boolean;
  onHover?: (info: HoverInfo | null) => void;
}) {
  const meshRef  = useRef<THREE.InstancedMesh>(null);
  const _dummy   = useRef(new THREE.Object3D());

  const { radius, positions, count, numX: gridNumX } = useMemo(() => {
    const xRange  = heightMap.xMax - heightMap.xMin;
    const yRange  = heightMap.yMax - heightMap.yMin;
    const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
    const smx = (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5);

    if (configuredGrid) {
      // Show where the probes *will* go based on the configured M557 settings.
      const { xMin, xMax, yMin, yMax, numPoints } = configuredGrid;
      const n = Math.max(numPoints, 1);
      const spacingX = n > 1 ? (xMax - xMin) / (n - 1) : 0;
      const spacingY = n > 1 ? (yMax - yMin) / (n - 1) : 0;
      const cellW = (n > 1 ? spacingX : (xMax - xMin)) * scaleXY;
      const cellH = (n > 1 ? spacingY : (yMax - yMin)) * scaleXY;
      const r = Math.min(cellW, cellH, 0.04) * 0.07 * radiusScale;

      const pos: [number, number, number][] = [];
      for (let yi = 0; yi < n; yi++) {
        for (let xi = 0; xi < n; xi++) {
          const bx = xMin + xi * spacingX;
          const by = yMin + yi * spacingY;
          const sx = smx(bx);
          const sz = -(by * scaleXY - 0.5);
          pos.push([sx, r, sz]);
        }
      }
      return { radius: r, positions: pos, count: pos.length, numX: n };
    }

    // Fall back to the loaded height-map grid.
    const cellW  = heightMap.xSpacing * scaleXY;
    const cellH  = heightMap.ySpacing * scaleXY;
    const r = Math.min(cellW, cellH) * 0.07 * radiusScale;

    const pos: [number, number, number][] = [];
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const x = smx(heightMap.xMin + xi * heightMap.xSpacing);
        const z = -((heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5);
        // y = radius so the sphere's bottom rests exactly on the plate top face
        pos.push([x, r, z]);
      }
    }
    return { radius: r, positions: pos, count: pos.length, numX: heightMap.numX };
  }, [heightMap, configuredGrid, scaleXYProp, radiusScale, mirrorX]);

  // Place each instance. Runs once after mount and again whenever positions change.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = _dummy.current;
    for (let i = 0; i < positions.length; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!onHover || e.instanceId === undefined) return;
    e.stopPropagation();
    const xi = e.instanceId % gridNumX;
    const yi = Math.floor(e.instanceId / gridNumX);
    let bedX: number, bedY: number, value: number;
    if (configuredGrid) {
      const { xMin, xMax, yMin, yMax, numPoints } = configuredGrid;
      const n = Math.max(numPoints, 1);
      const spacingX = n > 1 ? (xMax - xMin) / (n - 1) : 0;
      const spacingY = n > 1 ? (yMax - yMin) / (n - 1) : 0;
      bedX = xMin + xi * spacingX;
      bedY = yMin + yi * spacingY;
      // Snap to nearest point in loaded map for height value (best-effort)
      const mxi = Math.max(0, Math.min(heightMap.numX - 1, Math.round((bedX - heightMap.xMin) / (heightMap.xSpacing || 1))));
      const myi = Math.max(0, Math.min(heightMap.numY - 1, Math.round((bedY - heightMap.yMin) / (heightMap.ySpacing || 1))));
      value = heightMap.points[myi]?.[mxi] ?? 0;
    } else {
      bedX = heightMap.xMin + xi * heightMap.xSpacing;
      bedY = heightMap.yMin + yi * heightMap.ySpacing;
      value = heightMap.points[yi]?.[xi] ?? 0;
    }
    onHover({
      bedX, bedY, value,
      screenX: e.nativeEvent.clientX,
      screenY: e.nativeEvent.clientY,
      isProbePoint: true,
      gridX: xi + 1,
      gridY: yi + 1,
    });
  }, [onHover, heightMap, configuredGrid, gridNumX]);

  return (
    // R3F owns geometry/material lifecycle here; args only recreated when count changes
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      onPointerMove={onHover ? handlePointerMove : undefined}
    >
      <sphereGeometry args={[radius, 12, 8]} />
      <meshStandardMaterial
        color="#fbbf24"
        roughness={0.30}
        metalness={0.08}
        emissive="#d97706"
        emissiveIntensity={0.3}
      />
    </instancedMesh>
  );
}

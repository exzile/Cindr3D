import { useCallback, useEffect, useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { computeNiceTicks } from './niceTicks';
import type { BedBounds, ConfiguredProbeGrid, HeightMapData } from './types';

/**
 * X / Y bed rulers.
 *
 * Two rulers sit just below the glass plate:
 *   X ruler — along the front edge of the bed, running left→right
 *   Y ruler — along the left edge of the bed,  running front→back
 *
 * Coordinate convention (mirrors HeightMapMesh / FlatPlate):
 *   scene_x =  bedX * scaleXY - 0.5
 *   scene_z = -(bedY * scaleXY - 0.5)   (Y axis is negated)
 */
export function XYRulers({
  heightMap,
  configuredGrid,
  bedBounds,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  configuredGrid?: ConfiguredProbeGrid;
  bedBounds?: BedBounds;
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  const xRange  = heightMap.xMax - heightMap.xMin;
  const yRange  = heightMap.yMax - heightMap.yMin;
  const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);

  // Rulers span the physical bed (M208) when available, otherwise probe grid or CSV
  const bedXMin = bedBounds?.xMin ?? configuredGrid?.xMin ?? heightMap.xMin;
  const bedXMax = bedBounds?.xMax ?? configuredGrid?.xMax ?? heightMap.xMax;
  const bedYMin = bedBounds?.yMin ?? configuredGrid?.yMin ?? heightMap.yMin;
  const bedYMax = bedBounds?.yMax ?? configuredGrid?.yMax ?? heightMap.yMax;

  // Scene-space X coordinate for a bed X value (respects mirrorX)
  const toSceneX = useCallback(
    (bx: number) => mirrorX ? (0.5 - bx * scaleXY) : (bx * scaleXY - 0.5),
    [mirrorX, scaleXY],
  );

  // Scene-space edges of the plate
  const xL = toSceneX(bedXMin); // left in scene (bedXMin normal, bedXMax mirrored)
  const xR = toSceneX(bedXMax); // right in scene (bedXMax normal, bedXMin mirrored)
  // Ensure xL < xR when mirrored (bed values reversed, so swap)
  const sceneXLeft  = mirrorX ? xR : xL;
  const sceneXRight = mirrorX ? xL : xR;
  const zF = -(bedYMin * scaleXY - 0.5); // front (larger Z)
  const zB = -(bedYMax * scaleXY - 0.5); // back  (smaller Z)

  const BELOW  = -0.022; // y-level of the ruler lines (just below plate)
  const TICK   =  0.016; // tick length (extends downward)
  const INDENT =  0.040; // gap between bed edge and ruler line

  const zRuler = zF + INDENT; // X ruler sits in front of the bed
  // Y ruler: left of bed (normal) or right of bed (mirrored — X=0 is on the right)
  const xRuler = mirrorX ? (sceneXRight + INDENT) : (sceneXLeft - INDENT);

  const xTicks = useMemo(
    () => computeNiceTicks(bedXMin, bedXMax, 5),
    [bedXMin, bedXMax],
  );
  const yTicks = useMemo(
    () => computeNiceTicks(bedYMin, bedYMax, 5),
    [bedYMin, bedYMax],
  );

  const lineGeo = useMemo(() => {
    const pts: number[] = [];
    const ENDCAP = 0.010; // perpendicular end-cap half-length

    // ── X ruler ───────────────────────────────────────────────────────
    // Spine (always from sceneXLeft to sceneXRight)
    pts.push(sceneXLeft, BELOW, zRuler,   sceneXRight, BELOW, zRuler);
    // End caps (perpendicular in Z)
    pts.push(sceneXLeft,  BELOW, zRuler - ENDCAP,  sceneXLeft,  BELOW, zRuler + ENDCAP);
    pts.push(sceneXRight, BELOW, zRuler - ENDCAP,  sceneXRight, BELOW, zRuler + ENDCAP);
    // Ticks (downward in Y)
    for (const v of xTicks) {
      const x = toSceneX(v);
      pts.push(x, BELOW, zRuler,  x, BELOW - TICK, zRuler);
    }

    // ── Y ruler ───────────────────────────────────────────────────────
    // Spine (from front to back in scene space: zF → zB)
    pts.push(xRuler, BELOW, zF,   xRuler, BELOW, zB);
    // End caps (perpendicular in X)
    pts.push(xRuler - ENDCAP, BELOW, zF,  xRuler + ENDCAP, BELOW, zF);
    pts.push(xRuler - ENDCAP, BELOW, zB,  xRuler + ENDCAP, BELOW, zB);
    // Ticks: toward the bed — left when mirrored (Y ruler right of bed), right when normal (Y ruler left of bed)
    for (const v of yTicks) {
      const z = -(v * scaleXY - 0.5);
      if (mirrorX) {
        pts.push(xRuler, BELOW, z,  xRuler - TICK, BELOW, z);
      } else {
        pts.push(xRuler, BELOW, z,  xRuler + TICK, BELOW, z);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [BELOW, sceneXLeft, sceneXRight, zF, zB, zRuler, xRuler, xTicks, yTicks, scaleXY, mirrorX, toSceneX]);

  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  return (
    <group>
      <lineSegments geometry={lineGeo} renderOrder={4}>
        <lineBasicMaterial color="#64748b" opacity={0.80} transparent />
      </lineSegments>

      {/* ── X tick labels ── */}
      {xTicks.map((v) => (
        <Text
          key={`xr-${v}`}
          position={[toSceneX(v), BELOW - TICK - 0.013, zRuler]}
          fontSize={0.020}
          color="#94a3b8"
          anchorX="center"
          anchorY="top"
          renderOrder={5}
        >
          {v}
        </Text>
      ))}

      {/* X axis label */}
      <Text
        position={[(sceneXLeft + sceneXRight) / 2, BELOW - TICK - 0.034, zRuler]}
        fontSize={0.022}
        color="#ef4444"
        anchorX="center"
        anchorY="top"
        renderOrder={5}
      >
        X (mm)
      </Text>

      {/* ── Y tick labels ── */}
      {yTicks.map((v) => (
        <Text
          key={`yr-${v}`}
          position={[mirrorX ? xRuler + 0.010 : xRuler - 0.010, BELOW, -(v * scaleXY - 0.5)]}
          fontSize={0.020}
          color="#94a3b8"
          anchorX={mirrorX ? 'left' : 'right'}
          anchorY="middle"
          renderOrder={5}
        >
          {v}
        </Text>
      ))}

      {/* Y axis label */}
      <Text
        position={[mirrorX ? xRuler + 0.044 : xRuler - 0.044, BELOW, (zF + zB) / 2]}
        fontSize={0.022}
        color="#22c55e"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        Y (mm)
      </Text>
    </group>
  );
}

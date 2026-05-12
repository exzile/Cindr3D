import { useEffect, useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { computeNiceTicks } from './niceTicks';
import type { HeightMapData } from './types';

/**
 * Z-deviation ruler.
 *
 * A vertical scale bar placed at the right-front corner of the mesh.
 * Ticks are spaced at "nice" intervals in real mm; labels are colour-coded
 * to match the mesh (red = positive / high, blue = negative / low, white = 0).
 */
export function ZRuler({
  heightMap,
  stats,
  scaleXY: scaleXYProp,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  stats: { min: number; max: number };
  scaleXY?: number;
  mirrorX?: boolean;
}) {
  // ── Scene-space geometry helpers (mirror HeightMapMesh exactly) ────────────
  const xRange  = heightMap.xMax - heightMap.xMin;
  const yRange  = heightMap.yMax - heightMap.yMin;
  const scaleXY = scaleXYProp ?? 1 / Math.max(xRange, yRange, 1);
  const zScale  = (1 / Math.max(Math.abs(stats.max), Math.abs(stats.min), 0.01)) * 0.3;

  // Place the ruler at the right-front corner of the mesh with a small gap.
  // When X is mirrored, bedX=xMin maps to the rightmost scene position.
  const GAP    = 0.052;
  const rulerX = mirrorX
    ? (0.5 - heightMap.xMin * scaleXY + GAP)
    : (heightMap.xMax * scaleXY - 0.5 + GAP);
  const rulerZ = -(heightMap.yMin * scaleXY - 0.5); // front edge in scene space

  const yBottom = stats.min * zScale;
  const yTop    = stats.max * zScale;

  const ticks = useMemo(
    () => computeNiceTicks(stats.min, stats.max, 6),
    [stats.min, stats.max],
  );

  const lineGeo = useMemo(() => {
    const TICK      = 0.020; // normal tick half-length (extends toward mesh)
    const TICK_ZERO = 0.030; // longer tick for the zero reference

    const pts: number[] = [];

    // ── Spine ───────────────────────────────────────────────────────
    pts.push(rulerX, yBottom, rulerZ,  rulerX, yTop, rulerZ);

    // Arrow-head endcaps
    const CAP = 0.007;
    pts.push(rulerX - CAP, yTop - CAP,    rulerZ,  rulerX, yTop,    rulerZ);
    pts.push(rulerX + CAP, yTop - CAP,    rulerZ,  rulerX, yTop,    rulerZ);
    pts.push(rulerX - CAP, yBottom + CAP, rulerZ,  rulerX, yBottom, rulerZ);
    pts.push(rulerX + CAP, yBottom + CAP, rulerZ,  rulerX, yBottom, rulerZ);

    // ── Tick marks ───────────────────────────────────────────────────
    for (const val of ticks) {
      const y   = val * zScale;
      const len = Math.abs(val) < 1e-9 ? TICK_ZERO : TICK;
      pts.push(rulerX, y, rulerZ,  rulerX - len, y, rulerZ);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [rulerX, rulerZ, yBottom, yTop, ticks, zScale]);

  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  const fmtTick = (v: number): string => {
    if (Math.abs(v) < 1e-9) return '0';
    const d = Math.abs(v) < 0.1 ? 3 : 2;
    return `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
  };

  return (
    <group>
      {/* Spine + ticks */}
      <lineSegments geometry={lineGeo} renderOrder={4}>
        <lineBasicMaterial color="#64748b" opacity={0.92} transparent />
      </lineSegments>

      {/* Tick labels */}
      {ticks.map((val) => {
        const isZero = Math.abs(val) < 1e-9;
        const color  = isZero ? '#e2e8f0' : val > 0 ? '#f87171' : '#60a5fa';
        return (
          <Text
            key={val}
            position={[rulerX + 0.009, val * zScale, rulerZ]}
            fontSize={0.022}
            color={color}
            anchorX="left"
            anchorY="middle"
            renderOrder={5}
          >
            {fmtTick(val)}
          </Text>
        );
      })}

      {/* Exact min / max labels at the arrow endcaps */}
      <Text
        position={[rulerX - 0.028, yTop + 0.013, rulerZ]}
        fontSize={0.018}
        color="#f87171"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        {`+${stats.max.toFixed(3)}`}
      </Text>
      <Text
        position={[rulerX - 0.028, yBottom - 0.013, rulerZ]}
        fontSize={0.018}
        color="#60a5fa"
        anchorX="center"
        anchorY="middle"
        renderOrder={5}
      >
        {stats.min.toFixed(3)}
      </Text>

      {/* Axis label */}
      <Text
        position={[rulerX + 0.009, yTop + 0.042, rulerZ]}
        fontSize={0.020}
        color="#94a3b8"
        anchorX="left"
        anchorY="middle"
        renderOrder={5}
      >
        Z (mm)
      </Text>
    </group>
  );
}

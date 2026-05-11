import { useCallback, useMemo, useRef, useState } from 'react';
import { computeStats, deviationColor, divergingColor } from '../utils';
import type { HeightMapData } from './types';

/** SVG-based 2-D heatmap with hover tooltips. */
export function Heatmap2D({
  heightMap,
  diverging = false,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  diverging?: boolean;
  mirrorX?: boolean;
}) {
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; value: number; screenX: number; screenY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stats = useMemo(() => computeStats(heightMap), [heightMap]);

  const padL = 48, padR = 12, padT = 12, padB = 40;
  const svgW = 520, svgH = 420;
  const gridW = svgW - padL - padR;
  const gridH = svgH - padT - padB;
  const cellW = gridW / heightMap.numX;
  const cellH = gridH / heightMap.numY;

  const xTicks = useMemo(() => {
    const step = Math.ceil(heightMap.numX / 5);
    return Array.from({ length: heightMap.numX }, (_, i) => i)
      .filter((i) => i % step === 0 || i === heightMap.numX - 1)
      .map((i) => ({ i, mm: Math.round(heightMap.xMin + i * heightMap.xSpacing) }));
  }, [heightMap]);

  const yTicks = useMemo(() => {
    const step = Math.ceil(heightMap.numY / 5);
    return Array.from({ length: heightMap.numY }, (_, i) => i)
      .filter((i) => i % step === 0 || i === heightMap.numY - 1)
      .map((i) => ({ i, mm: Math.round(heightMap.yMin + i * heightMap.ySpacing) }));
  }, [heightMap]);

  // Single SVG-level handler — computes xi/yi from the mouse position rather
  // than attaching a separate onMouseMove to each of the numX*numY rects.
  // The old per-cell handler shape allocated one new closure per cell on
  // every render, and an 11x11 grid means 121 callback allocations on each
  // hover-driven re-render. With one handler we get O(1) per render.
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert client coords into viewBox-space (the SVG scales — we can't
    // just subtract rect.left).
    const vbX = ((e.clientX - rect.left) / rect.width) * svgW;
    const vbY = ((e.clientY - rect.top)  / rect.height) * svgH;
    if (vbX < padL || vbX > padL + gridW || vbY < padT || vbY > padT + gridH) {
      setHoverInfo(null);
      return;
    }
    const cellXi = Math.floor((vbX - padL) / cellW);
    const cellYi = Math.floor((vbY - padT) / cellH);
    if (cellXi < 0 || cellXi >= heightMap.numX || cellYi < 0 || cellYi >= heightMap.numY) {
      setHoverInfo(null);
      return;
    }
    // Reverse the visual transforms applied to the cells:
    //   xi   = mirrorX ? numX-1-cellXi : cellXi
    //   yi   = numY-1-cellYi  (Y is rendered top-down → bottom-up)
    const xi = mirrorX ? (heightMap.numX - 1 - cellXi) : cellXi;
    const yi = heightMap.numY - 1 - cellYi;
    const value = heightMap.points[yi]?.[xi] ?? 0;
    setHoverInfo({
      x: heightMap.xMin + xi * heightMap.xSpacing,
      y: heightMap.yMin + yi * heightMap.ySpacing,
      value,
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
    });
  }, [heightMap, mirrorX, padL, padT, gridW, gridH, cellW, cellH, svgW, svgH]);

  const handleMouseLeave = useCallback(() => setHoverInfo(null), []);

  return (
    <div className="heatmap-2d-container" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {Array.from({ length: heightMap.numY }, (_, yi) =>
          Array.from({ length: heightMap.numX }, (_, xi) => {
            const value = heightMap.points[yi]?.[xi] ?? 0;
            const fill = diverging ? divergingColor(value, stats.min, stats.max) : deviationColor(value, stats.min, stats.max);
            // When mirrorX: xi=0 (X=0) renders at the right side of the grid
            const cellXi = mirrorX ? (heightMap.numX - 1 - xi) : xi;
            return (
              <rect
                key={`${xi}-${yi}`}
                x={padL + cellXi * cellW}
                y={padT + (heightMap.numY - 1 - yi) * cellH}
                width={cellW}
                height={cellH}
                fill={fill}
                style={{ stroke: 'var(--border-light)', strokeWidth: 0.5, pointerEvents: 'none' }}
              />
            );
          }),
        )}

        {xTicks.map(({ i, mm }) => {
          // When mirrorX: tick i=0 (lowest X) is on the right
          const tickXi = mirrorX ? (heightMap.numX - 1 - i) : i;
          const cx = padL + tickXi * cellW + cellW / 2;
          return (
            <g key={`x-${i}`}>
              <line x1={cx} y1={padT + gridH} x2={cx} y2={padT + gridH + 4} style={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
              <text x={cx} y={padT + gridH + 14} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>
                {mm}
              </text>
            </g>
          );
        })}
        <text x={padL + gridW / 2} y={svgH - 2} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>X (mm)</text>

        {yTicks.map(({ i, mm }) => {
          const cy = padT + (heightMap.numY - 1 - i) * cellH + cellH / 2;
          return (
            <g key={`y-${i}`}>
              <line x1={padL - 4} y1={cy} x2={padL} y2={cy} style={{ stroke: 'var(--text-muted)', strokeWidth: 1 }} />
              <text x={padL - 7} y={cy + 4} textAnchor="end" fontSize={10} style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}>
                {mm}
              </text>
            </g>
          );
        })}
        <text
          x={10}
          y={padT + gridH / 2}
          textAnchor="middle"
          fontSize={10}
          transform={`rotate(-90, 10, ${padT + gridH / 2})`}
          style={{ fill: 'var(--text-muted)', fontFamily: 'inherit' }}
        >Y (mm)</text>

        <rect x={padL} y={padT} width={gridW} height={gridH} fill="none" style={{ stroke: 'var(--border)', strokeWidth: 1 }} />
      </svg>

      {hoverInfo && (
        <div
          className="hm-2d-tooltip"
          style={{ position: 'absolute', left: hoverInfo.screenX + 14, top: hoverInfo.screenY - 36, pointerEvents: 'none', zIndex: 10 }}
        >
          <span className="hm-2d-tooltip__coord">X {hoverInfo.x.toFixed(0)} / Y {hoverInfo.y.toFixed(0)} mm</span>
          <span className="hm-2d-tooltip__val">{hoverInfo.value >= 0 ? '+' : ''}{hoverInfo.value.toFixed(4)} mm</span>
        </div>
      )}
    </div>
  );
}

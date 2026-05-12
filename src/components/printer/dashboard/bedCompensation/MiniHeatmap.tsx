import { useCallback, useEffect, useMemo, useRef } from 'react';
import { computeStats, deviationColor } from '../../heightMap/utils';
import type { DuetHeightMap } from '../../../../types/duet';

/** Tiny canvas-based heatmap thumbnail for the dashboard panel. */
export function MiniHeatmap({ heightMap }: { heightMap: DuetHeightMap }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stats      = useMemo(() => computeStats(heightMap), [heightMap]);

  const drawRef = useRef<() => void>(() => {});
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cellW = W / heightMap.numX;
    const cellH = H / heightMap.numY;
    for (let y = 0; y < heightMap.numY; y++) {
      for (let x = 0; x < heightMap.numX; x++) {
        const val = heightMap.points[y]?.[x] ?? 0;
        ctx.fillStyle = deviationColor(val, stats.min, stats.max);
        ctx.fillRect(
          Math.floor(x * cellW),
          Math.floor(y * cellH),
          Math.ceil(cellW),
          Math.ceil(cellH),
        );
      }
    }
  }, [heightMap, stats]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 4 || rect.height < 4) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      drawRef.current();
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="bc-canvas-wrap">
      <canvas ref={canvasRef} className="bc-canvas" title="Bed mesh deviation heatmap" />
    </div>
  );
}

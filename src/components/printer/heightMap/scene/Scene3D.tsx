import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { computeStats } from '../utils';
import { CAMERA_POSITIONS } from './cameraPresets';
import { AxisLabels } from './AxisLabels';
import { FlatPlate } from './FlatPlate';
import { GridOverlay } from './GridOverlay';
import { HeightMapMesh } from './HeightMapMesh';
import { ProbePointMarkers } from './ProbePointMarkers';
import { SafetyZones } from './SafetyZones';
import { XYRulers } from './XYRulers';
import { ZRuler } from './ZRuler';
import type { BedBounds, ConfiguredProbeGrid, HeightMapData, HoverInfo } from './types';

export function Scene3D({
  heightMap,
  diverging = false,
  cameraPosition = CAMERA_POSITIONS.iso,
  showProbePoints = true,
  probePointScale = 1,
  showZRuler = true,
  showXYRulers = true,
  showMesh = true,
  configuredGrid,
  bedBounds,
  mirrorX = false,
}: {
  heightMap: HeightMapData;
  diverging?: boolean;
  cameraPosition?: [number, number, number];
  showProbePoints?: boolean;
  probePointScale?: number;
  showZRuler?: boolean;
  showXYRulers?: boolean;
  /** When false only the glass plate and probe markers are rendered (no deviation mesh, grid, or ruler). */
  showMesh?: boolean;
  configuredGrid?: ConfiguredProbeGrid;
  /** Physical bed extents from M208 axis limits — drives full plate + safety margin overlay. */
  bedBounds?: BedBounds;
  mirrorX?: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [tooltipInfo, setTooltipInfo] = useState<HoverInfo | null>(null);

  // Derive stats once per heightMap change — shared by ruler and mesh coloring
  const stats = useMemo(() => computeStats(heightMap), [heightMap]);

  // ── Unified scene scale ────────────────────────────────────────────────
  // Use the union of all known bounds (heightMap CSV + M557 probe grid + M208 physical bed)
  // so every component lives in the same coordinate space.
  const sceneScaleXY = useMemo(() => {
    const candidates = [
      heightMap.xMin, configuredGrid?.xMin, bedBounds?.xMin,
    ].filter((v): v is number => v !== undefined);
    const maxCandidates = [
      heightMap.xMax, configuredGrid?.xMax, bedBounds?.xMax,
    ].filter((v): v is number => v !== undefined);
    const yMins = [
      heightMap.yMin, configuredGrid?.yMin, bedBounds?.yMin,
    ].filter((v): v is number => v !== undefined);
    const yMaxs = [
      heightMap.yMax, configuredGrid?.yMax, bedBounds?.yMax,
    ].filter((v): v is number => v !== undefined);
    const xRange = Math.max(...maxCandidates) - Math.min(...candidates);
    const yRange = Math.max(...yMaxs)          - Math.min(...yMins);
    return 1 / Math.max(xRange, yRange, 1);
  }, [heightMap, configuredGrid, bedBounds]);

  // Scene-space camera target — centre on the full bed when available.
  const meshCenter = useMemo<[number, number, number]>(() => {
    const bedXMin = bedBounds?.xMin ?? configuredGrid?.xMin ?? heightMap.xMin;
    const bedXMax = bedBounds?.xMax ?? configuredGrid?.xMax ?? heightMap.xMax;
    const bedYMin = bedBounds?.yMin ?? configuredGrid?.yMin ?? heightMap.yMin;
    const bedYMax = bedBounds?.yMax ?? configuredGrid?.yMax ?? heightMap.yMax;
    const midBedX = (bedXMin + bedXMax) / 2 * sceneScaleXY;
    const cx = mirrorX ? (0.5 - midBedX) : (midBedX - 0.5);
    const cz = 0.5 - (bedYMin + bedYMax) / 2 * sceneScaleXY;
    return [cx, 0, cz];
  }, [heightMap, configuredGrid, bedBounds, sceneScaleXY, mirrorX]);

  // Keep OrbitControls target centred on the bed when dimensions change.
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    ctrl.target.set(...meshCenter);
    ctrl.update();
  }, [meshCenter]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onPointerLeave={() => setTooltipInfo(null)}>
      <Canvas
        camera={{ position: cameraPosition, fov: 45 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 4]}   intensity={1.0} castShadow />
        <directionalLight position={[-3, 2, -3]} intensity={0.35} />
        <directionalLight position={[0, -4, 0]}  intensity={0.15} />
        <FlatPlate heightMap={heightMap} configuredGrid={configuredGrid} bedBounds={bedBounds} scaleXY={sceneScaleXY} mirrorX={mirrorX} />
        {/* Safety margin overlay — red fills + blue probe boundary — only when M208 bed > M557 probe area */}
        {bedBounds && configuredGrid && (
          <SafetyZones bedBounds={bedBounds} configuredGrid={configuredGrid} scaleXY={sceneScaleXY} mirrorX={mirrorX} />
        )}
        {showProbePoints && (
          <ProbePointMarkers
            heightMap={heightMap}
            configuredGrid={configuredGrid}
            scaleXY={sceneScaleXY}
            radiusScale={probePointScale}
            mirrorX={mirrorX}
            onHover={setTooltipInfo}
          />
        )}
        {showMesh && <HeightMapMesh heightMap={heightMap} diverging={diverging} scaleXY={sceneScaleXY} mirrorX={mirrorX} onHover={setTooltipInfo} />}
        {showMesh && <GridOverlay   heightMap={heightMap} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        {showMesh && showZRuler && <ZRuler heightMap={heightMap} stats={stats} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        {showXYRulers && <XYRulers heightMap={heightMap} configuredGrid={configuredGrid} bedBounds={bedBounds} scaleXY={sceneScaleXY} mirrorX={mirrorX} />}
        <AxisLabels />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.4}
          maxDistance={3}
        />
      </Canvas>

      {tooltipInfo && (
        <div
          className="hm-3d-tooltip"
          style={{
            position: 'fixed',
            left: tooltipInfo.screenX + 16,
            top: tooltipInfo.screenY - 56,
            pointerEvents: 'none',
            zIndex: 200,
          }}
        >
          {tooltipInfo.isProbePoint ? (
            <span className="hm-3d-tooltip__badge">Probe {tooltipInfo.gridX}×{tooltipInfo.gridY}</span>
          ) : (
            <span className="hm-3d-tooltip__badge hm-3d-tooltip__badge--surface">Surface</span>
          )}
          <span className="hm-3d-tooltip__coord">
            X {tooltipInfo.bedX.toFixed(1)} / Y {tooltipInfo.bedY.toFixed(1)} mm
          </span>
          <span
            className="hm-3d-tooltip__val"
            style={{ color: tooltipInfo.value >= 0 ? '#f87171' : '#60a5fa' }}
          >
            {tooltipInfo.value >= 0 ? '+' : ''}{tooltipInfo.value.toFixed(4)} mm
          </span>
        </div>
      )}
    </div>
  );
}

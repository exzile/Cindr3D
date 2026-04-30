import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SliceLayer, SliceResult } from '../../../../types/slicer';
import type { MoveHoverInfo, PreviewColorMode } from '../../../../types/slicer-preview.types';
import { ExtrusionInstancedMesh } from './ExtrusionInstancedMesh';
import { buildColorContext, buildLayerInstances } from './extrusionInstances';

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;

// ---------------------------------------------------------------------------
// LayerLines — instanced-capsule extrusion preview for a single layer
// ---------------------------------------------------------------------------
//
// The previous implementation chained consecutive moves into polylines and
// CPU-built mitered tubes per chain. That meant per-frame mesh stitching,
// miter math, and chain-break heuristics — all of which we can drop here:
// each gcode segment becomes one capsule instance in a single InstancedMesh,
// and overlapping hemisphere caps blend joints automatically via the depth
// buffer. Variable extrusion width per segment maps to the capsule's start /
// end radius (currently identical per-segment because gcode E values are
// per-segment, but the shader supports tapered cones for free if a future
// pre-pass wants to ramp width across joints).

export function LayerLines({
  layer,
  layerHeight,
  filamentDiameter,
  isCurrentLayer,
  currentLayerMoveCount,
  showTravel,
  showRetractions,
  colorMode,
  hiddenTypes,
  layerTimeT,
  onHoverMove,
}: {
  layer: SliceLayer;
  layerHeight: number;
  filamentDiameter: number;
  isCurrentLayer: boolean;
  currentLayerMoveCount: number | undefined;
  showTravel: boolean;
  showRetractions: boolean;
  colorMode: PreviewColorMode;
  hiddenTypes: ReadonlySet<string>;
  /** Normalised 0-1 position on the layer-time ramp (0 = fast, 1 = slow). */
  layerTimeT?: number;
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}) {
  const { instanceData, travelGeo, retractGeo } = useMemo(() => {
    const colorContext = buildColorContext(layer, colorMode, layerTimeT);
    const data = buildLayerInstances({
      layer,
      layerHeight,
      filamentDiameter,
      isCurrentLayer,
      currentLayerMoveCount,
      showTravel,
      hiddenTypes,
      colorContext,
    });

    const tg = data.travelPositions.length > 0 ? new THREE.BufferGeometry() : null;
    if (tg) tg.setAttribute('position', new THREE.BufferAttribute(data.travelPositions, 3));

    const rg = data.retractPositions.length > 0 ? new THREE.BufferGeometry() : null;
    if (rg) rg.setAttribute('position', new THREE.BufferAttribute(data.retractPositions, 3));

    return { instanceData: data, travelGeo: tg, retractGeo: rg };
  }, [
    layer, layerHeight, filamentDiameter, isCurrentLayer,
    currentLayerMoveCount, showTravel, colorMode, hiddenTypes, layerTimeT,
  ]);

  useEffect(() => () => {
    travelGeo?.dispose();
    retractGeo?.dispose();
  }, [travelGeo, retractGeo]);

  return (
    <>
      <ExtrusionInstancedMesh data={instanceData} onHoverMove={onHoverMove} />
      {travelGeo && (
        <lineSegments key={`${layer.layerIndex}-travel`} geometry={travelGeo} renderOrder={1}>
          <lineBasicMaterial color="#4455aa" transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
      )}
      {showRetractions && retractGeo && (
        <points key={`${layer.layerIndex}-retract`} geometry={retractGeo} renderOrder={2}>
          <pointsMaterial color="#ff3333" size={0.35} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
        </points>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineGCodePreview — renders each visible layer's LayerLines
// ---------------------------------------------------------------------------

export function InlineGCodePreview({
  sliceResult,
  filamentDiameter,
  startLayer,
  currentLayer,
  currentLayerMoveCount,
  showTravel,
  showRetractions,
  colorMode,
  hiddenTypes,
  layerTimeRange,
  onHoverMove,
}: {
  sliceResult: SliceResult;
  filamentDiameter?: number;
  startLayer: number;
  currentLayer: number;
  currentLayerMoveCount?: number;
  showTravel: boolean;
  showRetractions: boolean;
  colorMode: PreviewColorMode;
  hiddenTypes: ReadonlySet<string>;
  /** [min, max] layer-time across the visible window — only used in layer-time mode. */
  layerTimeRange: [number, number];
  onHoverMove?: (info: MoveHoverInfo | null) => void;
}) {
  const layers = useMemo(
    () => sliceResult.layers.filter(
      (l) => l.layerIndex >= startLayer && l.layerIndex <= currentLayer,
    ),
    [sliceResult, startLayer, currentLayer],
  );

  return (
    <group>
      {layers.map((layer) => {
        const prevZ = layer.layerIndex > 0
          ? (sliceResult.layers[layer.layerIndex - 1]?.z ?? 0)
          : 0;
        const layerH = Math.max(0.05, layer.z - prevZ);
        const span = Math.max(1e-9, layerTimeRange[1] - layerTimeRange[0]);
        const layerTimeT = colorMode === 'layer-time'
          ? Math.max(0, Math.min(1, (layer.layerTime - layerTimeRange[0]) / span))
          : undefined;
        return (
          <LayerLines
            key={layer.layerIndex}
            layer={layer}
            layerHeight={layerH}
            filamentDiameter={filamentDiameter ?? DEFAULT_FILAMENT_DIAMETER_MM}
            isCurrentLayer={layer.layerIndex === currentLayer}
            currentLayerMoveCount={currentLayerMoveCount}
            showTravel={showTravel}
            showRetractions={showRetractions}
            colorMode={colorMode}
            hiddenTypes={hiddenTypes}
            layerTimeT={layerTimeT}
            onHoverMove={layer.layerIndex === currentLayer ? onHoverMove : undefined}
          />
        );
      })}
    </group>
  );
}

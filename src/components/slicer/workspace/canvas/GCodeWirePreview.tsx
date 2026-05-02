import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SliceLayer, SliceResult } from '../../../../types/slicer';
import type { MoveHoverInfo, PreviewColorMode } from '../../../../types/slicer-preview.types';
import { buildColorContext, colorForMove } from './extrusionInstances';

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;

// ---------------------------------------------------------------------------
// WireLayerLines — thin line-segment preview for a single layer
// ---------------------------------------------------------------------------
//
// Draws every gcode move as a 1px line from `from` to `to`, coloured by the
// same colour-mode logic as the solid (capsule) preview. No tubes, no width,
// no raycasting — pure wireframe. Ideal for inspecting pathing on dense
// layers where the solid preview occludes detail.

function WireLayerLines({
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
  layerTimeT?: number;
}) {
  const { lineGeo, travelGeo, retractGeo } = useMemo(() => {
    const moves = (isCurrentLayer && currentLayerMoveCount !== undefined)
      ? layer.moves.slice(0, currentLayerMoveCount)
      : layer.moves;

    const colorContext = buildColorContext(layer, colorMode, layerTimeT);

    // Count segments for pre-allocation
    let extrusionCount = 0;
    let travelCount = 0;
    let retractCount = 0;
    for (const m of moves) {
      if (m.type === 'travel') {
        if (showTravel) travelCount++;
        if (m.extrusion < 0) retractCount++;
        continue;
      }
      if (hiddenTypes.has(m.type)) continue;
      if (m.extrusion <= 0) continue;
      extrusionCount++;
    }

    // Build extrusion line segments with per-vertex color
    const positions = new Float32Array(extrusionCount * 6);
    const colors = new Float32Array(extrusionCount * 6);
    const travelPositions = new Float32Array(travelCount * 6);
    const retractPositions = new Float32Array(retractCount * 3);

    let ext = 0;
    let trv = 0;
    let ret = 0;

    for (const m of moves) {
      if (m.type === 'travel') {
        if (showTravel) {
          const k = trv * 6;
          travelPositions[k    ] = m.from.x;
          travelPositions[k + 1] = m.from.y;
          travelPositions[k + 2] = layer.z;
          travelPositions[k + 3] = m.to.x;
          travelPositions[k + 4] = m.to.y;
          travelPositions[k + 5] = layer.z;
          trv++;
        }
        if (m.extrusion < 0) {
          const k = ret * 3;
          retractPositions[k    ] = m.from.x;
          retractPositions[k + 1] = m.from.y;
          retractPositions[k + 2] = layer.z;
          ret++;
        }
        continue;
      }
      if (hiddenTypes.has(m.type)) continue;
      if (m.extrusion <= 0) continue;

      const [r, g, b] = colorForMove(m, colorContext);
      const k = ext * 6;

      positions[k    ] = m.from.x;
      positions[k + 1] = m.from.y;
      positions[k + 2] = layer.z;
      positions[k + 3] = m.to.x;
      positions[k + 4] = m.to.y;
      positions[k + 5] = layer.z;

      colors[k    ] = r;
      colors[k + 1] = g;
      colors[k + 2] = b;
      colors[k + 3] = r;
      colors[k + 4] = g;
      colors[k + 5] = b;

      ext++;
    }

    const lg = extrusionCount > 0 ? new THREE.BufferGeometry() : null;
    if (lg) {
      lg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      lg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    const tg = travelCount > 0 ? new THREE.BufferGeometry() : null;
    if (tg) tg.setAttribute('position', new THREE.BufferAttribute(travelPositions, 3));

    const rg = retractCount > 0 ? new THREE.BufferGeometry() : null;
    if (rg) rg.setAttribute('position', new THREE.BufferAttribute(retractPositions, 3));

    return { lineGeo: lg, travelGeo: tg, retractGeo: rg };
  }, [
    layer, layerHeight, filamentDiameter, isCurrentLayer,
    currentLayerMoveCount, showTravel, colorMode, hiddenTypes, layerTimeT,
  ]);

  useEffect(() => () => {
    lineGeo?.dispose();
    travelGeo?.dispose();
    retractGeo?.dispose();
  }, [lineGeo, travelGeo, retractGeo]);

  return (
    <>
      {lineGeo && (
        <lineSegments geometry={lineGeo}>
          <lineBasicMaterial vertexColors depthWrite={false} />
        </lineSegments>
      )}
      {travelGeo && (
        <lineSegments geometry={travelGeo} renderOrder={1}>
          <lineBasicMaterial color="#4455aa" transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
      )}
      {showRetractions && retractGeo && (
        <points geometry={retractGeo} renderOrder={2}>
          <pointsMaterial color="#ff3333" size={0.35} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
        </points>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineGCodeWirePreview — renders each visible layer's WireLayerLines
// ---------------------------------------------------------------------------

export function InlineGCodeWirePreview({
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
  layerTimeRange: [number, number];
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
          <WireLayerLines
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
          />
        );
      })}
    </group>
  );
}

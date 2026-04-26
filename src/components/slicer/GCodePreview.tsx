import * as React from 'react';
import { useSlicerStore } from '../../store/slicerStore';
import { BuildVolume, LayerHeightIndicator } from './workspace/preview/BuildVolume';
import { LayerMesh } from './workspace/preview/LayerMesh';
import { Legend } from './workspace/preview/Legend';
import { buildLayerGeometry, computeRange } from './workspace/preview/utils';

// ---------------------------------------------------------------------------
// Main GCodePreview component
// ---------------------------------------------------------------------------

export function GCodePreview() {
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const showTravel = useSlicerStore((s) => s.previewShowTravel);
  const showRetractions = useSlicerStore((s) => s.previewShowRetractions);
  const colorMode = useSlicerStore((s) => s.previewColorMode);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);

  const printer = getActivePrinterProfile();
  const buildX = printer?.buildVolume?.x ?? 220;
  const buildY = printer?.buildVolume?.y ?? 220;
  const buildZ = printer?.buildVolume?.z ?? 250;
  const originCenter = printer?.originCenter ?? false;

  const layers = React.useMemo(() => sliceResult?.layers ?? [], [sliceResult?.layers]);

  // Compute range for speed/flow color modes across all visible layers
  const colorRange = React.useMemo<[number, number]>(() => {
    if (colorMode === 'type') return [0, 1];
    const field = colorMode === 'speed' ? 'speed' : 'extrusion';
    return computeRange(layers, previewLayer, field);
  }, [layers, previewLayer, colorMode]);

  // Build per-layer geometry data. Memoize per layer + colorMode + range so
  // geometry does not rebuild every frame. We cache ALL layers up to the max
  // layer count so scrolling through layers is cheap.
  const layerGeometries = React.useMemo(() => {
    return layers.map((layer) => buildLayerGeometry(layer, colorMode, colorRange));
  }, [layers, colorMode, colorRange]);

  // Current layer info for legend
  const currentLayerData = layers[previewLayer];
  const currentZ = currentLayerData?.z ?? 0;
  const layerTime = currentLayerData?.layerTime ?? 0;

  if (!sliceResult || layers.length === 0) {
    return (
      <group>
        <BuildVolume
          volumeX={buildX}
          volumeY={buildY}
          volumeZ={buildZ}
          originCenter={originCenter}
        />
      </group>
    );
  }

  return (
    <group>
      {/* Build plate and volume */}
      <BuildVolume
        volumeX={buildX}
        volumeY={buildY}
        volumeZ={buildZ}
        originCenter={originCenter}
      />

      {/* Layer height indicator */}
      <LayerHeightIndicator
        z={currentZ}
        sizeX={buildX}
        sizeY={buildY}
        originCenter={originCenter}
      />

      {/* Rendered layers */}
      {layerGeometries.map((data, idx) => {
        if (idx > previewLayer) return null;
        const isCurrentLayer = idx === previewLayer;
        const opacity = isCurrentLayer ? 1.0 : 0.3;

        return (
          <LayerMesh
            key={idx}
            data={data}
            opacity={opacity}
            showTravel={showTravel && isCurrentLayer}
            showRetractions={showRetractions && isCurrentLayer}
          />
        );
      })}

      {/* Legend overlay */}
      <Legend
        colorMode={colorMode}
        currentLayer={previewLayer}
        currentZ={currentZ}
        layerTime={layerTime}
        range={colorRange}
      />
    </group>
  );
}

export default GCodePreview;

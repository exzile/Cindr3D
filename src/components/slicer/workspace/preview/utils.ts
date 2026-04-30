import type { SliceLayer } from '../../../../types/slicer';

// Per-move scalar range helpers, used by the legend and the per-layer color
// context builder in extrusionInstances.ts. The actual move-to-color mapping
// and per-layer instance buffer construction live next to the renderer.

/**
 * Returns the [min, max] value range for a per-move scalar field across all
 * visible layers (0..maxLayer). Used to normalise the speed, flow, and width
 * colour ramps.
 */
export function computeRange(
  layers: SliceLayer[],
  maxLayer: number,
  field: 'speed' | 'extrusion' | 'width',
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= maxLayer && i < layers.length; i++) {
    for (const move of layers[i].moves) {
      if (move.type === 'travel') continue;
      const val = field === 'width' ? move.lineWidth : move[field as 'speed' | 'extrusion'];
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (!isFinite(min)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

/**
 * Returns the [min, max] layerTime range across the visible layer window
 * (minLayer..maxLayer). Used to normalise the layer-time colour ramp.
 */
export function computeLayerTimeRange(
  layers: SliceLayer[],
  maxLayer: number,
  minLayer = 0,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = minLayer; i <= maxLayer && i < layers.length; i++) {
    const t = layers[i].layerTime;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!isFinite(min)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

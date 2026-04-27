import * as THREE from 'three';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';
import {
  MOVE_TYPE_THREE_COLORS,
  SPEED_LOW_COLOR,
  SPEED_HIGH_COLOR,
  FLOW_LOW_COLOR,
  FLOW_HIGH_COLOR,
  WIDTH_LOW_COLOR,
  WIDTH_HIGH_COLOR,
  LAYER_TIME_LOW_COLOR,
  LAYER_TIME_HIGH_COLOR,
} from './constants';
import type { LayerGeometryData } from '../../../../types/slicer-preview.types';

// Scratch color — reused across getMoveColor calls to avoid per-move allocation.
const _scratchColor = new THREE.Color();

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

/**
 * Returns a reference to _scratchColor — callers must copy .r/.g/.b immediately.
 *
 * @param layerTimeT  Normalised layer-time position (0 = fast, 1 = slow).
 *                    Required when colorMode === 'layer-time'; ignored otherwise.
 */
export function getMoveColor(
  move: SliceMove,
  colorMode: 'type' | 'speed' | 'flow' | 'width' | 'layer-time' | 'wall-quality',
  range: [number, number],
  layerTimeT = 0,
): THREE.Color {
  if (colorMode === 'type') {
    return _scratchColor.copy(MOVE_TYPE_THREE_COLORS[move.type] ?? _scratchColor.set('#888888'));
  }

  if (colorMode === 'layer-time') {
    return _scratchColor.copy(LAYER_TIME_LOW_COLOR).lerp(LAYER_TIME_HIGH_COLOR, Math.max(0, Math.min(1, layerTimeT)));
  }

  if (colorMode === 'speed') {
    const t = Math.max(0, Math.min(1, (move.speed - range[0]) / (range[1] - range[0])));
    return _scratchColor.copy(SPEED_LOW_COLOR).lerp(SPEED_HIGH_COLOR, t);
  }

  if (colorMode === 'width') {
    const t = Math.max(0, Math.min(1, (move.lineWidth - range[0]) / (range[1] - range[0])));
    return _scratchColor.copy(WIDTH_LOW_COLOR).lerp(WIDTH_HIGH_COLOR, t);
  }

  // flow
  const t = Math.max(0, Math.min(1, (move.extrusion - range[0]) / (range[1] - range[0])));
  return _scratchColor.copy(FLOW_LOW_COLOR).lerp(FLOW_HIGH_COLOR, t);
}

export function buildLayerGeometry(
  layer: SliceLayer,
  colorMode: 'type' | 'speed' | 'flow' | 'width' | 'layer-time' | 'wall-quality',
  range: [number, number],
  layerTimeT = 0,
): LayerGeometryData {
  const extPosArr: number[] = [];
  const extColArr: number[] = [];
  const travPosArr: number[] = [];
  const retractPts: number[] = [];

  const z = layer.z;

  for (const move of layer.moves) {
    if (move.type === 'travel') {
      travPosArr.push(move.from.x, move.from.y, z, move.to.x, move.to.y, z);
      if (move.extrusion < 0) {
        retractPts.push(move.from.x, move.from.y, z);
      }
    } else {
      const color = getMoveColor(move, colorMode, range, layerTimeT);
      extPosArr.push(move.from.x, move.from.y, z, move.to.x, move.to.y, z);
      extColArr.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }

  return {
    extrusionPositions: new Float32Array(extPosArr),
    extrusionColors: new Float32Array(extColArr),
    travelPositions: new Float32Array(travPosArr),
    retractionPoints: new Float32Array(retractPts),
  };
}

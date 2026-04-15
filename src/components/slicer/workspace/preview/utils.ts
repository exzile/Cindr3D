import * as THREE from 'three';
import type { SliceLayer, SliceMove } from '../../../../types/slicer';
import {
  MOVE_TYPE_COLORS,
  SPEED_LOW_COLOR,
  SPEED_HIGH_COLOR,
  FLOW_LOW_COLOR,
  FLOW_HIGH_COLOR,
} from './constants';
import type { LayerGeometryData } from './types';

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, t);
}

export function computeRange(
  layers: SliceLayer[],
  maxLayer: number,
  field: 'speed' | 'extrusion',
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= maxLayer && i < layers.length; i++) {
    for (const move of layers[i].moves) {
      if (move.type === 'travel') continue;
      const val = move[field];
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (!isFinite(min)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

export function getMoveColor(
  move: SliceMove,
  colorMode: 'type' | 'speed' | 'flow',
  range: [number, number],
): THREE.Color {
  if (colorMode === 'type') {
    return new THREE.Color(MOVE_TYPE_COLORS[move.type] ?? '#888888');
  }

  if (colorMode === 'speed') {
    const t = Math.max(0, Math.min(1, (move.speed - range[0]) / (range[1] - range[0])));
    return lerpColor(SPEED_LOW_COLOR, SPEED_HIGH_COLOR, t);
  }

  const t = Math.max(0, Math.min(1, (move.extrusion - range[0]) / (range[1] - range[0])));
  return lerpColor(FLOW_LOW_COLOR, FLOW_HIGH_COLOR, t);
}

export function buildLayerGeometry(
  layer: SliceLayer,
  colorMode: 'type' | 'speed' | 'flow',
  range: [number, number],
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
      const color = getMoveColor(move, colorMode, range);
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

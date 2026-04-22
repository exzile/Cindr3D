import * as THREE from 'three';
import type { SliceMove } from '../../../../types/slicer';

export const MOVE_TYPE_COLORS: Record<SliceMove['type'], string> = {
  'wall-outer': '#aa1111',
  'wall-inner': '#33dd55',
  infill: '#cc5500',
  'top-bottom': '#1144bb',
  support: '#4caf50',
  skirt: '#9c27b0',
  brim: '#9c27b0',
  raft: '#795548',
  bridge: '#f44336',
  travel: '#444444',
  ironing: '#e91e63',
};

export const MOVE_TYPE_LABELS: Record<SliceMove['type'], string> = {
  'wall-outer': 'Outer Wall',
  'wall-inner': 'Inner Wall',
  infill: 'Infill',
  'top-bottom': 'Top / Bottom',
  support: 'Support',
  skirt: 'Skirt',
  brim: 'Brim',
  raft: 'Raft',
  bridge: 'Bridge',
  travel: 'Travel',
  ironing: 'Ironing',
};

export const SPEED_LOW_COLOR = new THREE.Color('#2196f3');
export const SPEED_HIGH_COLOR = new THREE.Color('#f44336');
export const FLOW_LOW_COLOR = new THREE.Color('#2196f3');
export const FLOW_HIGH_COLOR = new THREE.Color('#f44336');

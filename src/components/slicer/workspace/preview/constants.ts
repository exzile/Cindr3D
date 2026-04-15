import * as THREE from 'three';
import type { SliceMove } from '../../../../types/slicer';

export const MOVE_TYPE_COLORS: Record<SliceMove['type'], string> = {
  'wall-outer': '#4fc3f7',
  'wall-inner': '#29b6f6',
  infill: '#ff9800',
  'top-bottom': '#ffeb3b',
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

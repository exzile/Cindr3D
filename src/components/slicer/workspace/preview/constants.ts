import * as THREE from 'three';
import type { SliceMove } from '../../../../types/slicer';

// Hex strings — used by the HTML legend / color-scheme panel.
export const MOVE_TYPE_COLORS: Record<SliceMove['type'], string> = {
  'wall-outer': '#df7a2d',
  'wall-inner': '#22bb44',
  // Gap-fill: medial-axis bead in narrow regions where no full wall fits.
  // Cura uses a yellow-green to flag these (visually distinct from
  // wall-inner so the user can spot quality concerns).
  'gap-fill':   '#bbcc22',
  infill:       '#cc6600',
  // Top/bottom skin — purple to match OrcaSlicer's bottom-skin color
  // (resources/profiles/.../colors). The previous dark blue read as
  // "another infill type" in the preview; OrcaSlicer's distinct purple
  // visually separates the skin shells from sparse infill underneath.
  'top-bottom': '#5f56c8',
  support:      '#cc44bb',
  skirt:        '#999999',
  brim:         '#999999',
  raft:         '#777777',
  bridge:       '#ff2020',
  travel:       '#555555',
  ironing:      '#55cc88',
};

// THREE.Color singletons — used by the 3D scene renderer. Derived from the hex
// map above so the legend and the 3D preview always agree on colors.
export const MOVE_TYPE_THREE_COLORS: Record<SliceMove['type'], THREE.Color> = Object.fromEntries(
  Object.entries(MOVE_TYPE_COLORS).map(([k, v]) => [k, new THREE.Color(v)]),
) as Record<SliceMove['type'], THREE.Color>;

export const MOVE_TYPE_LABELS: Record<SliceMove['type'], string> = {
  'wall-outer': 'Outer Wall',
  'wall-inner': 'Inner Wall',
  'gap-fill': 'Gap Fill',
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

// Speed ramp: blue (slow) → red (fast).
export const SPEED_LOW_COLOR  = new THREE.Color('#2255cc');
export const SPEED_HIGH_COLOR = new THREE.Color('#cc2222');
// Flow ramp: green (low extrusion) → red (high extrusion).
export const FLOW_LOW_COLOR   = new THREE.Color('#22bb44');
export const FLOW_HIGH_COLOR  = new THREE.Color('#cc2222');
// Width ramp: blue (thin/Arachne inner) → orange (thick outer wall).
export const WIDTH_LOW_COLOR  = new THREE.Color('#2255cc');
export const WIDTH_HIGH_COLOR = new THREE.Color('#cc6600');
// Layer-time ramp: green (fast layer) → red (slow/cooling layer).
export const LAYER_TIME_LOW_COLOR  = new THREE.Color('#22bb44');
export const LAYER_TIME_HIGH_COLOR = new THREE.Color('#cc2222');

// Z-seam mode: dim paths so wall start points stand out clearly.
export const Z_SEAM_COLOR = '#ffaa44';
export const Z_SEAM_THREE_COLOR = new THREE.Color(Z_SEAM_COLOR);
export const Z_SEAM_DIM_COLOR = '#4a3b30';
export const Z_SEAM_DIM_THREE_COLOR = new THREE.Color(Z_SEAM_DIM_COLOR);

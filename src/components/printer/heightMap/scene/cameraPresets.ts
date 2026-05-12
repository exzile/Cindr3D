/** Camera position presets for the 3D heightmap scene. */

export type CameraPreset = 'iso' | 'top' | 'front' | 'side';

export const CAMERA_POSITIONS: Record<CameraPreset, [number, number, number]> = {
  iso:   [0.9,   0.65, 0.9],
  top:   [0.001, 1.5,  0.001],
  front: [0,     0.25, 1.3],
  side:  [1.3,   0.25, 0],
};

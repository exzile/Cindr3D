import type { DuetHeightMap } from '../../../../types/duet';

/** Demo mesh shown when no real map is loaded. */
export const DEMO_HEIGHT_MAP: DuetHeightMap = {
  xMin: 0, xMax: 235, xSpacing: 47,
  yMin: 0, yMax: 235, ySpacing: 47,
  radius: -1,
  numX: 6, numY: 6,
  points: [
    [ 0.042,  0.018, -0.008, -0.021, -0.012,  0.031],
    [ 0.029,  0.011, -0.019, -0.038, -0.024,  0.014],
    [ 0.007, -0.013, -0.031, -0.047, -0.033, -0.006],
    [-0.014, -0.029, -0.048, -0.062, -0.044, -0.018],
    [-0.008, -0.021, -0.037, -0.051, -0.038, -0.011],
    [ 0.023,  0.004, -0.015, -0.026, -0.019,  0.016],
  ],
};

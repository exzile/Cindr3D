import { describe, expect, it } from 'vitest';
import {
  distanceBetweenImagePointsMm,
  projectBedPointToImage,
  projectImagePointToBed,
  solveCameraHomography,
  type BedCorners,
} from './cameraMeasurement';

describe('camera measurement homography', () => {
  it('maps calibrated image corners into bed coordinates', () => {
    const corners: BedCorners = {
      frontLeft: { x: 0, y: 0 },
      frontRight: { x: 100, y: 0 },
      backRight: { x: 100, y: 100 },
      backLeft: { x: 0, y: 100 },
    };

    const homography = solveCameraHomography(corners, 220, 220);
    expect(homography).not.toBeNull();
    const center = projectImagePointToBed({ x: 50, y: 50 }, homography!);
    expect(center?.x).toBeCloseTo(110, 5);
    expect(center?.y).toBeCloseTo(110, 5);
    const imagePoint = projectBedPointToImage({ x: 110, y: 110 }, homography!);
    expect(imagePoint?.x).toBeCloseTo(50, 5);
    expect(imagePoint?.y).toBeCloseTo(50, 5);
    expect(distanceBetweenImagePointsMm({ x: 0, y: 0 }, { x: 100, y: 0 }, homography!)).toBeCloseTo(220, 5);
  });

  it('returns null until all calibration inputs are available', () => {
    const homography = solveCameraHomography({ frontLeft: { x: 0, y: 0 } }, 220, 220);
    expect(homography).toBeNull();
    expect(distanceBetweenImagePointsMm({ x: 0, y: 0 }, { x: 10, y: 10 }, homography)).toBeNull();
  });
});

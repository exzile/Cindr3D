import { describe, expect, it } from 'vitest';
import { assessPoseCalibration, poseFrameSignature, solveCameraPoseCalibration, type CameraPoseCalibration } from './cameraPose';
import type { BedCorners } from './cameraMeasurement';

const corners: Required<BedCorners> = {
  frontLeft: { x: 10, y: 12 },
  frontRight: { x: 90, y: 12 },
  backRight: { x: 88, y: 86 },
  backLeft: { x: 12, y: 86 },
};

describe('camera pose calibration', () => {
  it('solves a persistent pose from picked bed corners', () => {
    const pose = solveCameraPoseCalibration(corners, 220, 220, poseFrameSignature('cam-main', 0, false), 123);
    expect(pose?.bedWidthMm).toBe(220);
    expect(pose?.calibratedAt).toBe(123);
    expect(pose?.qualityScore).toBeGreaterThan(0.99);
    expect(assessPoseCalibration(pose ?? undefined, corners, poseFrameSignature('cam-main', 0, false)).state).toBe('good');
  });

  it('marks a saved pose stale when camera view settings change', () => {
    const pose = solveCameraPoseCalibration(corners, 220, 220, poseFrameSignature('cam-main', 0, false)) as CameraPoseCalibration;
    const status = assessPoseCalibration(pose, corners, poseFrameSignature('cam-main', 90, false));
    expect(status.state).toBe('stale');
  });

  it('warns when picked corners drift from the saved pose', () => {
    const pose = solveCameraPoseCalibration(corners, 220, 220, poseFrameSignature('cam-main', 0, false)) as CameraPoseCalibration;
    const shifted = { ...corners, backRight: { x: 92, y: 89 } };
    const status = assessPoseCalibration(pose, shifted, poseFrameSignature('cam-main', 0, false));
    expect(status.state).toBe('stale');
    expect(status.driftMm).toBeGreaterThan(5);
  });
});

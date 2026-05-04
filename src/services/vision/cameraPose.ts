import { distanceBetweenImagePointsMm, hasCompleteBedCorners, solveCameraHomography, type BedCorners, type HomographyMatrix } from './cameraMeasurement';

export interface CameraPoseCalibration {
  homography: HomographyMatrix;
  bedCorners: Required<BedCorners>;
  bedWidthMm: number;
  bedDepthMm: number;
  calibratedAt: number;
  frameSignature: string;
  qualityScore: number;
}

export interface CameraPoseStatus {
  state: 'missing' | 'good' | 'warning' | 'stale';
  label: string;
  qualityScore: number;
  driftMm?: number;
}

export function poseFrameSignature(cameraId: string | undefined, rotation: number, flipHorizontal: boolean): string {
  return `${cameraId || 'default'}|rot:${rotation % 360}|flip:${flipHorizontal ? '1' : '0'}`;
}

export function scorePoseCalibration(corners: Required<BedCorners>, homography: HomographyMatrix, bedWidthMm: number, bedDepthMm: number): number {
  const frontWidth = distanceBetweenImagePointsMm(corners.frontLeft, corners.frontRight, homography) ?? 0;
  const backWidth = distanceBetweenImagePointsMm(corners.backLeft, corners.backRight, homography) ?? 0;
  const leftDepth = distanceBetweenImagePointsMm(corners.frontLeft, corners.backLeft, homography) ?? 0;
  const rightDepth = distanceBetweenImagePointsMm(corners.frontRight, corners.backRight, homography) ?? 0;
  const widthError = Math.abs(frontWidth - bedWidthMm) + Math.abs(backWidth - bedWidthMm);
  const depthError = Math.abs(leftDepth - bedDepthMm) + Math.abs(rightDepth - bedDepthMm);
  const normalizedError = (widthError + depthError) / Math.max(1, (bedWidthMm + bedDepthMm) * 2);
  return Math.max(0, Math.min(1, 1 - normalizedError));
}

export function solveCameraPoseCalibration(
  corners: BedCorners | undefined,
  bedWidthMm: number,
  bedDepthMm: number,
  frameSignature: string,
  calibratedAt = Date.now(),
): CameraPoseCalibration | null {
  if (!hasCompleteBedCorners(corners)) return null;
  const homography = solveCameraHomography(corners, bedWidthMm, bedDepthMm);
  if (!homography) return null;
  return {
    homography,
    bedCorners: corners,
    bedWidthMm,
    bedDepthMm,
    calibratedAt,
    frameSignature,
    qualityScore: scorePoseCalibration(corners, homography, bedWidthMm, bedDepthMm),
  };
}

export function assessPoseCalibration(
  pose: CameraPoseCalibration | undefined,
  currentCorners: BedCorners | undefined,
  currentFrameSignature: string,
): CameraPoseStatus {
  if (!pose) {
    return { state: 'missing', label: 'Pose not saved', qualityScore: 0 };
  }
  if (pose.frameSignature !== currentFrameSignature) {
    return { state: 'stale', label: 'Camera view changed; re-pick corners', qualityScore: pose.qualityScore };
  }
  if (hasCompleteBedCorners(currentCorners)) {
    const drift = Math.max(
      distanceBetweenImagePointsMm(pose.bedCorners.frontLeft, currentCorners.frontLeft, pose.homography) ?? 0,
      distanceBetweenImagePointsMm(pose.bedCorners.frontRight, currentCorners.frontRight, pose.homography) ?? 0,
      distanceBetweenImagePointsMm(pose.bedCorners.backRight, currentCorners.backRight, pose.homography) ?? 0,
      distanceBetweenImagePointsMm(pose.bedCorners.backLeft, currentCorners.backLeft, pose.homography) ?? 0,
    );
    if (drift > 5) {
      return { state: 'stale', label: `Corner drift ${drift.toFixed(1)} mm; re-pick`, qualityScore: pose.qualityScore, driftMm: drift };
    }
    if (drift > 2) {
      return { state: 'warning', label: `Corner drift ${drift.toFixed(1)} mm`, qualityScore: pose.qualityScore, driftMm: drift };
    }
  }
  if (pose.qualityScore < 0.85) {
    return { state: 'warning', label: `Pose quality ${Math.round(pose.qualityScore * 100)}%`, qualityScore: pose.qualityScore };
  }
  return { state: 'good', label: `Pose quality ${Math.round(pose.qualityScore * 100)}%`, qualityScore: pose.qualityScore };
}

/**
 * Shared constants and small UI-only types for the camera dashboard. Keeping
 * these outside the panel makes future hook/component extraction cheaper.
 */
import type {
  CameraDashboardCalibration,
  CameraDashboardPrefs,
  CameraDashboardPreset,
  CameraHdBridgeQuality,
} from '../../../../utils/duetPrefs';
import type { BedCorners, ImagePoint } from '../../../../services/vision/cameraMeasurement';
import type { CameraPoseCalibration } from '../../../../services/vision/cameraPose';

export const RECORDING_FPS = 12;

export type ControlSection = CameraDashboardPrefs['activeControlSection'];
export type BedCornerKey = keyof Required<BedCorners>;
export type MeasurementMode = 'off' | 'bed' | 'ruler';
export type RulerEndpointKey = 'measureA' | 'measureB';
export type CameraPreset = CameraDashboardPreset;

export interface CameraMeasurementCalibration extends CameraDashboardCalibration {
  bedWidthMm?: number;
  bedDepthMm?: number;
  bedCorners?: BedCorners;
  measureA?: ImagePoint;
  measureB?: ImagePoint;
  pose?: CameraPoseCalibration;
}

export const BED_CORNER_SEQUENCE: Array<{ key: BedCornerKey; label: string }> = [
  { key: 'frontLeft', label: 'Front left' },
  { key: 'frontRight', label: 'Front right' },
  { key: 'backRight', label: 'Back right' },
  { key: 'backLeft', label: 'Back left' },
];

export const HD_BRIDGE_QUALITIES: Array<{ value: CameraHdBridgeQuality; label: string }> = [
  { value: 'native', label: 'Native' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
];

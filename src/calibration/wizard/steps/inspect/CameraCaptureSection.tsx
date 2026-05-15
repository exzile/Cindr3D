import { CalibrationCameraCapture } from '../../../camera/CalibrationCameraCapture';
import { isFirmwareHealthTest } from './inspectHelpers';
import type { VisionFrameSample } from '../../../../services/vision/failureDetector';

interface CameraCaptureSectionProps {
  testType: string;
  printerId: string;
  framesCount: number;
  onFramesCaptured: (frames: VisionFrameSample[]) => void;
}

/**
 * Wraps the camera-capture UI with the right section heading + description for
 * the active testType. Firmware-health treats photos as optional documentation;
 * all other tests treat them as required input for AI analysis.
 */
export function CameraCaptureSection({ testType, printerId, framesCount, onFramesCaptured }: CameraCaptureSectionProps) {
  const optional = isFirmwareHealthTest(testType);
  return (
    <section className="calib-step__panel">
      <strong className="calib-inspect__section-title">
        {optional ? 'Documentation photos (optional)' : 'Camera frames for AI analysis'}
      </strong>
      {optional ? (
        <p className="calib-step__muted">
          Optionally attach photos of the reference cube for your records.
          {framesCount > 0 && <> &nbsp;<strong>{framesCount}</strong> photo(s) attached.</>}
        </p>
      ) : (
        <p className="calib-step__muted">
          Capture or upload clear photos of the print to enable AI-assisted analysis.
          {framesCount > 0 && <> &nbsp;<strong>{framesCount}</strong> frame(s) attached.</>}
        </p>
      )}
      <CalibrationCameraCapture printerId={printerId} onFramesCaptured={onFramesCaptured} />
    </section>
  );
}

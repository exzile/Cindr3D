/**
 * useCameraMeasurement — owns the camera dashboard's measurement / AR-pose
 * calibration state machine:
 *
 *   • bed-corner picking + drag-to-adjust (homography input)
 *   • two-endpoint ruler picking (distance readout)
 *   • saved pose for the AR overlay (frame signature gated, so a flip/rotate
 *     invalidates an old pose)
 *
 * Returns the live calibration state + setters + derived values (homography,
 * measured distance, pose status) + all the pointer-event handlers the JSX
 * binds to the bed-corner and ruler-endpoint hit targets.
 *
 * The host owns `frameRef`, `mediaViewport`, `activeCameraId`, `rotation`,
 * and `flipImage`; this hook is pure orchestration on top of those.
 */
import {
  useCallback, useMemo, useState,
  type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';
import {
  distanceBetweenImagePointsMm,
  hasCompleteBedCorners,
  solveCameraHomography,
  type ImagePoint,
} from '../../../../services/vision/cameraMeasurement';
import {
  assessPoseCalibration,
  poseFrameSignature,
  solveCameraPoseCalibration,
} from '../../../../services/vision/cameraPose';
import { clampPercent, type MediaViewportRect } from './snapshotEdit';
import {
  BED_CORNER_SEQUENCE,
  type BedCornerKey,
  type CameraMeasurementCalibration,
  type MeasurementMode,
  type RulerEndpointKey,
} from './types';

export interface UseCameraMeasurementDeps {
  initialCalibration: CameraMeasurementCalibration;
  frameRef: RefObject<HTMLDivElement | null>;
  mediaViewport: MediaViewportRect;
  activeCameraId: string;
  rotation: number;
  flipImage: boolean;
  setMessage: (msg: string) => void;
}

export function useCameraMeasurement(deps: UseCameraMeasurementDeps) {
  const { initialCalibration, frameRef, mediaViewport, activeCameraId, rotation, flipImage, setMessage } = deps;

  const [calibration, setCalibration] = useState<CameraMeasurementCalibration>(initialCalibration);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('off');
  const [nextBedCornerIndex, setNextBedCornerIndex] = useState(0);
  const [draggingBedCorner, setDraggingBedCorner] = useState<BedCornerKey | null>(null);
  const [draggingRulerEndpoint, setDraggingRulerEndpoint] = useState<RulerEndpointKey | null>(null);
  const [poseStillUrl, setPoseStillUrl] = useState('');
  const [finalComparisonUrl, setFinalComparisonUrl] = useState('');

  const bedWidthMm = calibration.bedWidthMm ?? 220;
  const bedDepthMm = calibration.bedDepthMm ?? 220;
  const currentPoseSignature = poseFrameSignature(activeCameraId, rotation, flipImage);

  const homography = useMemo(
    () => solveCameraHomography(calibration.bedCorners, bedWidthMm, bedDepthMm),
    [bedDepthMm, bedWidthMm, calibration.bedCorners],
  );
  const measuredDistanceMm = useMemo(
    () => distanceBetweenImagePointsMm(calibration.measureA, calibration.measureB, homography),
    [calibration.measureA, calibration.measureB, homography],
  );
  const completeBedCorners = hasCompleteBedCorners(calibration.bedCorners) ? calibration.bedCorners : null;
  const bedCornersComplete = completeBedCorners !== null;
  const poseStatus = useMemo(
    () => assessPoseCalibration(calibration.pose, calibration.bedCorners, currentPoseSignature),
    [calibration.bedCorners, calibration.pose, currentPoseSignature],
  );
  const nextBedCorner = BED_CORNER_SEQUENCE[nextBedCornerIndex] ?? BED_CORNER_SEQUENCE[0];
  const measurementStatus = measurementMode === 'bed'
    ? `Pick ${nextBedCorner.label.toLowerCase()} corner`
    : measurementMode === 'ruler'
      ? calibration.measureA && !calibration.measureB
        ? 'Pick endpoint B'
        : 'Pick endpoint A'
      : bedCornersComplete
        ? 'Homography ready'
        : 'Bed corners not calibrated';

  const pointFromFramePointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const mediaLeft = rect.left + (mediaViewport.left / 100) * rect.width;
    const mediaTop = rect.top + (mediaViewport.top / 100) * rect.height;
    const mediaWidth = (mediaViewport.width / 100) * rect.width;
    const mediaHeight = (mediaViewport.height / 100) * rect.height;
    if (!mediaWidth || !mediaHeight) return null;
    return {
      x: clampPercent(((event.clientX - mediaLeft) / mediaWidth) * 100),
      y: clampPercent(((event.clientY - mediaTop) / mediaHeight) * 100),
    };
  }, [frameRef, mediaViewport]);

  const handleMeasurementPoint = useCallback((point: ImagePoint) => {
    if (measurementMode === 'off') return;

    if (measurementMode === 'bed') {
      const corner = BED_CORNER_SEQUENCE[nextBedCornerIndex] ?? BED_CORNER_SEQUENCE[0];
      setCalibration((value) => ({
        ...value,
        bedCorners: {
          ...(value.bedCorners ?? {}),
          [corner.key]: point,
        },
      }));
      setNextBedCornerIndex((index) => {
        const nextIndex = (index + 1) % BED_CORNER_SEQUENCE.length;
        if (nextIndex === 0) {
          setMeasurementMode('off');
          setMessage('Bed corners picked. Save pose when the overlay matches the frozen frame.');
        }
        return nextIndex;
      });
      return;
    }

    setCalibration((value) => {
      if (!value.measureA || value.measureB) {
        return { ...value, measureA: point, measureB: undefined };
      }
      return { ...value, measureB: point };
    });
  }, [measurementMode, nextBedCornerIndex, setMessage]);

  const handleMeasurementPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (measurementMode === 'off') return;
    if (event.target !== event.currentTarget) return;
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    handleMeasurementPoint(point);
  }, [handleMeasurementPoint, measurementMode, pointFromFramePointer]);

  const updateBedCornerPoint = useCallback((corner: BedCornerKey, point: ImagePoint) => {
    setCalibration((value) => ({
      ...value,
      bedCorners: {
        ...(value.bedCorners ?? {}),
        [corner]: point,
      },
      pose: undefined,
    }));
  }, []);

  const handleCornerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, corner: BedCornerKey) => {
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingBedCorner(corner);
    updateBedCornerPoint(corner, point);
  }, [pointFromFramePointer, updateBedCornerPoint]);

  const handleCornerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>, corner: BedCornerKey) => {
    if (draggingBedCorner !== corner) return;
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    updateBedCornerPoint(corner, point);
  }, [draggingBedCorner, pointFromFramePointer, updateBedCornerPoint]);

  const handleCornerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggingBedCorner === null) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingBedCorner(null);
    setMessage('Adjusted bed corner. Save pose when the overlay matches the camera frame.');
  }, [draggingBedCorner, setMessage]);

  const updateRulerEndpoint = useCallback((endpoint: RulerEndpointKey, point: ImagePoint) => {
    setCalibration((value) => ({ ...value, [endpoint]: point }));
  }, []);

  const handleRulerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => {
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingRulerEndpoint(endpoint);
    updateRulerEndpoint(endpoint, point);
  }, [pointFromFramePointer, updateRulerEndpoint]);

  const handleRulerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => {
    if (draggingRulerEndpoint !== endpoint) return;
    const point = pointFromFramePointer(event);
    if (!point) return;
    event.preventDefault();
    updateRulerEndpoint(endpoint, point);
  }, [draggingRulerEndpoint, pointFromFramePointer, updateRulerEndpoint]);

  const handleRulerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (draggingRulerEndpoint === null) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingRulerEndpoint(null);
    setMessage('Adjusted ruler marker.');
  }, [draggingRulerEndpoint, setMessage]);

  const savePoseCalibration = useCallback(() => {
    const pose = solveCameraPoseCalibration(calibration.bedCorners, bedWidthMm, bedDepthMm, currentPoseSignature);
    if (!pose) {
      setMessage('Pick all four bed corners before saving AR pose.');
      return;
    }
    setCalibration((value) => ({ ...value, pose }));
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setMeasurementMode('off');
    setMessage(`Saved AR camera pose (${Math.round(pose.qualityScore * 100)}% quality).`);
  }, [bedDepthMm, bedWidthMm, calibration.bedCorners, currentPoseSignature, setMessage]);

  const clearPoseStill = useCallback(() => {
    setPoseStillUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return '';
    });
    setMeasurementMode('off');
  }, []);

  return {
    // State + setters (host's persistence/hydration loops still call these directly)
    calibration, setCalibration,
    measurementMode, setMeasurementMode,
    nextBedCornerIndex, setNextBedCornerIndex,
    draggingBedCorner, draggingRulerEndpoint,
    poseStillUrl, setPoseStillUrl,
    finalComparisonUrl, setFinalComparisonUrl,
    // Derived
    bedWidthMm, bedDepthMm, currentPoseSignature,
    homography, measuredDistanceMm,
    completeBedCorners, bedCornersComplete, poseStatus,
    nextBedCorner, measurementStatus,
    // Handlers
    pointFromFramePointer, handleMeasurementPoint, handleMeasurementPointerDown,
    handleCornerPointerDown, handleCornerPointerMove, handleCornerPointerUp,
    handleRulerPointerDown, handleRulerPointerMove, handleRulerPointerUp,
    savePoseCalibration, clearPoseStill,
  };
}

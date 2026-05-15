/**
 * useCameraFrameStyles — derived className + inline-style values for the
 * camera frame and its overlays. Each piece is just a CSS computation off
 * existing state, but pulling them out of the host removes ~20 LOC of
 * inline derivation noise from the JSX setup.
 *
 *   • frameClassName     — joins the conditional grid/crosshair/measuring/
 *                          AR-only modifier classes onto cam-panel__frame
 *   • imageStyle         — flip + rotation transform applied to the live
 *                          stream <img>/<video>
 *   • calibrationStyle   — CSS custom props for the bed-rectangle overlay
 *   • mediaViewportStyle — CSS custom props for the measured intrinsic
 *                          viewport rect (drives the AR overlay alignment)
 */
import { useMemo, type CSSProperties } from 'react';
import type { CameraOverlayMode } from '../CameraOverlayPanel';
import type { CameraMeasurementCalibration } from './types';
import type { MediaViewportRect } from './snapshotEdit';

export interface UseCameraFrameStylesDeps {
  showGrid: boolean;
  showCrosshair: boolean;
  measurementMode: 'off' | 'bed' | 'ruler';
  cameraOverlayMode: CameraOverlayMode;
  flipImage: boolean;
  rotation: number;
  calibration: CameraMeasurementCalibration;
  mediaViewport: MediaViewportRect;
}

export function useCameraFrameStyles(deps: UseCameraFrameStylesDeps) {
  const {
    showGrid, showCrosshair, measurementMode, cameraOverlayMode,
    flipImage, rotation, calibration, mediaViewport,
  } = deps;

  const frameClassName = useMemo(() => [
    'cam-panel__frame',
    showGrid ? 'cam-panel__frame--grid' : '',
    showCrosshair ? 'cam-panel__frame--crosshair' : '',
    measurementMode !== 'off' ? 'cam-panel__frame--measuring' : '',
    cameraOverlayMode === 'print' ? 'cam-panel__frame--ar-print-only' : '',
  ].filter(Boolean).join(' '), [showGrid, showCrosshair, measurementMode, cameraOverlayMode]);

  const imageStyle = useMemo<CSSProperties>(() => ({
    transform: `scaleX(${flipImage ? -1 : 1}) rotate(${rotation}deg)`,
  }), [flipImage, rotation]);

  const calibrationStyle = useMemo<CSSProperties>(() => ({
    '--cal-x': `${calibration.x}%`,
    '--cal-y': `${calibration.y}%`,
    '--cal-w': `${calibration.width}%`,
    '--cal-h': `${calibration.height}%`,
  } as CSSProperties), [calibration.x, calibration.y, calibration.width, calibration.height]);

  const mediaViewportStyle = useMemo<CSSProperties>(() => ({
    '--media-left': `${mediaViewport.left}%`,
    '--media-top': `${mediaViewport.top}%`,
    '--media-width': `${mediaViewport.width}%`,
    '--media-height': `${mediaViewport.height}%`,
  } as CSSProperties), [mediaViewport.left, mediaViewport.top, mediaViewport.width, mediaViewport.height]);

  return { frameClassName, imageStyle, calibrationStyle, mediaViewportStyle };
}

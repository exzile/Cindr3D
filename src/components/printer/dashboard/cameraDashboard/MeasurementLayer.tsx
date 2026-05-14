import { type PointerEvent as ReactPointerEvent } from 'react';
import { formatMeasurementDistance } from './snapshotEdit';
import {
  BED_CORNER_SEQUENCE,
  type BedCornerKey,
  type CameraMeasurementCalibration,
  type MeasurementMode,
  type RulerEndpointKey,
} from './types';

interface BedCornerPoint { x: number; y: number }
interface CompleteBedCorners {
  frontLeft: BedCornerPoint;
  frontRight: BedCornerPoint;
  backRight: BedCornerPoint;
  backLeft: BedCornerPoint;
}

/**
 * Pointer-driven overlay that sits on top of the live camera media:
 *
 *   • Bed-corner polygon (once all four corners are picked) + draggable
 *     hit targets for re-aligning each corner
 *   • Ruler endpoint markers A/B (draggable) + connecting line + live
 *     distance readout in mm
 *   • Status label shown while a pick is in progress
 *
 * Captures pointer events on its wrapper so a tap on empty space picks the
 * next corner / endpoint (delegated to `onMeasurementPointerDown`). Drag
 * handlers on each marker route into the host's measurement state machine.
 */
export function MeasurementLayer(props: {
  measurementMode: MeasurementMode;
  measurementStatus: string;
  calibration: CameraMeasurementCalibration;
  bedCornersComplete: boolean;
  completeBedCorners: CompleteBedCorners | null;
  measuredDistanceMm: number | null;
  draggingBedCorner: BedCornerKey | null;
  draggingRulerEndpoint: RulerEndpointKey | null;
  onMeasurementPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleCornerPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, corner: BedCornerKey) => void;
  handleCornerPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, corner: BedCornerKey) => void;
  handleCornerPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handleRulerPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => void;
  handleRulerPointerMove: (event: ReactPointerEvent<HTMLButtonElement>, endpoint: RulerEndpointKey) => void;
  handleRulerPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const {
    measurementMode, measurementStatus, calibration,
    bedCornersComplete, completeBedCorners, measuredDistanceMm,
    draggingBedCorner, draggingRulerEndpoint,
    onMeasurementPointerDown,
    handleCornerPointerDown, handleCornerPointerMove, handleCornerPointerUp,
    handleRulerPointerDown, handleRulerPointerMove, handleRulerPointerUp,
  } = props;

  return (
    <div
      className={`cam-panel__measurement-layer${measurementMode !== 'off' ? ' is-picking' : ''}`}
      onPointerDown={onMeasurementPointerDown}
    >
      {bedCornersComplete && completeBedCorners && (
        <svg className="cam-panel__measurement-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points={[
              completeBedCorners.frontLeft,
              completeBedCorners.frontRight,
              completeBedCorners.backRight,
              completeBedCorners.backLeft,
            ].map((point) => `${point.x},${point.y}`).join(' ')}
            className="cam-panel__bed-polygon"
          />
        </svg>
      )}
      {calibration.bedCorners && BED_CORNER_SEQUENCE.map(({ key, label }) => {
        const point = calibration.bedCorners?.[key];
        if (!point) return null;
        return (
          <button
            type="button"
            key={key}
            className={`cam-panel__measure-point cam-panel__measure-point--corner${draggingBedCorner === key ? ' is-dragging' : ''}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            onPointerDown={(event) => handleCornerPointerDown(event, key)}
            onPointerMove={(event) => handleCornerPointerMove(event, key)}
            onPointerUp={handleCornerPointerUp}
            onPointerCancel={handleCornerPointerUp}
            aria-label={`Drag ${label.toLowerCase()} bed corner`}
          >
            {label.slice(0, 1)}
          </button>
        );
      })}
      {calibration.measureA && calibration.measureB && (
        <svg className="cam-panel__measurement-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1={calibration.measureA.x}
            y1={calibration.measureA.y}
            x2={calibration.measureB.x}
            y2={calibration.measureB.y}
            className="cam-panel__ruler-line"
          />
        </svg>
      )}
      {calibration.measureA && (
        <button
          type="button"
          className={`cam-panel__measure-point cam-panel__measure-point--ruler${draggingRulerEndpoint === 'measureA' ? ' is-dragging' : ''}`}
          style={{ left: `${calibration.measureA.x}%`, top: `${calibration.measureA.y}%` }}
          onPointerDown={(event) => handleRulerPointerDown(event, 'measureA')}
          onPointerMove={(event) => handleRulerPointerMove(event, 'measureA')}
          onPointerUp={handleRulerPointerUp}
          onPointerCancel={handleRulerPointerUp}
          aria-label="Drag ruler endpoint A"
        >
          A
        </button>
      )}
      {calibration.measureB && (
        <button
          type="button"
          className={`cam-panel__measure-point cam-panel__measure-point--ruler${draggingRulerEndpoint === 'measureB' ? ' is-dragging' : ''}`}
          style={{ left: `${calibration.measureB.x}%`, top: `${calibration.measureB.y}%` }}
          onPointerDown={(event) => handleRulerPointerDown(event, 'measureB')}
          onPointerMove={(event) => handleRulerPointerMove(event, 'measureB')}
          onPointerUp={handleRulerPointerUp}
          onPointerCancel={handleRulerPointerUp}
          aria-label="Drag ruler endpoint B"
        >
          B
        </button>
      )}
      {(measurementMode !== 'off' || calibration.measureA || bedCornersComplete) && (
        <span className="cam-panel__measure-distance">
          {calibration.measureA && calibration.measureB ? formatMeasurementDistance(measuredDistanceMm) : measurementStatus}
        </span>
      )}
    </div>
  );
}

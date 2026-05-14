import { Camera, X } from 'lucide-react';
import { type CSSProperties } from 'react';
import { formatLastFrame } from './snapshotEdit';

/**
 * Fullscreen camera overlay opened from the topbar's "Fullscreen" button.
 * Shows just the live stream + a frame-age health badge. Closes via the X
 * button.
 */
export function FullscreenViewer(props: {
  hasCamera: boolean;
  isVideoStream: boolean;
  streamSrc: string;
  printerName: string;
  frameClassName: string;
  imageStyle: CSSProperties;
  lastFrameAt: number | null;
  nowTick: number;
  onClose: () => void;
}) {
  const {
    hasCamera, isVideoStream, streamSrc, printerName, frameClassName,
    imageStyle, lastFrameAt, nowTick, onClose,
  } = props;
  return (
    <div className="cam-panel__fullscreen" role="dialog" aria-label="Fullscreen camera view">
      <button className="cam-panel__fullscreen-close" type="button" onClick={onClose}>
        <X size={18} />
      </button>
      <div className={frameClassName}>
        {hasCamera ? (
          <>
            {isVideoStream ? (
              <video className="cam-panel__video" src={streamSrc} muted playsInline autoPlay controls style={imageStyle} />
            ) : (
              <img src={streamSrc} alt={`${printerName} fullscreen camera stream`} style={imageStyle} />
            )}
            <div className="cam-panel__health">{formatLastFrame(lastFrameAt, nowTick)}</div>
          </>
        ) : (
          <div className="cam-panel__empty">
            <Camera size={28} />
            <strong>Camera stream unavailable</strong>
          </div>
        )}
      </div>
    </div>
  );
}

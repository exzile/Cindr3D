/**
 * useStreamHealth — every "is the stream alive and producing frames"
 * state value in one place:
 *
 *   • Failure flags: imageFailed (MJPEG / direct video src failed),
 *     webRtcFailed (WHEP handshake failed → fall back to MJPEG/HLS)
 *   • Frame stats: lastFrameAt, lastFrameIntervalMs, frameCount,
 *     reconnectCount
 *   • streamRevision — manual revision counter the user / connection
 *     hook bumps to force the stream URL to re-fetch
 *
 * Plus the three derived values the Health card + record strip use:
 *   • frameAgeMs (ms since the last frame; null until first frame)
 *   • estimatedFps (1000 / interval, capped at 60)
 *   • droppedFrameWarning (frameAge > 5 s)
 *
 * The host used to declare 7 useState calls + 3 inline derived consts;
 * this hook collapses that to one call.
 */
import { useState } from 'react';

export function useStreamHealth(nowTick: number) {
  const [imageFailed, setImageFailed] = useState(false);
  const [webRtcFailed, setWebRtcFailed] = useState(false);
  const [streamRevision, setStreamRevision] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [lastFrameIntervalMs, setLastFrameIntervalMs] = useState<number | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [reconnectCount, setReconnectCount] = useState(0);

  const frameAgeMs = lastFrameAt ? nowTick - lastFrameAt : null;
  const estimatedFps = lastFrameIntervalMs ? Math.min(60, 1000 / lastFrameIntervalMs) : 0;
  const droppedFrameWarning = frameAgeMs !== null && frameAgeMs > 5000;

  return {
    imageFailed, setImageFailed,
    webRtcFailed, setWebRtcFailed,
    streamRevision, setStreamRevision,
    lastFrameAt, setLastFrameAt,
    lastFrameIntervalMs, setLastFrameIntervalMs,
    frameCount, setFrameCount,
    reconnectCount, setReconnectCount,
    frameAgeMs, estimatedFps, droppedFrameWarning,
  };
}

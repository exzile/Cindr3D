/**
 * useMediaViewport — keeps the `mediaViewport` rect (the inner letterboxed
 * area of the live `<img>` / `<video>` inside the frame) accurate as the
 * frame container resizes, the window resizes, or the camera source swaps.
 *
 * Returns `handleFrameLoad`, which the JSX wires to `onLoad` / `onLoadedMetadata`
 * on the media element so a first frame triggers an immediate measurement
 * (the ResizeObserver alone won't fire until subsequent layouts).
 *
 * Also bumps the frame-rate stats (`lastFrameIntervalMs`, `frameCount`,
 * `lastFrameAt`) on every load tick so the health diagnostics card has
 * current data without sampling the DOM separately.
 *
 * NOTE: mediaViewport state stays in the host because useCameraMeasurement
 * needs to read it in its pointer-event callbacks, and the hook ordering
 * (measurement → prefs → streamState → mediaViewport) means measurement is
 * declared before this hook would run. Host owns the state; this hook
 * owns the effect and frame-load handler that write to it.
 */
import { useCallback, useEffect, type RefObject } from 'react';
import { measureContainedMedia, sameMediaViewport, type MediaViewportRect } from './snapshotEdit';

export interface UseMediaViewportDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  isVideoStream: boolean;
  streamSrc: string;
  setMediaViewport: (updater: (current: MediaViewportRect) => MediaViewportRect) => void;
  setLastFrameAt: (updater: (previous: number | null) => number) => void;
  setLastFrameIntervalMs: (value: number) => void;
  setFrameCount: (updater: (value: number) => number) => void;
}

export function useMediaViewport(deps: UseMediaViewportDeps) {
  const {
    frameRef, imgRef, videoRef, isVideoStream, streamSrc,
    setMediaViewport, setLastFrameAt, setLastFrameIntervalMs, setFrameCount,
  } = deps;

  // Recompute the inner-media rect when the frame, the media element, or the
  // window resizes. The first measurement is fired synchronously so the
  // overlay positions are correct before the next paint.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const update = () => {
      const media = isVideoStream ? videoRef.current : imgRef.current;
      const nextViewport = measureContainedMedia(frame, media);
      setMediaViewport((current) => sameMediaViewport(current, nextViewport) ? current : nextViewport);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    const media = isVideoStream ? videoRef.current : imgRef.current;
    if (media) observer.observe(media);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [frameRef, imgRef, isVideoStream, setMediaViewport, streamSrc, videoRef]);

  // Frame-load handler used by the JSX: refreshes the viewport rect (so the
  // very first frame is sized correctly) and updates the frame-rate stats.
  const handleFrameLoad = useCallback(() => {
    const frame = frameRef.current;
    if (frame) {
      const media = isVideoStream ? videoRef.current : imgRef.current;
      const nextViewport = measureContainedMedia(frame, media);
      setMediaViewport((current) => sameMediaViewport(current, nextViewport) ? current : nextViewport);
    }
    const now = Date.now();
    setLastFrameAt((previous) => {
      if (previous) setLastFrameIntervalMs(now - previous);
      return now;
    });
    setFrameCount((value) => value + 1);
  }, [
    frameRef, imgRef, isVideoStream, setFrameCount, setLastFrameAt,
    setLastFrameIntervalMs, setMediaViewport, videoRef,
  ]);

  return { handleFrameLoad };
}

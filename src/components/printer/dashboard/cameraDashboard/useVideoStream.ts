/**
 * useVideoStream — negotiates the live `<video>` source for the camera
 * dashboard:
 *
 *   • WebRTC  → connectWhepVideoStream; on failure flag webRtcFailed so the
 *               UI can fall back to MJPEG/HLS automatically.
 *   • HLS     → dynamically import('hls.js'); if HLS isn't supported in
 *               this browser, set `video.src` directly so Safari (native
 *               HLS) still plays.
 *   • Other   → set `video.src` to the stream URL.
 *
 * The browser-USB source is handled by `useBrowserUsbCamera` instead; this
 * hook skips immediately if `isBrowserUsbCamera` is true. Cleanup destroys
 * the HLS instance / detaches the WebRTC session / clears `<video src>` so
 * decoders release resources.
 */
import { useEffect, type RefObject } from 'react';
import { connectWhepVideoStream } from '../../../../services/camera/webrtcStream';

export interface UseVideoStreamDeps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isVideoStream: boolean;
  streamSrc: string;
  cameraSourceUrl: string;
  webRtcUrl: string;
  activeCameraId: string | undefined;
  isBrowserUsbCamera: boolean;
  useWebRtcStream: boolean;
  webcamMainStreamProtocol: string;
  webRtcIceServers: string;
  setLastFrameAt: (timestamp: number | null) => void;
  setImageFailed: (failed: boolean) => void;
  setWebRtcFailed: (failed: boolean) => void;
  setMessage: (msg: string) => void;
  onFatalError: () => void;
}

export function useVideoStream(deps: UseVideoStreamDeps) {
  const {
    videoRef, isVideoStream, streamSrc, cameraSourceUrl, webRtcUrl, activeCameraId,
    isBrowserUsbCamera, useWebRtcStream,
    webcamMainStreamProtocol, webRtcIceServers,
    setLastFrameAt, setImageFailed, setWebRtcFailed, setMessage, onFatalError,
  } = deps;

  // Reset failed-image flag + clear last-frame stamp whenever the live
  // image source URL changes (a user switching streams should erase the
  // old failure state so the new stream gets a clean chance).
  useEffect(() => {
    setImageFailed(false);
    setLastFrameAt(null);
  }, [cameraSourceUrl, setImageFailed, setLastFrameAt]);

  // Reset WebRTC failure flag when the camera or WHEP URL changes.
  useEffect(() => {
    setWebRtcFailed(false);
  }, [activeCameraId, webRtcUrl, setWebRtcFailed]);

  useEffect(() => {
    if (!isVideoStream || !videoRef.current || !streamSrc) return undefined;
    const video = videoRef.current;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    if (isBrowserUsbCamera) return undefined;
    if (useWebRtcStream) {
      void connectWhepVideoStream(video, {
        url: streamSrc,
        iceServersText: webRtcIceServers,
        onConnected: () => setLastFrameAt(Date.now()),
      }).then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        cleanup = dispose;
      }).catch(() => {
        if (!disposed) {
          setWebRtcFailed(true);
          setMessage('WebRTC camera connection failed; falling back to MJPEG/HLS.');
        }
      });
      return () => {
        disposed = true;
        cleanup?.();
        video.srcObject = null;
      };
    }
    if (webcamMainStreamProtocol === 'hls' || streamSrc.startsWith('/camera-rtsp-hls')) {
      void import('hls.js').then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          video.src = streamSrc;
          cleanup = () => {
            video.removeAttribute('src');
            video.load();
          };
          return;
        }
        const hls = new Hls({ lowLatencyMode: true });
        hls.loadSource(streamSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) onFatalError();
        });
        cleanup = () => hls.destroy();
      }).catch(onFatalError);
      return () => {
        disposed = true;
        cleanup?.();
      };
    }

    video.src = streamSrc;
    return () => {
      disposed = true;
      cleanup?.();
      if (!cleanup) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [
    isBrowserUsbCamera, isVideoStream, onFatalError, setLastFrameAt,
    setMessage, setWebRtcFailed, streamSrc, useWebRtcStream, videoRef,
    webRtcIceServers, webcamMainStreamProtocol,
  ]);
}

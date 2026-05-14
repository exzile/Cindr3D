/**
 * useBrowserUsbCamera — when the active camera is a browser-USB source,
 * negotiates `navigator.mediaDevices.getUserMedia` and attaches the resulting
 * `MediaStream` to the live `<video>` element.
 *
 * Cleanup stops the stream tracks and detaches `srcObject` so the camera LED
 * turns off and the OS releases the device. The effect re-runs when the user
 * picks a different device or when the dashboard switches off USB sources.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface UseBrowserUsbCameraDeps {
  isBrowserUsbCamera: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  webcamUsbDeviceId: string | undefined;
  webcamUsbDeviceLabel: string | undefined;
  setImageFailed: (failed: boolean) => void;
  setLastFrameAt: (timestamp: number | null) => void;
  setMessage: (msg: string) => void;
}

export function useBrowserUsbCamera(deps: UseBrowserUsbCameraDeps) {
  const {
    isBrowserUsbCamera, videoRef,
    webcamUsbDeviceId, webcamUsbDeviceLabel,
    setImageFailed, setLastFrameAt, setMessage,
  } = deps;

  // Internal — owned by the hook because nothing outside the USB stream
  // negotiation reads the active MediaStream.
  const browserUsbStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isBrowserUsbCamera) {
      browserUsbStreamRef.current?.getTracks().forEach((track) => track.stop());
      browserUsbStreamRef.current = null;
      return undefined;
    }

    let disposed = false;
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setImageFailed(true);
      setMessage('This browser cannot access USB cameras.');
      return undefined;
    }

    setImageFailed(false);
    const videoConstraints: boolean | MediaTrackConstraints = webcamUsbDeviceId
      ? { deviceId: { exact: webcamUsbDeviceId } }
      : true;
    void navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints })
      .then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        browserUsbStreamRef.current = stream;
        video.srcObject = stream;
        void video.play().catch(() => {});
        setLastFrameAt(Date.now());
        setMessage(webcamUsbDeviceLabel ? `Using USB camera: ${webcamUsbDeviceLabel}` : 'Using browser USB camera.');
      })
      .catch(() => {
        setImageFailed(true);
        setMessage('Unable to open USB camera. Check browser permissions and camera settings.');
      });

    return () => {
      disposed = true;
      browserUsbStreamRef.current?.getTracks().forEach((track) => track.stop());
      browserUsbStreamRef.current = null;
      if (video.srcObject) video.srcObject = null;
    };
  }, [
    isBrowserUsbCamera, setImageFailed, setLastFrameAt,
    setMessage, videoRef, webcamUsbDeviceId, webcamUsbDeviceLabel,
  ]);
}

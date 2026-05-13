/**
 * Pure camera stream derivation for the dashboard. Given prefs and current
 * connection flags, this resolves the URLs and booleans the panel renders.
 */
import {
  cameraDisplayUrl,
  cameraUrlWithCredentials,
  normalizeCameraStreamUrl,
  preferredCameraStreamUrl,
} from '../../../../utils/cameraStreamUrl';
import type { CameraHdBridgeQuality, CameraStreamConfig, DuetPrefs } from '../../../../utils/duetPrefs';
import {
  cameraRtspBridgeUrl,
  cameraRtspSourceUrl,
  cameraServerUsbBridgeUrl,
  normalizedHost,
} from './cameraUrls';

export interface CameraStreamStateParams {
  prefs: DuetPrefs;
  hostname: string;
  hdBridgeQuality: CameraHdBridgeQuality;
  serviceWebcamUrl?: string;
  activeCamera?: CameraStreamConfig;
  webRtcFailed: boolean;
  imageFailed: boolean;
  streamRevision: number;
}

export interface CameraStreamState {
  hdMainIsRtsp: boolean;
  streamUrl: string;
  displayUrl: string;
  videoUrl: string;
  backendRecordingUrl: string;
  isBrowserUsbCamera: boolean;
  isServerUsbCamera: boolean;
  webRtcUrl: string;
  useWebRtcStream: boolean;
  isVideoStream: boolean;
  cameraSourceUrl: string;
  hasCamera: boolean;
  hdLiveNeedsBridge: boolean;
  canUseBackendRecording: boolean;
  streamSrc: string;
}

export function isHdMainRtspStream(prefs: DuetPrefs): boolean {
  return prefs.webcamMainStreamProtocol === 'rtsp' || /^rtsp:\/\//i.test(prefs.webcamMainStreamUrl.trim());
}

export function fallbackWebcamUrl(hostname: string, serviceWebcamUrl?: string): string {
  if (serviceWebcamUrl) return serviceWebcamUrl;
  const host = normalizedHost(hostname);
  return host ? `${host}/webcam/?action=stream` : '';
}

export function dashboardStreamUrl(
  prefs: DuetPrefs,
  hostname: string,
  hdBridgeQuality: CameraHdBridgeQuality,
  serviceWebcamUrl?: string,
): string {
  if (prefs.webcamSourceType === 'browser-usb') return 'browser-usb://camera';
  if (prefs.webcamSourceType === 'server-usb') return cameraServerUsbBridgeUrl(prefs, hdBridgeQuality);
  if (prefs.webcamStreamPreference === 'main' && isHdMainRtspStream(prefs)) {
    return cameraRtspBridgeUrl(prefs, hostname, hdBridgeQuality);
  }
  return preferredCameraStreamUrl(prefs, fallbackWebcamUrl(hostname, serviceWebcamUrl));
}

export function dashboardVideoUrl(streamUrl: string, prefs: DuetPrefs): string {
  if (streamUrl.startsWith('browser-usb://')) return '';
  if (streamUrl.startsWith('/camera-rtsp-hls')) return streamUrl;
  return cameraUrlWithCredentials(normalizeCameraStreamUrl(streamUrl), prefs.webcamUsername, prefs.webcamPassword);
}

export function dashboardBackendRecordingUrl(prefs: DuetPrefs, hostname: string): string {
  if (prefs.webcamSourceType === 'server-usb') return prefs.webcamServerUsbDevice.trim();
  const rtspUrl = cameraRtspSourceUrl(prefs, hostname);
  return rtspUrl ? cameraUrlWithCredentials(rtspUrl, prefs.webcamUsername, prefs.webcamPassword) : '';
}

export function dashboardStreamSrc(
  cameraSourceUrl: string,
  isBrowserUsbCamera: boolean,
  useWebRtcStream: boolean,
  streamRevision: number,
): string {
  if (!cameraSourceUrl) return '';
  if (useWebRtcStream) return cameraSourceUrl;
  if (isBrowserUsbCamera) return 'browser-usb';
  const separator = cameraSourceUrl.includes('?') ? '&' : '?';
  return `${cameraSourceUrl}${separator}_cameraReload=${streamRevision}`;
}

export function buildCameraStreamState({
  prefs,
  hostname,
  hdBridgeQuality,
  serviceWebcamUrl,
  activeCamera,
  webRtcFailed,
  imageFailed,
  streamRevision,
}: CameraStreamStateParams): CameraStreamState {
  const hdMainIsRtsp = isHdMainRtspStream(prefs);
  const streamUrl = dashboardStreamUrl(prefs, hostname, hdBridgeQuality, serviceWebcamUrl);
  const displayUrl = streamUrl.startsWith('browser-usb://')
    ? ''
    : cameraDisplayUrl(streamUrl, prefs.webcamUsername, prefs.webcamPassword);
  const videoUrl = dashboardVideoUrl(streamUrl, prefs);
  const backendRecordingUrl = dashboardBackendRecordingUrl(prefs, hostname);
  const isBrowserUsbCamera = prefs.webcamSourceType === 'browser-usb';
  const isServerUsbCamera = prefs.webcamSourceType === 'server-usb';
  const webRtcUrl = activeCamera?.webRtcEnabled ? activeCamera.webRtcUrl.trim() : '';
  const useWebRtcStream = Boolean(webRtcUrl && !webRtcFailed);
  const isVideoStream = useWebRtcStream
    || isBrowserUsbCamera
    || isServerUsbCamera
    || (prefs.webcamStreamPreference === 'main'
      && (hdMainIsRtsp || prefs.webcamMainStreamProtocol === 'hls' || prefs.webcamMainStreamProtocol === 'http'));
  const cameraSourceUrl = useWebRtcStream ? webRtcUrl : isBrowserUsbCamera ? 'browser-usb' : isVideoStream ? videoUrl : displayUrl;
  const hdLiveNeedsBridge = hdMainIsRtsp || isServerUsbCamera;
  const canUseBackendRecording = ((prefs.webcamStreamPreference === 'main' && hdMainIsRtsp) || isServerUsbCamera)
    && Boolean(backendRecordingUrl);

  return {
    hdMainIsRtsp,
    streamUrl,
    displayUrl,
    videoUrl,
    backendRecordingUrl,
    isBrowserUsbCamera,
    isServerUsbCamera,
    webRtcUrl,
    useWebRtcStream,
    isVideoStream,
    cameraSourceUrl,
    hasCamera: Boolean(cameraSourceUrl) && !imageFailed,
    hdLiveNeedsBridge,
    canUseBackendRecording,
    streamSrc: dashboardStreamSrc(cameraSourceUrl, isBrowserUsbCamera, useWebRtcStream, streamRevision),
  };
}

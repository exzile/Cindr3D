/**
 * URL builders + camera-command relay for the CameraDashboardPanel. Pure
 * functions over DuetPrefs (no React, no parent state). Extracted to keep
 * the panel focused on UI orchestration.
 */
import { cameraUrlWithCredentials, normalizeCameraStreamUrl } from '../../../../utils/cameraStreamUrl';
import type { CameraHdBridgeQuality, DuetPrefs } from '../../../../utils/duetPrefs';

export function normalizedHost(hostname: string): string {
  const value = hostname.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  return `http://${value.replace(/\/$/, '')}`;
}

export function cameraPtzBaseUrl(prefs: DuetPrefs, fallbackHostname: string): string {
  const cameraHost = prefs.webcamHost.trim();
  if (cameraHost) {
    return /^https?:\/\//i.test(cameraHost) ? cameraHost : `http://${cameraHost}`;
  }
  const streamUrl = prefs.webcamUrl.trim() || prefs.webcamMainStreamUrl.trim();
  if (streamUrl) {
    try {
      return new URL(streamUrl).origin;
    } catch {
      // Fall through to the printer host if the stream URL is a relative path.
    }
  }
  return normalizedHost(fallbackHostname);
}

export function cameraRtspSourceUrl(prefs: DuetPrefs, fallbackHostname: string): string {
  const configured = normalizeCameraStreamUrl(prefs.webcamMainStreamUrl);
  let rtspUrl = /^rtsp:\/\//i.test(configured) ? configured : '';
  if (!rtspUrl) {
    if (prefs.webcamPathPreset !== 'amcrest') return '';
    const base = cameraPtzBaseUrl(prefs, fallbackHostname);
    if (!base) return '';
    try {
      const parsed = new URL(base);
      rtspUrl = `rtsp://${parsed.hostname}:554/cam/realmonitor?channel=1&subtype=0`;
    } catch {
      return '';
    }
  }
  return rtspUrl;
}

export function cameraRtspBridgeUrl(prefs: DuetPrefs, fallbackHostname: string, quality: CameraHdBridgeQuality): string {
  const rtspUrl = cameraRtspSourceUrl(prefs, fallbackHostname);
  if (!rtspUrl) return '';
  const withCredentials = cameraUrlWithCredentials(rtspUrl, prefs.webcamUsername, prefs.webcamPassword);
  const params = new URLSearchParams({ url: withCredentials, quality });
  return `/camera-rtsp-hls?${params.toString()}`;
}

export function cameraServerUsbBridgeUrl(prefs: DuetPrefs, quality: CameraHdBridgeQuality): string {
  const device = prefs.webcamServerUsbDevice.trim();
  if (!device) return '';
  const params = new URLSearchParams({ source: 'usb', device, quality });
  return `/camera-rtsp-hls?${params.toString()}`;
}

// Set of in-flight <img> elements kept alive while their request resolves —
// the browser garbage-collects an <img> without an active reference, which
// would silently abort the camera command before it reaches the device.
const pendingCameraCommandImages = new Set<HTMLImageElement>();

/**
 * Fire-and-forget HTTP GET (or dev-mode proxied POST) used for one-shot
 * camera commands (PTZ moves, preset recalls). Resolves on load, error,
 * or `timeoutMs` — whichever fires first.
 */
export function sendCameraCommand(url: string, username: string, password: string, timeoutMs = 600): Promise<void> {
  return new Promise((resolve) => {
    const image = new window.Image();
    pendingCameraCommandImages.add(image);
    let timeout = 0;
    const finish = () => {
      window.clearTimeout(timeout);
      pendingCameraCommandImages.delete(image);
      resolve();
    };
    timeout = window.setTimeout(finish, timeoutMs);
    image.onload = finish;
    image.onerror = finish;
    const normalizedUrl = normalizeCameraStreamUrl(url);
    if (import.meta.env.DEV) {
      const controller = new AbortController();
      timeout = window.setTimeout(() => {
        controller.abort();
        finish();
      }, timeoutMs);
      void fetch('/camera-command-proxy', {
        method: 'POST',
        headers: {
          'x-camera-url': normalizedUrl,
          'x-camera-username': username.trim(),
          'x-camera-password': password,
        },
        cache: 'no-store',
        signal: controller.signal,
      }).catch(() => undefined).finally(() => {
        finish();
      });
      return;
    }
    image.src = cameraUrlWithCredentials(normalizedUrl, username, password);
  });
}

import type { DuetPrefs } from '../types/duet-prefs.types';
import type { CameraStreamConfig } from '../types/duet-prefs.types';
import { cameraToLegacyPrefs, legacyCameraFromPrefs, normalizeDuetPrefs } from './duetPrefs';

export function normalizeCameraStreamUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^rtsp:\/\//i.test(trimmed)) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function canBrowserRenderCameraUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function cameraOriginFromPrefs(prefs: DuetPrefs): string {
  const host = prefs.webcamHost.trim();
  if (host) {
    const normalized = normalizeCameraStreamUrl(host);
    try {
      return new URL(normalized).origin;
    } catch {
      return '';
    }
  }

  const stream = normalizeCameraStreamUrl(prefs.webcamUrl || prefs.webcamMainStreamUrl || '');
  if (!stream || /^rtsp:\/\//i.test(stream)) return '';
  try {
    return new URL(stream).origin;
  } catch {
    return '';
  }
}

function amcrestMjpegStreamUrl(prefs: DuetPrefs, subtype: 0 | 1): string {
  if (prefs.webcamPathPreset !== 'amcrest') return '';
  const origin = cameraOriginFromPrefs(prefs);
  return origin ? `${origin}/cgi-bin/mjpg/video.cgi?channel=1&subtype=${subtype}` : '';
}

export function enabledCamerasFromPrefs(prefs: DuetPrefs): CameraStreamConfig[] {
  return normalizeDuetPrefs(prefs).cameras.filter((camera) => camera.enabled);
}

export function cameraByIdFromPrefs(prefs: DuetPrefs, cameraId?: string): CameraStreamConfig {
  const normalized = normalizeDuetPrefs(prefs);
  return normalized.cameras.find((camera) => camera.id === cameraId)
    ?? normalized.cameras.find((camera) => camera.id === normalized.activeCameraId)
    ?? normalized.cameras[0]
    ?? legacyCameraFromPrefs(normalized);
}

export function prefsWithCamera(prefs: DuetPrefs, cameraId?: string): DuetPrefs {
  const normalized = normalizeDuetPrefs(prefs);
  const camera = cameraByIdFromPrefs(normalized, cameraId);
  return {
    ...normalized,
    ...cameraToLegacyPrefs(camera),
    activeCameraId: camera.id,
  };
}

export function prefsWithDashboardCamera(prefs: DuetPrefs): DuetPrefs {
  const normalized = normalizeDuetPrefs(prefs);
  return prefsWithCamera(normalized, normalized.dashboardCameraId || normalized.activeCameraId);
}

export function preferredCameraStreamUrl(prefs: DuetPrefs, fallbackUrl = ''): string {
  prefs = prefsWithCamera(prefs);
  const main = normalizeCameraStreamUrl(prefs.webcamMainStreamUrl ?? '');
  if (prefs.webcamStreamPreference === 'main') {
    const browserMain = amcrestMjpegStreamUrl(prefs, 0);
    if (browserMain) return browserMain;
    if (canBrowserRenderCameraUrl(main)) return main;
  }
  return normalizeCameraStreamUrl(prefs.webcamUrl?.trim() || amcrestMjpegStreamUrl(prefs, 1) || fallbackUrl);
}

export function previewCameraStreamUrl(prefs: DuetPrefs, fallbackUrl = ''): string {
  prefs = prefsWithCamera(prefs);
  const subStream = normalizeCameraStreamUrl(prefs.webcamUrl ?? '');
  if (subStream && canBrowserRenderCameraUrl(subStream)) return subStream;

  const amcrestSubStream = amcrestMjpegStreamUrl(prefs, 1);
  if (amcrestSubStream) return amcrestSubStream;

  const fallback = normalizeCameraStreamUrl(fallbackUrl);
  return canBrowserRenderCameraUrl(fallback) ? fallback : '';
}

export function cameraUrlWithCredentials(url: string, username: string, password: string): string {
  if (!url || !username.trim()) return url;
  try {
    const parsed = new URL(url);
    parsed.username = username.trim();
    parsed.password = password;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function cameraDisplayUrl(url: string, username: string, password: string): string {
  const normalized = normalizeCameraStreamUrl(url);
  if (!normalized || !username.trim()) return normalized;
  if (import.meta.env.DEV) {
    const params = new URLSearchParams({
      url: normalized,
      username: username.trim(),
      password,
    });
    return `/camera-proxy?${params.toString()}`;
  }
  return cameraUrlWithCredentials(normalized, username, password);
}

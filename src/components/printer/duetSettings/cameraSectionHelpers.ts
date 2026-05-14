/**
 * Helpers for the CameraSection settings page:
 *   • URL normalisation for MJPEG/RTSP streams (vendor-aware presets,
 *     fallback hostnames, cache-busting)
 *   • probeCameraStreamUrl — fetches the first ~128 bytes and infers whether
 *     the response is a valid image / multipart stream so the "Test" button
 *     can report success/failure without consuming the full stream
 *
 * Extracted from cameraSection.tsx so the React component can stay focused
 * on UI state + form wiring.
 */
import type { CameraPathPreset } from '../../../utils/duetPrefs';
import { normalizeCameraStreamUrl } from '../../../utils/cameraStreamUrl';

export type CameraTestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; url: string }
  | { status: 'error'; url: string; message: string };

export function withCacheBuster(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}_test=${Date.now()}`;
}

export function cameraBaseUrl(address: string, fallbackHostname: string): string {
  const trimmed = (address.trim() || fallbackHostname.trim());
  if (trimmed) return normalizeCameraStreamUrl(trimmed);
  return '';
}

export function cameraAddressFromStreamUrl(streamUrl: string): string {
  const normalized = normalizeCameraStreamUrl(streamUrl);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return parsed.origin;
  } catch {
    return '';
  }
}

export function cameraOriginFromAddress(address: string, fallbackHostname: string): string {
  return cameraBaseUrl(address, fallbackHostname).replace(/\/+$/, '');
}

export function cameraRtspHost(address: string, fallbackHostname: string): string {
  const origin = cameraOriginFromAddress(address, fallbackHostname);
  if (!origin) return '';
  try {
    const parsed = new URL(origin);
    return parsed.host;
  } catch {
    return origin.replace(/^https?:\/\//i, '');
  }
}

export function amcrestSubStreamUrl(address: string, fallbackHostname: string): string {
  const base = cameraOriginFromAddress(address, fallbackHostname);
  return base ? `${base}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1` : '';
}

export function amcrestMainStreamUrl(address: string, fallbackHostname: string): string {
  const host = cameraRtspHost(address, fallbackHostname);
  return host ? `rtsp://${host}:554/cam/realmonitor?channel=1&subtype=0` : '';
}

export function cameraStreamCandidates(
  address: string,
  streamUrl: string,
  fallbackHostname: string,
  pathPreset: CameraPathPreset,
): string[] {
  const explicit = streamUrl.trim();
  if (explicit) return [normalizeCameraStreamUrl(explicit)];

  const base = cameraBaseUrl(address, fallbackHostname).replace(/\/+$/, '');
  if (!base) return [];

  const genericCandidates = [
    `${base}/webcam/?action=stream`,
    `${base}/video.cgi`,
    `${base}/mjpg/video.mjpg`,
    `${base}/videostream.cgi`,
    `${base}/stream`,
    `${base}/video`,
  ];

  if (pathPreset !== 'amcrest') return genericCandidates;

  return [
    `${base}/cgi-bin/mjpg/video.cgi?channel=1&subtype=1`,
    `${base}/cgi-bin/mjpg/video.cgi?channel=1&subtype=0`,
    `${base}/cgi-bin/snapshot.cgi?channel=1`,
    `${base}/cgi-bin/snapshot.cgi`,
    ...genericCandidates,
  ];
}

export function cameraTestDisplayUrl(url: string): string {
  if (!url.startsWith('/camera-proxy')) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    const target = parsed.searchParams.get('url');
    return target ?? 'Camera proxy stream';
  } catch {
    return 'Camera proxy stream';
  }
}

export async function probeCameraStreamUrl(url: string, timeoutMs = 4500): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      contentType.includes('multipart/x-mixed-replace') ||
      contentType.startsWith('image/') ||
      contentType.includes('octet-stream')
    ) {
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error(contentType ? `Unexpected content type: ${contentType}` : 'No stream data returned.');
    const { value } = await reader.read();
    reader.releaseLock();
    if (!value || value.byteLength === 0) throw new Error('No camera bytes returned.');
    const header = new TextDecoder().decode(value.slice(0, Math.min(value.byteLength, 128))).toLowerCase();
    if (header.includes('--') || header.includes('content-type: image/') || value[0] === 0xff || value[0] === 0x89) return;
    throw new Error(contentType ? `Unexpected content type: ${contentType}` : 'Response was not an image or MJPEG stream.');
  } finally {
    window.clearTimeout(timeout);
  }
}

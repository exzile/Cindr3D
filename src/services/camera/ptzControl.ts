import type { CameraPtzPreset, CameraStreamConfig } from '../../utils/duetPrefs';

export type PtzDirection = 'up' | 'down' | 'left' | 'right' | 'home' | 'zoomIn' | 'zoomOut';

export interface CameraPtzRequest {
  startUrl: string;
  stopUrl?: string;
  username: string;
  password: string;
}

const AMCREST_CODES: Record<PtzDirection, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'GotoPreset',
  zoomIn: 'ZoomTele',
  zoomOut: 'ZoomWide',
};

const REOLINK_OPS: Record<PtzDirection, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'ToPos',
  zoomIn: 'ZoomInc',
  zoomOut: 'ZoomDec',
};

export function cameraPtzBaseUrl(camera: CameraStreamConfig, fallbackHostname: string): string {
  const cameraHost = camera.host.trim();
  if (cameraHost) {
    return /^https?:\/\//i.test(cameraHost) ? cameraHost : `http://${cameraHost}`;
  }
  const streamUrl = camera.url.trim() || camera.mainStreamUrl.trim();
  if (streamUrl) {
    try {
      return new URL(streamUrl).origin;
    } catch {
      // Fall through to the printer host if the stream URL is a relative path.
    }
  }
  const fallback = fallbackHostname.trim();
  if (!fallback) return '';
  return /^https?:\/\//i.test(fallback) ? fallback : `http://${fallback}`;
}

export function ptzProviderLabel(provider: CameraStreamConfig['ptzProvider']): string {
  switch (provider) {
    case 'amcrest':
      return 'Amcrest / Dahua';
    case 'reolink':
      return 'Reolink';
    case 'tapo':
      return 'Tapo';
    case 'hikvision':
      return 'Hikvision';
    case 'onvif':
      return 'ONVIF bridge';
    case 'generic-http':
      return 'Generic HTTP';
    case 'off':
    default:
      return 'Off';
  }
}

export function fillPtzTemplate(template: string, camera: CameraStreamConfig, fallbackHostname: string, values: Record<string, string | number>): string {
  const base = cameraPtzBaseUrl(camera, fallbackHostname).replace(/\/+$/, '');
  const replacements: Record<string, string> = {
    base,
    host: base,
    username: encodeURIComponent(camera.username),
    password: encodeURIComponent(camera.password),
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, encodeURIComponent(String(value))])),
  };
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => replacements[key] ?? '');
}

function amcrestUrl(camera: CameraStreamConfig, fallbackHostname: string, action: 'start' | 'stop', code: string, speed: number, presetToken = ''): string {
  const base = cameraPtzBaseUrl(camera, fallbackHostname);
  if (!base) return '';
  const url = new URL('/cgi-bin/ptz.cgi', base);
  url.searchParams.set('action', action);
  url.searchParams.set('channel', '1');
  url.searchParams.set('code', code);
  url.searchParams.set('arg1', '0');
  url.searchParams.set('arg2', presetToken || String(speed));
  url.searchParams.set('arg3', '0');
  return url.toString();
}

function reolinkUrl(camera: CameraStreamConfig, fallbackHostname: string, op: string, speed: number, presetToken = ''): string {
  const base = cameraPtzBaseUrl(camera, fallbackHostname);
  if (!base) return '';
  const url = new URL('/cgi-bin/api.cgi', base);
  url.searchParams.set('cmd', 'PtzCtrl');
  url.searchParams.set('action', '0');
  url.searchParams.set('channel', '0');
  url.searchParams.set('op', op);
  url.searchParams.set('speed', String(Math.round(speed * 8)));
  if (presetToken) url.searchParams.set('id', presetToken);
  if (camera.username) url.searchParams.set('user', camera.username);
  if (camera.password) url.searchParams.set('password', camera.password);
  return url.toString();
}

export function buildPtzMoveRequest(camera: CameraStreamConfig, fallbackHostname: string, direction: PtzDirection, speed: number): CameraPtzRequest | null {
  if (!camera.ptzEnabled || camera.ptzProvider === 'off') return null;
  const clampedSpeed = Math.max(1, Math.min(8, Math.round(speed || 1)));
  if (camera.ptzMoveUrlTemplate.trim()) {
    const startUrl = fillPtzTemplate(camera.ptzMoveUrlTemplate.trim(), camera, fallbackHostname, {
      direction,
      vendorDirection: direction,
      speed: clampedSpeed,
      action: 'start',
    });
    const stopUrl = direction === 'home'
      ? undefined
      : fillPtzTemplate(camera.ptzMoveUrlTemplate.trim(), camera, fallbackHostname, {
        direction,
        vendorDirection: direction,
        speed: clampedSpeed,
        action: 'stop',
      });
    return { startUrl, stopUrl, username: camera.username, password: camera.password };
  }
  if (camera.ptzProvider === 'amcrest') {
    const code = AMCREST_CODES[direction];
    return {
      startUrl: amcrestUrl(camera, fallbackHostname, 'start', code, direction === 'home' ? 1 : clampedSpeed),
      stopUrl: direction === 'home' ? undefined : amcrestUrl(camera, fallbackHostname, 'stop', code, clampedSpeed),
      username: camera.username,
      password: camera.password,
    };
  }
  if (camera.ptzProvider === 'reolink') {
    return {
      startUrl: reolinkUrl(camera, fallbackHostname, REOLINK_OPS[direction], clampedSpeed),
      username: '',
      password: '',
    };
  }
  return null;
}

export function buildPtzPresetRequest(camera: CameraStreamConfig, fallbackHostname: string, preset: CameraPtzPreset): CameraPtzRequest | null {
  if (!camera.ptzEnabled || camera.ptzProvider === 'off') return null;
  if (camera.ptzPresetUrlTemplate.trim()) {
    return {
      startUrl: fillPtzTemplate(camera.ptzPresetUrlTemplate.trim(), camera, fallbackHostname, {
        preset: preset.token,
        presetName: preset.name,
        action: 'goto',
      }),
      username: camera.username,
      password: camera.password,
    };
  }
  if (camera.ptzProvider === 'amcrest') {
    return {
      startUrl: amcrestUrl(camera, fallbackHostname, 'start', 'GotoPreset', 1, preset.token),
      username: camera.username,
      password: camera.password,
    };
  }
  if (camera.ptzProvider === 'reolink') {
    return {
      startUrl: reolinkUrl(camera, fallbackHostname, 'ToPos', 1, preset.token),
      username: '',
      password: '',
    };
  }
  return null;
}

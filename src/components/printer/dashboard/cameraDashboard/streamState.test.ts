import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type CameraStreamConfig } from '../../../../utils/duetPrefs';
import { buildCameraStreamState, dashboardStreamSrc, fallbackWebcamUrl } from './streamState';

const baseCamera: CameraStreamConfig = {
  id: 'cam-1',
  label: 'Camera',
  role: 'top',
  enabled: true,
  resolution: '1080p',
  sourceType: 'network',
  host: '',
  url: '',
  mainStreamUrl: '',
  usbDeviceId: '',
  usbDeviceLabel: '',
  serverUsbDevice: '',
  streamPreference: 'sub',
  mainStreamProtocol: 'rtsp',
  rtspTransport: 'tcp',
  pathPreset: 'generic',
  username: '',
  password: '',
  ptzEnabled: false,
  ptzProvider: 'off',
  ptzMoveUrlTemplate: '',
  ptzPresetUrlTemplate: '',
  ptzPresets: [],
  ptzStartPresetId: '',
  webRtcEnabled: false,
  webRtcUrl: '',
  webRtcIceServers: '',
};

describe('streamState', () => {
  it('builds a browser USB state without network URLs', () => {
    const state = buildCameraStreamState({
      prefs: { ...DEFAULT_PREFS, webcamSourceType: 'browser-usb' },
      hostname: 'printer.local',
      hdBridgeQuality: '720p',
      activeCamera: baseCamera,
      webRtcFailed: false,
      imageFailed: false,
      streamRevision: 4,
    });

    expect(state.streamUrl).toBe('browser-usb://camera');
    expect(state.displayUrl).toBe('');
    expect(state.cameraSourceUrl).toBe('browser-usb');
    expect(state.streamSrc).toBe('browser-usb');
    expect(state.hasCamera).toBe(true);
  });

  it('routes RTSP main streams through the bridge and enables backend recording', () => {
    const state = buildCameraStreamState({
      prefs: {
        ...DEFAULT_PREFS,
        webcamStreamPreference: 'main',
        webcamMainStreamProtocol: 'rtsp',
        webcamMainStreamUrl: 'rtsp://camera.local/live',
        webcamUsername: 'user',
        webcamPassword: 'secret',
      },
      hostname: 'printer.local',
      hdBridgeQuality: '1080p',
      activeCamera: baseCamera,
      webRtcFailed: false,
      imageFailed: false,
      streamRevision: 7,
    });

    expect(state.hdMainIsRtsp).toBe(true);
    expect(state.streamUrl).toContain('/camera-rtsp-hls?');
    expect(state.streamUrl).toContain('quality=1080p');
    expect(state.backendRecordingUrl).toBe('rtsp://user:secret@camera.local/live');
    expect(state.canUseBackendRecording).toBe(true);
    expect(state.streamSrc).toContain('_cameraReload=7');
  });

  it('prefers active WebRTC streams until they fail', () => {
    const activeCamera = { ...baseCamera, webRtcEnabled: true, webRtcUrl: 'whep://camera.local/live' };
    const state = buildCameraStreamState({
      prefs: { ...DEFAULT_PREFS, webcamUrl: 'http://camera.local/snapshot.jpg' },
      hostname: 'printer.local',
      hdBridgeQuality: 'native',
      activeCamera,
      webRtcFailed: false,
      imageFailed: false,
      streamRevision: 1,
    });

    expect(state.useWebRtcStream).toBe(true);
    expect(state.cameraSourceUrl).toBe('whep://camera.local/live');
    expect(state.streamSrc).toBe('whep://camera.local/live');
  });

  it('normalizes fallback URLs and reload query separators', () => {
    expect(fallbackWebcamUrl('printer.local')).toBe('http://printer.local/webcam/?action=stream');
    expect(dashboardStreamSrc('http://camera.local/video?quality=sd', false, false, 2)).toBe('http://camera.local/video?quality=sd&_cameraReload=2');
  });
});

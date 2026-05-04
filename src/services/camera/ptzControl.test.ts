import { describe, expect, it } from 'vitest';
import { normalizeDuetPrefs } from '../../utils/duetPrefs';
import { buildPtzMoveRequest, buildPtzPresetRequest } from './ptzControl';

describe('camera PTZ control URLs', () => {
  it('builds Amcrest start and stop requests for live movement', () => {
    const camera = {
      ...normalizeDuetPrefs({ webcamHost: '192.168.1.55', webcamPathPreset: 'amcrest' }).cameras[0],
      ptzEnabled: true,
      ptzProvider: 'amcrest' as const,
    };

    const request = buildPtzMoveRequest(camera, 'printer.local', 'left', 4);

    expect(request?.startUrl).toContain('/cgi-bin/ptz.cgi?action=start');
    expect(request?.startUrl).toContain('code=Left');
    expect(request?.startUrl).toContain('arg2=4');
    expect(request?.stopUrl).toContain('action=stop');
  });

  it('uses saved preset tokens for preset jumps', () => {
    const camera = {
      ...normalizeDuetPrefs({ webcamHost: '192.168.1.55', webcamPathPreset: 'amcrest' }).cameras[0],
      ptzEnabled: true,
      ptzProvider: 'amcrest' as const,
    };

    const request = buildPtzPresetRequest(camera, 'printer.local', {
      id: 'preset-1',
      name: 'First layer',
      token: '3',
      createdAt: 1,
    });

    expect(request?.startUrl).toContain('code=GotoPreset');
    expect(request?.startUrl).toContain('arg2=3');
  });

  it('fills generic templates for bridge-backed providers', () => {
    const camera = {
      ...normalizeDuetPrefs({ webcamHost: 'cam.local' }).cameras[0],
      ptzEnabled: true,
      ptzProvider: 'onvif' as const,
      ptzMoveUrlTemplate: '{base}/ptz?move={direction}&speed={speed}',
    };

    const request = buildPtzMoveRequest(camera, 'printer.local', 'zoomIn', 8);

    expect(request?.startUrl).toBe('http://cam.local/ptz?move=zoomIn&speed=8');
  });
});

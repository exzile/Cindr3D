import { describe, expect, it } from 'vitest';
import { cameraToLegacyPrefs, normalizeDuetPrefs } from './duetPrefs';

describe('multi-camera preference migration', () => {
  it('upgrades legacy single-camera fields into a primary camera', () => {
    const prefs = normalizeDuetPrefs({
      webcamHost: '192.168.1.55',
      webcamUrl: 'http://192.168.1.55/stream',
      webcamUsername: 'cam',
    });

    expect(prefs.cameras).toHaveLength(1);
    expect(prefs.cameras[0]).toMatchObject({
      id: 'primary',
      label: 'Main',
      host: '192.168.1.55',
      url: 'http://192.168.1.55/stream',
      username: 'cam',
      enabled: true,
    });
  });

  it('mirrors the active camera back to legacy fields', () => {
    const prefs = normalizeDuetPrefs({
      activeCameraId: 'side',
      cameras: [
        { ...normalizeDuetPrefs({ webcamUrl: 'http://main/stream' }).cameras[0], id: 'primary', label: 'Main' },
        { ...normalizeDuetPrefs({ webcamUrl: 'http://side/stream' }).cameras[0], id: 'side', label: 'Side', role: 'side' },
      ],
    });

    expect(prefs.webcamUrl).toBe('http://side/stream');
    expect(cameraToLegacyPrefs(prefs.cameras[1]).webcamUrl).toBe('http://side/stream');
  });
});

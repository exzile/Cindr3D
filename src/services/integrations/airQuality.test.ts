import { describe, expect, it } from 'vitest';
import { DEFAULT_AIR_QUALITY_CONFIG } from '../../store/airQualityStore';
import { evaluateAirQuality, parseAirQualityPayload } from './airQuality';

describe('air quality helpers', () => {
  it('parses common sensor payload shapes', () => {
    expect(parseAirQualityPayload('612', 'voc')).toBe(612);
    expect(parseAirQualityPayload('{"pm2_5":42}', 'pm25')).toBe(42);
    expect(parseAirQualityPayload('{"eco2":1100}', 'co2')).toBe(1100);
  });

  it('evaluates warning and critical thresholds', () => {
    const warning = evaluateAirQuality({
      ...DEFAULT_AIR_QUALITY_CONFIG,
      readings: {
        ...DEFAULT_AIR_QUALITY_CONFIG.readings,
        voc: { value: 600, updatedAt: Date.now() },
      },
    });
    const critical = evaluateAirQuality({
      ...DEFAULT_AIR_QUALITY_CONFIG,
      readings: {
        ...DEFAULT_AIR_QUALITY_CONFIG.readings,
        pm25: { value: 80, updatedAt: Date.now() },
      },
    });

    expect(warning.level).toBe('warn');
    expect(critical.level).toBe('critical');
    expect(critical.message).toContain('PM2.5');
  });
});

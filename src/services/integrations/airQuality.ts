import type { AirQualityPrinterConfig, AirQualitySensorKey } from '../../store/airQualityStore';
import { AIR_QUALITY_SENSOR_LABELS } from '../../store/airQualityStore';

export type AirQualityLevel = 'ok' | 'warn' | 'critical';

export interface AirQualityStatus {
  level: AirQualityLevel;
  message: string;
  exceeded: Array<{ sensor: AirQualitySensorKey; value: number; limit: number; level: Exclude<AirQualityLevel, 'ok'> }>;
}

export function parseAirQualityPayload(payload: string, sensor: AirQualitySensorKey): number | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const aliases: Record<AirQualitySensorKey, string[]> = {
        voc: ['voc', 'tvoc', 'iaq', 'value'],
        pm25: ['pm25', 'pm2_5', 'pm2.5', 'particles', 'value'],
        co2: ['co2', 'eco2', 'carbonDioxide', 'value'],
      };
      for (const key of aliases[sensor]) {
        const next = Number(record[key]);
        if (Number.isFinite(next)) return next;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function evaluateAirQuality(config: AirQualityPrinterConfig): AirQualityStatus {
  const exceeded: AirQualityStatus['exceeded'] = [];
  for (const sensor of Object.keys(config.sensors) as AirQualitySensorKey[]) {
    const reading = config.readings[sensor];
    if (reading.value === null) continue;
    const limits = config.sensors[sensor];
    if (reading.value >= limits.pauseAt) {
      exceeded.push({ sensor, value: reading.value, limit: limits.pauseAt, level: 'critical' });
    } else if (reading.value >= limits.warnAt) {
      exceeded.push({ sensor, value: reading.value, limit: limits.warnAt, level: 'warn' });
    }
  }

  const critical = exceeded.filter((item) => item.level === 'critical');
  if (critical.length > 0) {
    return {
      level: 'critical',
      message: formatExceeded(critical),
      exceeded,
    };
  }

  const warnings = exceeded.filter((item) => item.level === 'warn');
  if (warnings.length > 0) {
    return {
      level: 'warn',
      message: formatExceeded(warnings),
      exceeded,
    };
  }

  return { level: 'ok', message: 'Air quality nominal', exceeded: [] };
}

function formatExceeded(items: AirQualityStatus['exceeded']): string {
  return items
    .map((item) => `${AIR_QUALITY_SENSOR_LABELS[item.sensor]} ${item.value.toFixed(0)} >= ${item.limit.toFixed(0)}`)
    .join(', ');
}

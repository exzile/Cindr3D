import type { DuetObjectModel } from '../../types/duet';
import type { ChamberControlConfig } from '../../store/chamberControlStore';

export interface ChamberReading {
  source: 'rrf' | 'klipper' | 'mqtt' | 'none';
  label: string;
  temperatureC: number | null;
  targetC: number | null;
  heaterIndex: number | null;
}

export interface ChamberRampCommand {
  targetC: number;
  done: boolean;
}

const CHAMBER_SENSOR_RE = /(chamber|enclosure|cabinet|ambient)/i;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rrfChamberReading(model: Partial<DuetObjectModel>): ChamberReading | null {
  const heaterIndex = model.heat?.chamberHeaters?.[0];
  if (!finite(heaterIndex)) return null;
  const heater = model.heat?.heaters?.[heaterIndex];
  if (!heater || !finite(heater.current)) return null;
  return {
    source: 'rrf',
    label: `RRF chamber heater ${heaterIndex}`,
    temperatureC: heater.current,
    targetC: finite(heater.active) ? heater.active : null,
    heaterIndex,
  };
}

function klipperSensorReading(model: Partial<DuetObjectModel>): ChamberReading | null {
  const sensors = model.sensors?.analog ?? [];
  const sensor = sensors.find((item) => CHAMBER_SENSOR_RE.test(item.name) && finite(item.lastReading));
  if (!sensor) return null;
  return {
    source: 'klipper',
    label: sensor.name || 'Klipper chamber sensor',
    temperatureC: sensor.lastReading,
    targetC: null,
    heaterIndex: null,
  };
}

function mqttSensorReading(config: ChamberControlConfig): ChamberReading | null {
  if (!finite(config.externalTemperatureC)) return null;
  return {
    source: 'mqtt',
    label: config.mqttTopic || 'MQTT chamber topic',
    temperatureC: config.externalTemperatureC,
    targetC: null,
    heaterIndex: null,
  };
}

export function resolveChamberReading(
  model: Partial<DuetObjectModel>,
  config: ChamberControlConfig,
): ChamberReading {
  const bySource: Record<ChamberControlConfig['source'], Array<ChamberReading | null>> = {
    auto: [rrfChamberReading(model), klipperSensorReading(model), mqttSensorReading(config)],
    rrf: [rrfChamberReading(model)],
    klipper: [klipperSensorReading(model)],
    mqtt: [mqttSensorReading(config)],
  };

  return bySource[config.source].find(Boolean) ?? {
    source: 'none',
    label: 'No chamber source',
    temperatureC: null,
    targetC: null,
    heaterIndex: null,
  };
}

export function parseChamberTemperaturePayload(payload: string): number | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const value = record.temperatureC ?? record.temperature ?? record.temp ?? record.value;
      const next = Number(value);
      return Number.isFinite(next) ? next : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function computeChamberRampCommand(
  config: ChamberControlConfig,
  now: number,
): ChamberRampCommand | null {
  if (!config.enabled || !config.rampEnabled || !config.rampActive || !config.rampStartedAt) return null;
  const elapsedSteps = Math.max(0, Math.floor((now - config.rampStartedAt) / (config.rampStepMinutes * 60 * 1000)));
  const targetC = Math.min(
    config.targetTemperatureC,
    config.rampStartTemperatureC + elapsedSteps * config.rampStepC,
  );
  if (config.rampLastCommandedC === targetC) return null;
  return {
    targetC,
    done: targetC >= config.targetTemperatureC,
  };
}

export function shouldChamberPreheat(prevStatus: string, nextStatus: string, config: ChamberControlConfig): boolean {
  return config.enabled
    && config.preheatBeforePrint
    && config.targetTemperatureC > 0
    && prevStatus !== 'processing'
    && nextStatus === 'processing';
}

export function shouldChamberCooldown(prevStatus: string, nextStatus: string, config: ChamberControlConfig): boolean {
  return config.enabled
    && config.cooldownOnDone
    && prevStatus === 'processing'
    && nextStatus === 'idle';
}

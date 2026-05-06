import type { DuetObjectModel } from '../../types/duet';
import type { DoorSensorConfig } from '../../store/doorSensorStore';

const DOOR_RE = /(door|enclosure|lid|cover)/i;

export function parseDoorPayload(payload: string, config: DoorSensorConfig): boolean | null {
  const normalized = payload.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === config.openPayload.trim().toLowerCase()) return true;
  if (normalized === config.closedPayload.trim().toLowerCase()) return false;
  if (['open', 'opened', 'true', '1', 'on', 'triggered'].includes(normalized)) return true;
  if (['closed', 'close', 'false', '0', 'off', 'clear', 'cleared'].includes(normalized)) return false;

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed === 'boolean') return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const value = record.open ?? record.doorOpen ?? record.triggered ?? record.state ?? record.value;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return parseDoorPayload(value, config);
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveDoorOpenFromModel(model: Partial<DuetObjectModel>, config: DoorSensorConfig): boolean | null {
  if (config.source !== 'rrf' && config.source !== 'klipper') return null;
  const endstop = model.sensors?.endstops?.find((sensor) => DOOR_RE.test(sensor.type));
  if (endstop) return endstop.triggered;
  const analog = model.sensors?.analog?.find((sensor) => DOOR_RE.test(sensor.name));
  if (analog && Number.isFinite(analog.lastReading)) return analog.lastReading > 0;
  return null;
}

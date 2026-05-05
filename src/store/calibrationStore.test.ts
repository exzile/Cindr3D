import { describe, expect, it } from 'vitest';
import {
  getCalibrationStatus,
  getComponentStatus,
  getMoistureStatus,
  summarizeMaintenance,
  type CalibrationRecord,
  type SpoolMoistureProfile,
  type WearComponent,
} from './calibrationStore';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('calibration lifecycle helpers', () => {
  it('classifies calibration records by interval age', () => {
    const now = Date.UTC(2026, 4, 5);
    const record: CalibrationRecord = {
      itemId: 'bed-mesh',
      lastRunAt: now - 10 * DAY_MS,
      intervalDays: 14,
      note: '',
    };

    expect(getCalibrationStatus(record, now)).toBe('ok');
    expect(getCalibrationStatus({ ...record, lastRunAt: now - 12 * DAY_MS }, now)).toBe('upcoming');
    expect(getCalibrationStatus({ ...record, lastRunAt: now - 15 * DAY_MS }, now)).toBe('overdue');
    expect(getCalibrationStatus({ ...record, lastRunAt: null }, now)).toBe('never');
  });

  it('tracks wear reminders from hour and filament counters', () => {
    const component: WearComponent = {
      id: 'component-1',
      printerId: 'printer-1',
      name: 'Nozzle',
      category: 'nozzle',
      installedAt: 0,
      hoursOn: 20,
      filamentKm: 1.9,
      reminderHours: null,
      reminderFilamentKm: 2,
      replacementCost: null,
      note: '',
    };

    expect(getComponentStatus(component).status).toBe('upcoming');
    expect(getComponentStatus({ ...component, filamentKm: 2.1 }).status).toBe('overdue');
  });

  it('models moisture exposure from opened date and humidity', () => {
    const now = Date.UTC(2026, 4, 5);
    const profile: SpoolMoistureProfile = {
      spoolId: 'spool-1',
      openedAt: now - 12 * DAY_MS,
      ambientHumidityPct: 55,
      sensorLabel: '',
      lastUpdatedAt: now,
    };

    expect(getMoistureStatus(profile, now).status).toBe('upcoming');
    expect(getMoistureStatus({ ...profile, openedAt: now - 20 * DAY_MS }, now).status).toBe('overdue');
  });

  it('summarizes calibration, wear, and moisture lifecycle counts', () => {
    const now = Date.UTC(2026, 4, 5);
    const calibration: CalibrationRecord[] = [{
      itemId: 'first-layer',
      lastRunAt: null,
      intervalDays: 7,
      note: '',
    }];
    const component: WearComponent = {
      id: 'component-1',
      printerId: 'printer-1',
      name: 'Belts',
      category: 'belt',
      installedAt: 0,
      hoursOn: 50,
      filamentKm: 0,
      reminderHours: 1000,
      reminderFilamentKm: null,
      replacementCost: null,
      note: '',
    };
    const moisture: SpoolMoistureProfile = {
      spoolId: 'spool-1',
      openedAt: now - 30 * DAY_MS,
      ambientHumidityPct: 60,
      sensorLabel: '',
      lastUpdatedAt: now,
    };

    expect(summarizeMaintenance(calibration, [component], [moisture], now)).toEqual({
      overdue: 1,
      upcoming: 0,
      ok: 1,
      never: 1,
    });
  });
});

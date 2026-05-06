import { beforeEach, describe, expect, it } from 'vitest';
import { useSchedulingStore } from '../store/schedulingStore';

describe('scheduling store', () => {
  beforeEach(() => {
    useSchedulingStore.setState({
      scheduledPrints: [],
      quietWindows: [],
      touWindows: [],
      utilityRateConfigs: [],
      solarIntegrationConfigs: [],
      bedClearSettings: [],
      checklistItems: [
        {
          id: 'bed-clean',
          label: 'Bed is clean',
          description: 'Clean bed',
          defaultEnabled: true,
        },
      ],
      checklistOverrides: [],
    });
  });

  it('treats the after-midnight half of an overnight quiet window as quiet', () => {
    useSchedulingStore.getState().addQuietWindow({
      label: 'Monday night',
      days: [1],
      startHour: 22,
      startMinute: 0,
      endHour: 7,
      endMinute: 0,
    });

    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-04T23:00:00').getTime())).toBe(true);
    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-05T02:00:00').getTime())).toBe(true);
    expect(useSchedulingStore.getState().isQuietAt(new Date('2026-05-05T08:00:00').getTime())).toBe(false);
  });

  it('returns no checklist items when the printer checklist is hidden', () => {
    useSchedulingStore.getState().setChecklistVisible('printer-a', false);

    expect(useSchedulingStore.getState().getChecklistForPrinter('printer-a')).toEqual([]);
  });

  it('finds the cheapest TOU start window for a printer', () => {
    useSchedulingStore.getState().addTOUWindow({
      printerId: 'printer-a',
      label: 'Peak',
      tier: 'peak',
      ratePerKwh: 0.42,
      days: [1],
      startHour: 12,
      startMinute: 0,
      endHour: 20,
      endMinute: 0,
    });
    useSchedulingStore.getState().addTOUWindow({
      printerId: 'printer-a',
      label: 'Off peak',
      tier: 'off-peak',
      ratePerKwh: 0.08,
      days: [1],
      startHour: 22,
      startMinute: 0,
      endHour: 6,
      endMinute: 0,
    });

    const cheapest = useSchedulingStore.getState().findCheapestStart(
      'printer-a',
      new Date('2026-05-04T12:00:00').getTime(),
      2 * 60 * 60 * 1000,
      250,
      18,
    );

    expect(cheapest?.tier).toBe('off-peak');
    expect(new Date(cheapest?.start ?? 0).getHours()).toBe(22);
  });

  it('considers minute-level TOU boundaries as candidate cheapest starts', () => {
    useSchedulingStore.getState().addTOUWindow({
      printerId: 'printer-a',
      label: 'Short off peak',
      tier: 'off-peak',
      ratePerKwh: 0.05,
      days: [1],
      startHour: 10,
      startMinute: 7,
      endHour: 10,
      endMinute: 37,
    });

    const cheapest = useSchedulingStore.getState().findCheapestStart(
      'printer-a',
      new Date('2026-05-04T10:00:00').getTime(),
      20 * 60 * 1000,
      1000,
      1,
    );

    const start = new Date(cheapest?.start ?? 0);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(7);
    expect(cheapest?.estimatedEnergyCost).toBeCloseTo((20 / 60) * 0.05);
  });

  it('schedules a print at the cheapest configured window', () => {
    useSchedulingStore.getState().addTOUWindow({
      printerId: 'printer-a',
      label: 'Late off peak',
      tier: 'off-peak',
      ratePerKwh: 0.07,
      days: [1],
      startHour: 23,
      startMinute: 0,
      endHour: 5,
      endMinute: 0,
    });

    const id = useSchedulingStore.getState().schedulePrintAtCheapestWindow({
      jobId: null,
      filePath: '0:/gcodes/bracket.gcode',
      fileName: 'bracket.gcode',
      printerId: 'printer-a',
      earliestStart: new Date('2026-05-04T10:00:00').getTime(),
      estimatedDurationMs: 90 * 60 * 1000,
      note: 'Scheduled for off-peak rate',
      status: 'scheduled',
      printerWatts: 250,
      horizonHours: 18,
    });

    expect(id).toBeTruthy();
    expect(useSchedulingStore.getState().scheduledPrints[0]).toMatchObject({
      fileName: 'bracket.gcode',
      printerId: 'printer-a',
    });
    expect(new Date(useSchedulingStore.getState().scheduledPrints[0].scheduledStart).getHours()).toBe(23);
  });

  it('gates print starts on configured solar surplus', () => {
    useSchedulingStore.getState().upsertSolarIntegrationConfig('printer-a', {
      enabled: true,
      provider: 'enphase-envoy',
      minSurplusW: 700,
      currentSurplusW: 650,
    });

    expect(useSchedulingStore.getState().canStartWithSolarSurplus('printer-a', 500)).toMatchObject({
      allowed: false,
      requiredW: 700,
      provider: 'enphase-envoy',
    });

    useSchedulingStore.getState().upsertSolarIntegrationConfig('printer-a', {
      currentSurplusW: 900,
    });

    expect(useSchedulingStore.getState().canStartWithSolarSurplus('printer-a', 500).allowed).toBe(true);
  });

  it('does not persist solar API keys in scheduling storage', () => {
    useSchedulingStore.getState().upsertSolarIntegrationConfig('printer-a', {
      enabled: true,
      provider: 'custom',
      endpointUrl: 'https://solar.example',
      apiKey: 'secret-token',
    });

    const partialize = useSchedulingStore.persist.getOptions().partialize;
    const persisted = partialize
      ? partialize(useSchedulingStore.getState())
      : useSchedulingStore.getState();

    expect(JSON.stringify(persisted)).not.toContain('secret-token');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { routeJobForPrinters, usePrintQueueStore, type PrintQueueJob } from './printQueueStore';
import type { SavedPrinter } from '../types/duet';
import { DEFAULT_PREFS } from '../utils/duetPrefs';

function printer(id: string, name: string, overrides: Partial<typeof DEFAULT_PREFS.machineConfig> = {}): SavedPrinter {
  return {
    id,
    name,
    config: { hostname: `${id}.local`, password: '', mode: 'standalone', boardType: 'duet' },
    prefs: {
      ...DEFAULT_PREFS,
      machineConfig: {
        ...DEFAULT_PREFS.machineConfig,
        ...overrides,
      },
    },
  };
}

describe('printQueueStore', () => {
  beforeEach(() => {
    usePrintQueueStore.getState().clearAll();
    usePrintQueueStore.setState({ activeJobId: null, autoStart: true });
  });

  it('routes jobs by nozzle and build volume compatibility', () => {
    const job = {
      printerId: null,
      requirements: {
        nozzleDiameter: 0.6,
        buildVolume: { x: 220, y: 220, z: 220 },
      },
      routing: { mode: 'auto', candidatePrinterIds: [], blockedReasons: {}, summary: '' },
    } satisfies Pick<PrintQueueJob, 'printerId' | 'requirements' | 'routing'>;

    const route = routeJobForPrinters(job, [
      printer('small', 'Small', { buildVolumeX: 180, buildVolumeY: 180, buildVolumeZ: 180, nozzleDiameter: 0.6 }),
      printer('large', 'Large', { buildVolumeX: 300, buildVolumeY: 300, buildVolumeZ: 300, nozzleDiameter: 0.6 }),
      printer('fine', 'Fine', { buildVolumeX: 300, buildVolumeY: 300, buildVolumeZ: 300, nozzleDiameter: 0.4 }),
    ]);

    expect(route.candidatePrinterIds).toEqual(['large']);
    expect(route.blockedReasons.small).toContain('Build volume too small');
    expect(route.blockedReasons.fine).toContain('Needs 0.6mm nozzle');
  });

  it('splits copies across compatible printers', () => {
    const printers = [
      printer('alpha', 'Alpha'),
      printer('beta', 'Beta'),
    ];

    usePrintQueueStore.getState().addCopies({
      filePath: '0:/gcodes/widget.gcode',
      copies: 3,
      routingMode: 'auto',
    }, printers);

    const jobs = usePrintQueueStore.getState().jobs;
    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.copyIndex)).toEqual([1, 2, 3]);
    expect(jobs.map((job) => job.printerId)).toEqual(['alpha', 'beta', 'alpha']);
    expect(jobs.every((job) => job.status === 'ready')).toBe(true);
  });
});

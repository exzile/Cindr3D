import { describe, expect, it, beforeEach } from 'vitest';
import { buildPrinterContextSnapshot } from './printerContextSnapshot';
import { usePrinterStore } from '../../store/printerStore';
import { useCalibrationStore } from '../../store/calibrationStore';
import { useVisionStore } from '../../store/visionStore';
import type { SavedPrinter } from '../../types/duet';

const NOW = 1_700_000_000_000;

function mockActivePrinter(printer: Partial<SavedPrinter> & { id: string; name: string }): void {
  const full: SavedPrinter = {
    id: printer.id,
    name: printer.name,
    config: printer.config ?? ({} as SavedPrinter['config']),
    prefs: printer.prefs ?? ({} as SavedPrinter['prefs']),
  } as SavedPrinter;
  usePrinterStore.setState({
    printers: [full],
    activePrinterId: printer.id,
  });
}

function resetStores(): void {
  usePrinterStore.setState({
    printers: [],
    activePrinterId: '',
    connected: false,
    model: {},
  });
  useCalibrationStore.setState({ calibrationByPrinterId: {} });
  useVisionStore.setState({ recentChecks: [], recentFrames: [], recentDiagnoses: [] });
}

describe('buildPrinterContextSnapshot', () => {
  beforeEach(() => {
    resetStores();
  });

  it('reports a "no active printer" string when nothing is selected', () => {
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('No active printer');
  });

  it('summarizes active printer + status when nothing else is populated', () => {
    mockActivePrinter({ id: 'p1', name: 'Voron' });
    usePrinterStore.setState({
      connected: true,
      model: { state: { status: 'idle' } } as unknown as ReturnType<typeof usePrinterStore.getState>['model'],
    });
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('Voron');
    expect(out).toContain('idle');
    expect(out).toContain('connected');
  });

  it('reports current job and layer counts when printing', () => {
    mockActivePrinter({ id: 'p1', name: 'Voron' });
    usePrinterStore.setState({
      connected: true,
      model: {
        state: { status: 'processing' },
        job: {
          layer: 42,
          file: { fileName: 'cube.gcode', numLayers: 200 },
        },
      } as unknown as ReturnType<typeof usePrinterStore.getState>['model'],
    });
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('cube.gcode');
    expect(out).toContain('layer 42/200');
  });

  it('includes up to 3 most-recent calibration results across all items', () => {
    mockActivePrinter({ id: 'p1', name: 'Voron' });
    useCalibrationStore.setState({
      calibrationByPrinterId: {
        p1: {
          'pressure-advance': {
            itemId: 'pressure-advance',
            lastRunAt: NOW - 10_000,
            intervalDays: 45,
            note: '',
            results: [
              {
                id: 'r1',
                recordedAt: NOW - 10_000,
                appliedValue: 0.045,
                measurements: {},
                photoIds: [],
                aiConfidence: 0.87,
                note: '',
              },
            ],
          },
          'first-layer': {
            itemId: 'first-layer',
            lastRunAt: NOW - 5_000,
            intervalDays: 7,
            note: '',
            results: [
              {
                id: 'r2',
                recordedAt: NOW - 5_000,
                appliedValue: -0.02,
                measurements: {},
                photoIds: [],
                aiConfidence: null,
                note: '',
              },
            ],
          },
        },
      } as unknown as ReturnType<typeof useCalibrationStore.getState>['calibrationByPrinterId'],
    } as Partial<ReturnType<typeof useCalibrationStore.getState>>);
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('Recent calibrations');
    expect(out).toContain('Pressure advance');
    expect(out).toContain('First-layer test');
    expect(out).toContain('aiConf=0.87');
  });

  it('includes recent failure checks scoped to active printer only', () => {
    mockActivePrinter({ id: 'p1', name: 'Voron' });
    useVisionStore.setState({
      recentChecks: [
        {
          id: 'c1',
          printerId: 'p1',
          printerName: 'Voron',
          cameraId: 'cam',
          cameraLabel: 'Cam',
          createdAt: NOW - 1000,
          result: {
            category: 'spaghetti',
            confidence: 0.91,
            severity: 'critical',
            summary: 'detached',
            evidence: [],
            suggestedActions: [],
            shouldPause: true,
            requiresConfirmation: false,
          },
        },
        {
          id: 'c2',
          printerId: 'other',
          printerName: 'X',
          cameraId: 'cam',
          cameraLabel: 'Cam',
          createdAt: NOW - 500,
          result: {
            category: 'layer-shift',
            confidence: 0.5,
            severity: 'warning',
            summary: '',
            evidence: [],
            suggestedActions: [],
            shouldPause: false,
            requiresConfirmation: false,
          },
        },
      ],
      recentFrames: [],
      recentDiagnoses: [],
    } as unknown as Partial<ReturnType<typeof useVisionStore.getState>>);
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('spaghetti');
    expect(out).toContain('critical');
    expect(out).not.toContain('layer-shift');
  });

  it('works when calibration history is absent (still emits printer line)', () => {
    mockActivePrinter({ id: 'p1', name: 'Voron' });
    const out = buildPrinterContextSnapshot(NOW);
    expect(out).toContain('Voron');
    expect(out).not.toContain('Recent calibrations');
    expect(out).not.toContain('Recent failure checks');
  });
});

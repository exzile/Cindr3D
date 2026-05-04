import { describe, expect, it } from 'vitest';
import { summarizeComparison, type ComparisonSession } from './abComparisonStore';

function session(aSeconds?: number, bSeconds?: number): ComparisonSession {
  return {
    id: 's1',
    filePath: '0:/gcodes/cube.gcode',
    fileName: 'cube.gcode',
    createdAt: 1,
    updatedAt: 1,
    legs: {
      a: {
        printerId: 'a',
        printerName: 'Alpha',
        status: 'done',
        totalSeconds: aSeconds,
        quality: 'acceptable',
        notes: '',
        samples: [],
      },
      b: {
        printerId: 'b',
        printerName: 'Beta',
        status: 'done',
        totalSeconds: bSeconds,
        quality: 'best',
        notes: '',
        samples: [],
      },
    },
  };
}

describe('summarizeComparison', () => {
  it('reports faster and quality winners independently', () => {
    const report = summarizeComparison(session(2400, 2600));

    expect(report.fasterLeg).toBe('a');
    expect(report.qualityLeg).toBe('b');
    expect(report.timeDeltaSeconds).toBe(200);
  });

  it('waits for timing when both totals are not available', () => {
    const report = summarizeComparison(session(2400));

    expect(report.fasterLeg).toBeNull();
    expect(report.timeDeltaSeconds).toBeNull();
  });
});

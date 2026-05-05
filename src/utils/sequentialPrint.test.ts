import { describe, expect, it } from 'vitest';
import {
  buildSequentialPrintPlan,
  formatSequentialPrintWarnings,
  type SequentialPrintObject,
} from './sequentialPrint';

function object(id: string, x: number, y: number, height: number): SequentialPrintObject {
  return {
    id,
    label: id,
    bounds: {
      minX: x,
      maxX: x + 10,
      minY: y,
      maxY: y + 10,
      minZ: 0,
      maxZ: height,
    },
  };
}

describe('buildSequentialPrintPlan', () => {
  it('orders objects by nearest reachable print start', () => {
    const plan = buildSequentialPrintPlan(
      [
        object('far', 100, 0, 10),
        object('near', 10, 0, 10),
        object('middle', 30, 0, 10),
      ],
      { gantryHeight: 30 },
    );

    expect(plan.orderedIds).toEqual(['near', 'middle', 'far']);
    expect(plan.warnings).toEqual([]);
  });

  it('warns for tall objects and finished-part printhead collisions', () => {
    const plan = buildSequentialPrintPlan(
      [
        object('tall', 0, 0, 60),
        object('next', 18, 0, 10),
      ],
      {
        gantryHeight: 30,
        printheadMinX: -15,
        printheadMaxX: 15,
        printheadMinY: -5,
        printheadMaxY: 5,
      },
    );

    expect(plan.warnings.map((warning) => warning.message)).toEqual([
      'tall is 60.0mm tall, above the 30.0mm gantry clearance.',
      'next printhead clearance overlaps finished object tall.',
    ]);
    expect(formatSequentialPrintWarnings(plan.warnings)).toContain('SEQUENTIAL_PRINT_WARNINGS_START');
  });
});

import { describe, expect, it } from 'vitest';
import { parseM486Labels } from '../services/gcode/m486Labels';

describe('parseM486Labels', () => {
  it('returns empty when no M486 lines are present', () => {
    expect(parseM486Labels('G1 X0 Y0\nG1 X10 Y10\n')).toEqual({
      labels: [],
      declaredCount: null,
    });
  });

  it('extracts ids and names from PrusaSlicer-style M486 S<id> A"<name>"', () => {
    const gcode = [
      'M486 T2',
      'M486 S0 A"Cube_id_0"',
      'G1 X10 Y10',
      'M486 S-1',
      'M486 S1 A"Cone_id_1"',
      'G1 X20 Y20',
    ].join('\n');

    const { labels, declaredCount } = parseM486Labels(gcode);
    expect(declaredCount).toBe(2);
    expect(labels).toEqual([
      { id: 0, name: 'Cube_id_0' },
      { id: 1, name: 'Cone_id_1' },
    ]);
  });

  it('attaches a name from a preceding "; printing object" comment (Cura)', () => {
    const gcode = [
      '; printing object Tower',
      'M486 S0',
      'G1 X10 Y10',
    ].join('\n');
    expect(parseM486Labels(gcode).labels).toEqual([{ id: 0, name: 'Tower' }]);
  });

  it('does not leak a pending name across an S-1 separator', () => {
    const gcode = [
      '; printing object Tower',
      'M486 S-1',
      'M486 S0',
    ].join('\n');
    expect(parseM486Labels(gcode).labels).toEqual([{ id: 0, name: '' }]);
  });

  it('deduplicates repeated start markers and keeps the first non-empty name', () => {
    const gcode = [
      'M486 S0 A"First"',
      'M486 S0',
      'M486 S0 A"Renamed"', // first non-empty wins
    ].join('\n');
    expect(parseM486Labels(gcode).labels).toEqual([{ id: 0, name: 'First' }]);
  });

  it('ignores M486 lines that have no S parameter', () => {
    const gcode = ['M486 T3', 'M486 P0', 'M486 U0'].join('\n');
    const { labels, declaredCount } = parseM486Labels(gcode);
    expect(declaredCount).toBe(3);
    expect(labels).toEqual([]);
  });

  it('returns labels sorted by id', () => {
    const gcode = [
      'M486 S2 A"C"',
      'M486 S0 A"A"',
      'M486 S1 A"B"',
    ].join('\n');
    expect(parseM486Labels(gcode).labels).toEqual([
      { id: 0, name: 'A' },
      { id: 1, name: 'B' },
      { id: 2, name: 'C' },
    ]);
  });
});

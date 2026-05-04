import { describe, expect, it } from 'vitest';
import {
  findMatchingObject,
  matchObjectNames,
  normalizeObjectName,
} from '../services/gcode/objectNameMatch';

describe('normalizeObjectName', () => {
  it('lowercases and trims', () => {
    expect(normalizeObjectName('  Cube  ')).toBe('cube');
  });

  it('strips PrusaSlicer _id_<n> and _copy_<n> suffixes', () => {
    expect(normalizeObjectName('Cube_id_0')).toBe('cube');
    expect(normalizeObjectName('Cube_id_2_copy_1')).toBe('cube');
  });

  it('strips file extensions', () => {
    expect(normalizeObjectName('Cube.stl')).toBe('cube');
    expect(normalizeObjectName('Tower.3mf')).toBe('tower');
  });

  it('strips _copy_/_instance_ suffixes', () => {
    expect(normalizeObjectName('Tower_copy_3')).toBe('tower');
    expect(normalizeObjectName('Tower_instance')).toBe('tower');
  });

  it('strips chained suffixes (extension then PrusaSlicer id)', () => {
    expect(normalizeObjectName('Cube.stl_id_0_copy_1')).toBe('cube');
  });

  it('preserves base names that contain digits', () => {
    expect(normalizeObjectName('M3_nut')).toBe('m3_nut');
  });

  it('strips 4+ digit suffixes but not 1-3 digit ones', () => {
    expect(normalizeObjectName('Cube_0001')).toBe('cube');
    expect(normalizeObjectName('Cube_42')).toBe('cube_42');
  });
});

describe('matchObjectNames', () => {
  it('matches exact (case-insensitive)', () => {
    expect(matchObjectNames('Cube', 'cube')).toBe(true);
  });

  it('matches across slicer suffix differences', () => {
    expect(matchObjectNames('Cube', 'Cube_id_0_copy_2')).toBe(true);
    expect(matchObjectNames('Tower.stl', 'Tower_id_5')).toBe(true);
  });

  it('refuses to match when both names are too short and differ', () => {
    expect(matchObjectNames('a', 'ab')).toBe(false);
    expect(matchObjectNames('Cu', 'Cube')).toBe(false);
  });

  it('returns false on undefined/empty inputs', () => {
    expect(matchObjectNames(undefined, 'Cube')).toBe(false);
    expect(matchObjectNames('Cube', '')).toBe(false);
  });

  it('does not falsely match unrelated short prefixes', () => {
    // "Cu" normalized is "cu", "Cube" normalized is "cube" — substring would
    // match but our minLen guard rejects it.
    expect(matchObjectNames('Cu', 'Cubic_holder')).toBe(false);
  });
});

describe('findMatchingObject', () => {
  const candidates = [
    { name: 'Cube_id_0' },
    { name: 'Sphere_id_1' },
    { name: 'Tower_id_2' },
  ];

  it('finds an exact normalized match', () => {
    expect(findMatchingObject('Cube', candidates, (c) => c.name)).toEqual({ name: 'Cube_id_0' });
  });

  it('returns null when no candidate matches', () => {
    expect(findMatchingObject('Cone', candidates, (c) => c.name)).toBeNull();
  });

  it('returns null for empty/undefined input', () => {
    expect(findMatchingObject(undefined, candidates, (c) => c.name)).toBeNull();
    expect(findMatchingObject('', candidates, (c) => c.name)).toBeNull();
  });

  it('prefers exact match over fuzzy substring match', () => {
    const list = [
      { name: 'Cube_holder' },     // fuzzy candidate
      { name: 'Cube' },            // exact candidate
    ];
    expect(findMatchingObject('Cube', list, (c) => c.name)).toEqual({ name: 'Cube' });
  });
});

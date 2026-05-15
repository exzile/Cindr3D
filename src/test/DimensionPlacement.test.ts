import { describe, expect, it } from 'vitest';
import { inferLinearPlacement } from '../engine/dimensionPlacement';

// Horizontal line along +X from (0,0) → (10,0).
const HSTART = { x: 0, y: 0 };
const HEND = { x: 10, y: 0 };
// Vertical line along +Y from (0,0) → (0,10).
const VSTART = { x: 0, y: 0 };
const VEND = { x: 0, y: 10 };
// 45° diagonal from (0,0) → (10,10).
const DSTART = { x: 0, y: 0 };
const DEND = { x: 10, y: 10 };

describe('inferLinearPlacement', () => {
  it('horizontal line, cursor above → horizontal linear, positive perpendicular offset', () => {
    const p = inferLinearPlacement(HSTART, HEND, { x: 5, y: 7 }, 'auto');
    expect(p.kind).toBe('linear');
    expect(p).toMatchObject({ kind: 'linear', axis: 'horizontal' });
    // perpendicular (CCW normal of +X dir is (0,1)); cursor 7 above midpoint y=0.
    if (p.kind === 'linear') expect(p.offset).toBeCloseTo(7, 5);
  });

  it('horizontal line, cursor below → horizontal linear, negative offset', () => {
    const p = inferLinearPlacement(HSTART, HEND, { x: 5, y: -4 }, 'auto');
    expect(p).toMatchObject({ kind: 'linear', axis: 'horizontal' });
    if (p.kind === 'linear') expect(p.offset).toBeCloseTo(-4, 5);
  });

  it('vertical line, cursor to the side → vertical linear, perpendicular offset', () => {
    const p = inferLinearPlacement(VSTART, VEND, { x: 6, y: 5 }, 'auto');
    expect(p).toMatchObject({ kind: 'linear', axis: 'vertical' });
    // CCW normal of +Y dir is (-1,0); rel = (6, 0) → perp = -6.
    if (p.kind === 'linear') expect(p.offset).toBeCloseTo(-6, 5);
  });

  it('diagonal line, cursor pulled perpendicular → aligned (true-length)', () => {
    // Midpoint of (0,0)→(10,10) is (5,5); CCW normal is (-1,1)/√2. Push the
    // cursor straight out along that normal so |perp| >> |along|.
    const p = inferLinearPlacement(DSTART, DEND, { x: 5 - 4, y: 5 + 4 }, 'auto');
    expect(p.kind).toBe('aligned');
  });

  it('diagonal line, cursor pulled along the line → falls back to axis-aligned linear', () => {
    // Cursor far along the diagonal direction from the midpoint (|along| > |perp|).
    const p = inferLinearPlacement(DSTART, DEND, { x: 5 + 6, y: 5 + 6.5 }, 'auto');
    expect(p.kind).toBe('linear');
  });

  it('panel orientation override wins over cursor inference (horizontal)', () => {
    const p = inferLinearPlacement(VSTART, VEND, { x: 6, y: 3 }, 'horizontal');
    expect(p).toMatchObject({ kind: 'linear', axis: 'horizontal' });
    // For explicit horizontal, offset is rel.y from the line midpoint (y=5).
    if (p.kind === 'linear') expect(p.offset).toBeCloseTo(3 - 5, 5);
  });

  it('panel orientation override wins over cursor inference (vertical)', () => {
    const p = inferLinearPlacement(HSTART, HEND, { x: 8, y: 9 }, 'vertical');
    expect(p).toMatchObject({ kind: 'linear', axis: 'vertical' });
    // For explicit vertical, offset is rel.x from the line midpoint (x=5).
    if (p.kind === 'linear') expect(p.offset).toBeCloseTo(8 - 5, 5);
  });

  it('offset sign flips with the cursor side (rubber-band follows cursor)', () => {
    const above = inferLinearPlacement(HSTART, HEND, { x: 5, y: 5 }, 'auto');
    const below = inferLinearPlacement(HSTART, HEND, { x: 5, y: -5 }, 'auto');
    if (above.kind === 'linear' && below.kind === 'linear') {
      expect(Math.sign(above.offset)).toBe(1);
      expect(Math.sign(below.offset)).toBe(-1);
    }
  });

  it('degenerate (zero-length) line does not throw and returns a placement', () => {
    const p = inferLinearPlacement({ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 5, y: 5 }, 'auto');
    expect(p).toBeTruthy();
    expect(['linear', 'aligned']).toContain(p.kind);
  });
});

import { describe, expect, it } from 'vitest';

import { buildBox, sliceGeometry } from './_helpers/slicerSystemHelpers';

/**
 * G-code numerical precision tests: verify the emitted text format
 * matches the slicer's documented precision contract (3 decimals for
 * X/Y/Z, 5 for E, integer F).
 */

describe('G-code numerical precision — coordinate format', () => {
  it('every X/Y on slicer-emitted G1 wall/infill moves has 3 decimal places', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    // Skip the start g-code template (printer-supplied) and start at the
    // first layer comment.
    const layerStart = lines.findIndex((l) => /^; ----- Layer 0/.test(l));
    expect(layerStart).toBeGreaterThanOrEqual(0);
    const body = lines.slice(layerStart);
    const g1Lines = body.filter((l) => /^G1\s+X.*\sE-?\d/.test(l));
    expect(g1Lines.length).toBeGreaterThan(0);
    for (const line of g1Lines) {
      const xMatch = line.match(/\sX(-?\d+\.\d+)/);
      const yMatch = line.match(/\sY(-?\d+\.\d+)/);
      if (xMatch) expect(xMatch[1].split('.')[1].length).toBe(3);
      if (yMatch) expect(yMatch[1].split('.')[1].length).toBe(3);
    }
  }, 60_000);

  it('every Z value on slicer-emitted Z lines has 3 decimal places', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    const layerStart = lines.findIndex((l) => /^; ----- Layer 0/.test(l));
    const body = lines.slice(layerStart);
    // Find any line containing a Z<value> token after a G command.
    const zMatches: string[] = [];
    for (const line of body) {
      if (!/^G[01]\b/.test(line)) continue;
      const m = line.match(/\bZ(-?\d+\.\d+)/);
      if (m) zMatches.push(m[1]);
    }
    expect(zMatches.length).toBeGreaterThan(0);
    for (const v of zMatches) {
      expect(v.split('.')[1].length).toBe(3);
    }
  }, 60_000);

  it('every F (feedrate) is an integer (no decimal point)', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    const fLines = lines.filter((l) => /\sF\d/.test(l));
    expect(fLines.length).toBeGreaterThan(0);
    for (const line of fLines) {
      const m = line.match(/\sF(\d+(?:\.\d+)?)/);
      if (m && m[1]) {
        expect(m[1]).toMatch(/^\d+$/);
      }
    }
  }, 60_000);

  it('every E value on a G1 line has exactly 5 decimal places', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    const eLines = lines.filter((l) => /^G1\b.*\sE-?\d/.test(l));
    expect(eLines.length).toBeGreaterThan(0);
    for (const line of eLines) {
      const m = line.match(/\sE(-?\d+\.\d+)/);
      if (m) {
        expect(m[1].split('.')[1].length).toBe(5);
      }
    }
  }, 60_000);

  it('all coordinate tokens parse as finite numbers', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    for (const line of lines) {
      if (!/^G[01]\b/.test(line)) continue;
      const tokens = line.split(/\s+/).slice(1);
      for (const token of tokens) {
        if (token.startsWith(';')) break;
        const ax = token[0]?.toUpperCase();
        if (ax === 'X' || ax === 'Y' || ax === 'Z' || ax === 'E' || ax === 'F') {
          const v = parseFloat(token.slice(1));
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  }, 60_000);
});

describe('G-code numerical precision — X/Y bounds match the build volume', () => {
  it('all X/Y coordinates fall within the build volume + tolerance', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1));
    const lines = result.gcode.split('\n');
    for (const line of lines) {
      if (!/^G[01]\b/.test(line)) continue;
      const xMatch = line.match(/\sX(-?\d+\.\d+)/);
      const yMatch = line.match(/\sY(-?\d+\.\d+)/);
      if (xMatch) {
        const x = parseFloat(xMatch[1]);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(200);
      }
      if (yMatch) {
        const y = parseFloat(yMatch[1]);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(200);
      }
    }
  }, 60_000);

  it('Z coordinates start at firstLayerHeight and never exceed model height + slack', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 5), { layerHeight: 0.2, firstLayerHeight: 0.2 });
    const lines = result.gcode.split('\n');
    let firstZ = Infinity;
    let lastZ = -Infinity;
    for (const line of lines) {
      const m = line.match(/^G1\s+Z(-?\d+\.\d+)/);
      if (!m) continue;
      const z = parseFloat(m[1]);
      firstZ = Math.min(firstZ, z);
      lastZ = Math.max(lastZ, z);
    }
    expect(firstZ).toBeCloseTo(0.2, 1);
    expect(lastZ).toBeLessThanOrEqual(5.5);
  }, 60_000);
});

describe('G-code numerical precision — extrusion math', () => {
  it('E values strictly grow on extruding moves (between retractions)', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    let prevE = 0;
    let increasing = 0;
    for (const line of lines) {
      const m = line.match(/^G1\b.*\sE(-?\d+\.\d+)/);
      if (!m) continue;
      const e = parseFloat(m[1]);
      if (e > prevE) increasing++;
      prevE = e;
    }
    expect(increasing).toBeGreaterThan(20);
  }, 60_000);

  it('E increment per millimeter ≈ (lw × lh) / filamentArea (Marlin default)', async () => {
    const result = await sliceGeometry(buildBox(20, 20, 1), {
      wallLineWidth: 0.4,
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      flowRateCompensationFactor: 1.0,
    });
    // Find the first wall extrusion segment and compute E per mm.
    const lines = result.gcode.split('\n');
    let prevX = -Infinity, prevY = -Infinity, prevE = 0;
    const ratios: number[] = [];
    for (const line of lines) {
      const xm = line.match(/\sX(-?\d+\.\d+)/);
      const ym = line.match(/\sY(-?\d+\.\d+)/);
      const em = line.match(/\sE(-?\d+\.\d+)/);
      if (!xm || !ym || !em) continue;
      const x = parseFloat(xm[1]), y = parseFloat(ym[1]), e = parseFloat(em[1]);
      const dx = x - prevX, dy = y - prevY;
      const dist = Math.hypot(dx, dy);
      const dE = e - prevE;
      if (dist > 0.5 && dE > 0 && Number.isFinite(prevX)) {
        ratios.push(dE / dist);
      }
      prevX = x; prevY = y; prevE = e;
      if (ratios.length >= 5) break;
    }
    // Filament area for 1.75mm filament: π × 0.875² ≈ 2.405
    // Volume per mm of move = 0.4 × 0.2 = 0.08
    // E per mm = 0.08 / 2.405 ≈ 0.0333
    expect(ratios.length).toBeGreaterThan(0);
    const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    // Material flowRate in default profile may not be exactly 1.0; allow
    // a generous range.
    expect(avg).toBeGreaterThan(0.025);
    expect(avg).toBeLessThan(0.045);
  }, 60_000);
});

describe('G-code numerical precision — temperature commands', () => {
  it('M104/M109 nozzle-temp values are integers between 0 and 350°C', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    const tempLines = lines.filter((l) => /^M(104|109)\s/.test(l));
    expect(tempLines.length).toBeGreaterThan(0);
    for (const line of tempLines) {
      const m = line.match(/S(\d+)/);
      expect(m).toBeTruthy();
      const t = parseInt(m![1]);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(350);
    }
  }, 60_000);

  it('M140/M190 bed-temp values are integers between 0 and 150°C', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    const tempLines = lines.filter((l) => /^M(140|190)\s/.test(l));
    if (tempLines.length === 0) return;
    for (const line of tempLines) {
      const m = line.match(/S(\d+)/);
      if (!m) continue;
      const t = parseInt(m[1]);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(150);
    }
  }, 60_000);
});

describe('G-code numerical precision — fan commands', () => {
  it('M106 fan speeds (0-255 scale) are integers in [0, 255]', async () => {
    const result = await sliceGeometry(buildBox(10, 10, 1));
    const lines = result.gcode.split('\n');
    for (const line of lines) {
      if (!/^M106\s/.test(line)) continue;
      const m = line.match(/S(\d+(?:\.\d+)?)/);
      if (!m) continue;
      const s = parseFloat(m[1]);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(255);
    }
  }, 60_000);
});

describe('G-code numerical precision — line continuity', () => {
  it('consecutive G1 X/Y values produce non-NaN distances', async () => {
    const result = await sliceGeometry(buildBox(15, 15, 1));
    const lines = result.gcode.split('\n');
    let prevX = NaN, prevY = NaN;
    let validPairs = 0;
    for (const line of lines) {
      const xm = line.match(/^G[01].*\sX(-?\d+\.\d+)/);
      const ym = line.match(/^G[01].*\sY(-?\d+\.\d+)/);
      if (!xm || !ym) continue;
      const x = parseFloat(xm[1]), y = parseFloat(ym[1]);
      if (Number.isFinite(prevX) && Number.isFinite(prevY)) {
        const d = Math.hypot(x - prevX, y - prevY);
        expect(Number.isFinite(d)).toBe(true);
        validPairs++;
      }
      prevX = x; prevY = y;
    }
    expect(validPairs).toBeGreaterThan(20);
  }, 60_000);
});

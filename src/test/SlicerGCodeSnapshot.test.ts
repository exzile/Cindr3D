import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { buildBox, makeSlicer } from './_helpers/slicerSystemHelpers';

/**
 * Snapshot-style tests over canonical slicer output for fixed inputs.
 *
 * Rather than full-text snapshots (which are brittle to comment changes),
 * these assert structural properties of the G-code: presence/absence of
 * key commands, command counts, monotonic invariants, etc. They catch
 * regressions where the slicer accidentally drops/duplicates an entire
 * category of moves while letting cosmetic changes pass.
 */

async function sliceBoxGCode(overrides: Record<string, unknown> = {}, sx = 10, sy = 10, sz = 1) {
  const slicer = makeSlicer(overrides);
  const result = await slicer.slice([{
    geometry: buildBox(sx, sy, sz),
    transform: new THREE.Matrix4(),
  }]);
  return result.gcode;
}

describe('Slicer G-code snapshot — structural invariants', () => {
  it('every emitted G-code starts with a comment header', async () => {
    const gcode = await sliceBoxGCode();
    expect(gcode.startsWith(';')).toBe(true);
  }, 60_000);

  it('always includes at least one G28 (home) command in the start sequence', async () => {
    const gcode = await sliceBoxGCode();
    expect(gcode).toMatch(/^G28(\s|$)/m);
  }, 60_000);

  it('emits an M104 nozzle temp command before any extrusion', async () => {
    const gcode = await sliceBoxGCode();
    const lines = gcode.split('\n');
    const firstM104 = lines.findIndex((l) => /^M104/.test(l));
    const firstExtrude = lines.findIndex((l) => /^G1.*E\d/.test(l));
    expect(firstM104).toBeGreaterThanOrEqual(0);
    expect(firstM104).toBeLessThan(firstExtrude);
  }, 60_000);

  it('emits an M82 (absolute extrusion) or M83 (relative) before extrusion', async () => {
    const gcode = await sliceBoxGCode();
    const lines = gcode.split('\n');
    const firstMode = lines.findIndex((l) => /^M82|^M83/.test(l));
    const firstExtrude = lines.findIndex((l) => /^G1.*E\d/.test(l));
    expect(firstMode).toBeGreaterThanOrEqual(0);
    expect(firstMode).toBeLessThan(firstExtrude);
  }, 60_000);

  it('emits a layer-change comment for every layer (count matches layerCount)', async () => {
    const slicer = makeSlicer();
    const result = await slicer.slice([{
      geometry: buildBox(10, 10, 2),
      transform: new THREE.Matrix4(),
    }]);
    const layerComments = result.gcode.split('\n').filter((l) => /^; ----- Layer \d/.test(l));
    expect(layerComments.length).toBe(result.layerCount);
  }, 60_000);

  it('emits at least one G1 Z move per layer change', async () => {
    const slicer = makeSlicer({ layerHeight: 0.2 });
    const result = await slicer.slice([{
      geometry: buildBox(10, 10, 2),
      transform: new THREE.Matrix4(),
    }]);
    const lines = result.gcode.split('\n');
    const zMoves = lines.filter((l) => /^G1 Z(-?\d+\.\d+)/.test(l));
    expect(zMoves.length).toBeGreaterThanOrEqual(result.layerCount - 1);
    // All Z values are finite.
    for (const line of zMoves) {
      const m = line.match(/^G1 Z(-?\d+\.\d+)/);
      expect(Number.isFinite(parseFloat(m![1]))).toBe(true);
    }
  }, 60_000);

  it('each G1 extrusion line has finite X/Y/E/F values', async () => {
    const gcode = await sliceBoxGCode();
    const lines = gcode.split('\n').filter((l) => /^G1 X/.test(l) && /E/.test(l));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      // Each token should parse as a finite number.
      const tokens = line.split(/\s+/).slice(1);
      for (const token of tokens) {
        if (token.startsWith(';')) break;
        const v = parseFloat(token.slice(1));
        if (Number.isFinite(v) === false && !token.startsWith(';')) {
          throw new Error(`non-finite token in G1: ${token} (line: ${line})`);
        }
      }
    }
  }, 60_000);

  it('absolute-mode E values only drop by retractionDistance (bounded retraction)', async () => {
    // Default slicer uses absolute extrusion (M82). Drops happen only
    // for retractions (1-3mm typical) or after G92 E0 resets. Outside
    // those, E should grow monotonically.
    const gcode = await sliceBoxGCode();
    const lines = gcode.split('\n');
    let prevE = 0;
    let unexplainedBigDrops = 0;
    let relativePositioning = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // G91 puts axes in relative mode; G90 returns to absolute. End-
      // G-code commonly switches to G91 for the final retract/lift, and
      // those E values are deltas (not absolute positions).
      if (/^G91\b/.test(line)) { relativePositioning = true; continue; }
      if (/^G90\b/.test(line)) { relativePositioning = false; continue; }
      // G92 E0 resets the counter — accept whatever follows.
      if (/^G92\b.*E0/.test(line)) {
        prevE = 0;
        continue;
      }
      const m = line.match(/^G1.*\bE(-?\d+\.?\d*)/);
      if (!m) continue;
      if (relativePositioning) continue;
      const e = parseFloat(m[1]);
      if (!Number.isFinite(e)) continue;
      // Allow up to 50mm drops (covers worst-case wipe + retract). Bigger
      // drops indicate genuine bugs (sign flip, lost extrusion track).
      if (e < prevE && (prevE - e) > 50) unexplainedBigDrops++;
      prevE = e;
    }
    expect(unexplainedBigDrops).toBe(0);
  }, 60_000);

  it('M106/M107 fan commands are well-formed', async () => {
    const gcode = await sliceBoxGCode();
    const lines = gcode.split('\n');
    const fanLines = lines.filter((l) => /^M10[67]/.test(l));
    for (const line of fanLines) {
      // M106 must have an S<value>; M107 doesn't need one.
      if (line.startsWith('M106')) {
        expect(line).toMatch(/M106\s+S\d+/);
      }
    }
  }, 60_000);

  it('emits an end-of-print comment / marker block', async () => {
    const gcode = await sliceBoxGCode();
    expect(gcode).toMatch(/End G-code/);
  }, 60_000);

  it('larger model produces more total G-code lines (linear-ish growth)', async () => {
    const small = (await sliceBoxGCode({}, 10, 10, 1)).split('\n').length;
    const large = (await sliceBoxGCode({}, 10, 10, 4)).split('\n').length;
    expect(large).toBeGreaterThan(small);
    // 4× height should produce noticeably more than 1× lines (not 4× because
    // the start/end overhead amortizes).
    expect(large).toBeGreaterThan(small * 1.5);
  }, 60_000);

  it('first layer extrusion runs at firstLayerSpeed, not the higher layer-N speeds', async () => {
    const slicer = makeSlicer({ firstLayerSpeed: 15, outerWallSpeed: 50 });
    const result = await slicer.slice([{
      geometry: buildBox(10, 10, 1),
      transform: new THREE.Matrix4(),
    }]);
    // Layer 0 G1-extrude lines: collect all F values that appear inside
    // the layer 0 block (between "; ----- Layer 0" and "; ----- Layer 1").
    const lines = result.gcode.split('\n');
    const layer0Start = lines.findIndex((l) => /^; ----- Layer 0/.test(l));
    const layer1Start = lines.findIndex((l) => /^; ----- Layer 1/.test(l));
    expect(layer0Start).toBeGreaterThanOrEqual(0);
    const layer0Range = layer1Start > layer0Start
      ? lines.slice(layer0Start, layer1Start)
      : lines.slice(layer0Start);
    const fValues: number[] = [];
    for (const line of layer0Range) {
      if (!/^G1 X.*E\d/.test(line)) continue;
      const m = line.match(/F(\d+)/);
      if (m) fValues.push(parseInt(m[1]));
    }
    expect(fValues.length).toBeGreaterThan(0);
    // firstLayerSpeed=15 mm/s → 900 mm/min. Slowest F on layer 0 should
    // be at most 900 (no F should exceed firstLayerSpeed × 60).
    const maxF = Math.max(...fValues);
    expect(maxF).toBeLessThanOrEqual(900 + 1);
  }, 60_000);

  it('producing G-code is deterministic (same input → same output)', async () => {
    const a = await sliceBoxGCode();
    const b = await sliceBoxGCode();
    expect(a).toBe(b);
  }, 120_000);
});

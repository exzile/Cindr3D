import { describe, expect, it } from 'vitest';

import { configValues } from './arachneWasm';
import type { PrintProfile } from '../../../../types/slicer';

// Field index → name map (matches `wasm/src/arachne_config.h`).
// Update both this and `configValues` when the C++ struct changes.
const FIELD = {
  inset_count: 0,
  bead_width_0: 1,
  bead_width_x: 2,
  wall_0_inset: 3,
  wall_transition_length: 4,
  wall_transition_angle_deg: 5,
  wall_transition_filter_distance: 6,
  wall_transition_filter_deviation: 7,
  min_feature_size: 8,
  min_bead_width: 9,
  wall_distribution_count: 10,
  section_type: 11,
  meshfix_maximum_deviation: 12,
  min_wall_line_width: 13,
  min_even_wall_line_width: 14,
  min_odd_wall_line_width: 15,
  min_variable_line_ratio: 16,
  simplify_max_resolution: 17,
  simplify_max_deviation: 18,
  simplify_max_area_deviation: 19,
  print_thin_walls: 20,
  fluid_motion_enabled: 21,
  min_wall_length_factor: 22,
  is_top_or_bottom_layer: 23,
  precise_outer_wall: 24,
} as const;

const baseLineWidth = 0.4;
const baseInset = 0.05;
const baseWallCount = 3;

function build(overrides: Partial<PrintProfile> = {}): Float64Array {
  return configValues(baseWallCount, baseLineWidth, baseInset, overrides as PrintProfile);
}

describe('arachneWasm configValues — field mapping', () => {
  it('emits exactly 25 fields (matches the libArachne ABI)', () => {
    const buf = build();
    expect(buf.length).toBe(25);
  });

  it('passes wallCount/lineWidth/outerWallInset positionals straight through', () => {
    const buf = build();
    expect(buf[FIELD.inset_count]).toBe(baseWallCount);
    expect(buf[FIELD.wall_0_inset]).toBe(baseInset);
  });

  it('defaults outer/inner bead widths to lineWidth when profile omits them', () => {
    const buf = build();
    expect(buf[FIELD.bead_width_0]).toBe(baseLineWidth);
    expect(buf[FIELD.bead_width_x]).toBe(baseLineWidth);
  });

  it('honors per-feature outer + inner wall line widths from the profile', () => {
    const buf = build({ outerWallLineWidth: 0.32, innerWallLineWidth: 0.48 });
    expect(buf[FIELD.bead_width_0]).toBe(0.32);
    expect(buf[FIELD.bead_width_x]).toBe(0.48);
  });

  it('uses the first-layer absolute line width for both outer and inner walls', () => {
    const buf = configValues(baseWallCount, 0.5, baseInset, {
      outerWallLineWidth: 0.4,
      innerWallLineWidth: 0.45,
    } as PrintProfile, { isFirstLayer: true });
    expect(buf[FIELD.bead_width_0]).toBe(0.5);
    expect(buf[FIELD.bead_width_x]).toBe(0.5);
  });

  it('routes minWallLineWidth → min_bead_width AND min_wall_line_width', () => {
    const buf = build({ minWallLineWidth: 0.18 });
    expect(buf[FIELD.min_bead_width]).toBe(0.18);
    expect(buf[FIELD.min_wall_line_width]).toBe(0.18);
  });

  it('aliases minThinWallLineWidth → min_odd_wall_line_width (Cura naming)', () => {
    const buf = build({ minWallLineWidth: 0.18, minThinWallLineWidth: 0.22 });
    expect(buf[FIELD.min_odd_wall_line_width]).toBe(0.22);
    // Even still defaults to minWallLineWidth.
    expect(buf[FIELD.min_even_wall_line_width]).toBe(0.18);
  });

  it('routes minEvenWallLineWidth independently of odd width', () => {
    const buf = build({ minWallLineWidth: 0.2, minEvenWallLineWidth: 0.3 });
    expect(buf[FIELD.min_even_wall_line_width]).toBe(0.3);
    expect(buf[FIELD.min_odd_wall_line_width]).toBe(0.2);
  });

  it('threads wall transition geometry settings into their fields', () => {
    const buf = build({
      wallTransitionLength: 1.2,
      wallTransitionAngle: 25,
      wallTransitionFilterDistance: 0.18,
      wallTransitionFilterMargin: 0.07,
    });
    expect(buf[FIELD.wall_transition_length]).toBe(1.2);
    expect(buf[FIELD.wall_transition_angle_deg]).toBe(25);
    expect(buf[FIELD.wall_transition_filter_distance]).toBe(0.18);
    expect(buf[FIELD.wall_transition_filter_deviation]).toBe(0.07);
  });

  it('threads minFeatureSize and wallDistributionCount', () => {
    const buf = build({ minFeatureSize: 0.13, wallDistributionCount: 2 });
    expect(buf[FIELD.min_feature_size]).toBe(0.13);
    expect(buf[FIELD.wall_distribution_count]).toBe(2);
  });

  it('treats printThinWalls=false as a hard disable (overrides thinWallDetection)', () => {
    const buf = build({ printThinWalls: false, thinWallDetection: true });
    expect(buf[FIELD.print_thin_walls]).toBe(0);
  });

  it('treats undefined printThinWalls + thinWallDetection=false as disabled', () => {
    const buf = build({ thinWallDetection: false });
    expect(buf[FIELD.print_thin_walls]).toBe(0);
  });

  it('defaults print_thin_walls to enabled when both fields are undefined', () => {
    const buf = build();
    expect(buf[FIELD.print_thin_walls]).toBe(1);
  });

  it('keeps section_type=1 (walls) by default', () => {
    const buf = build();
    expect(buf[FIELD.section_type]).toBe(1);
  });

  it('threads region and top/bottom context for Arachne cleanup rules', () => {
    const buf = configValues(baseWallCount, baseLineWidth, baseInset, {} as PrintProfile, {
      sectionType: 'skin',
      isTopOrBottomLayer: true,
    });
    expect(buf[FIELD.section_type]).toBe(3);
    expect(buf[FIELD.is_top_or_bottom_layer]).toBe(1);
  });

  it('threads Orca min wall length factor, fluid motion, and precise wall settings', () => {
    const buf = build({
      minWallLengthFactor: 0.8,
      fluidMotionEnable: true,
      preciseOuterWall: true,
    });
    expect(buf[FIELD.min_wall_length_factor]).toBe(0.8);
    expect(buf[FIELD.fluid_motion_enabled]).toBe(1);
    expect(buf[FIELD.precise_outer_wall]).toBe(1);
  });

  it('defaults fluid motion, top/bottom, and precise wall to disabled', () => {
    const buf = build();
    expect(buf[FIELD.fluid_motion_enabled]).toBe(0);
    expect(buf[FIELD.is_top_or_bottom_layer]).toBe(0);
    expect(buf[FIELD.precise_outer_wall]).toBe(0);
  });

  it('all values are finite (no NaN/Infinity leaks from undefined chains)', () => {
    const buf = build({});
    for (let i = 0; i < buf.length; i++) {
      expect(Number.isFinite(buf[i])).toBe(true);
    }
  });
});

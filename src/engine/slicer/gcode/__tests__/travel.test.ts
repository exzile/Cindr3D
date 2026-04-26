import { describe, expect, it } from 'vitest';
import type { PrintProfile } from '../../../../types/slicer';

import { shouldRetractOnTravel } from '../travel';

function makeProfile(overrides: Partial<PrintProfile> = {}): PrintProfile {
  return {
    wallLineWidth: 0.4,
    retractionMinTravel: 1.5,
    maxCombDistanceNoRetract: 6,
    minimumExtrusionDistanceWindow: 0,
    travelAvoidDistance: 0,
    insideTravelAvoidDistance: 0,
    avoidPrintedParts: false,
    avoidSupports: false,
    ...overrides,
  } as unknown as PrintProfile;
}

describe('shouldRetractOnTravel', () => {
  it('skips retraction for very short travels under retractionMinTravel', () => {
    const pp = makeProfile({ retractionMinTravel: 1.5, maxCombDistanceNoRetract: 0 });
    expect(shouldRetractOnTravel(0.5, 100, pp)).toBe(false);
    expect(shouldRetractOnTravel(1.49, 100, pp)).toBe(false);
  });

  it('skips retraction inside the combing window', () => {
    const pp = makeProfile({ maxCombDistanceNoRetract: 5 });
    expect(shouldRetractOnTravel(2, 100, pp)).toBe(false);
    expect(shouldRetractOnTravel(4.99, 100, pp)).toBe(false);
  });

  it('retracts past both maxCombDistanceNoRetract and retractionMinTravel', () => {
    const pp = makeProfile({ maxCombDistanceNoRetract: 5, retractionMinTravel: 1.5 });
    expect(shouldRetractOnTravel(10, 100, pp)).toBe(true);
  });

  it('respects travelAvoidDistance + insideTravelAvoidDistance shrinkage of comb window', () => {
    const pp = makeProfile({
      maxCombDistanceNoRetract: 6,
      travelAvoidDistance: 1,
      insideTravelAvoidDistance: 1,
    });
    // Effective comb = 6 - 1 - 1 = 4 → travel at 4.5 should retract.
    expect(shouldRetractOnTravel(4.5, 100, pp)).toBe(true);
    // Travel at 3 still inside the shrunk comb window.
    expect(shouldRetractOnTravel(3, 100, pp)).toBe(false);
  });

  it('honors avoidPrintedParts as a force-retract that bypasses short-travel skip', () => {
    const pp = makeProfile({
      maxCombDistanceNoRetract: 10,
      retractionMinTravel: 5,
      avoidPrintedParts: true,
    });
    expect(shouldRetractOnTravel(0.5, 0, pp)).toBe(true);
  });

  it('honors avoidSupports as a force-retract', () => {
    const pp = makeProfile({
      maxCombDistanceNoRetract: 10,
      retractionMinTravel: 5,
      avoidSupports: true,
    });
    expect(shouldRetractOnTravel(0.5, 0, pp)).toBe(true);
  });

  it('skips retraction inside the minimum extrusion distance window for short-ish travels', () => {
    // minimumExtrusionDistanceWindow=10 means: if extrudedSinceRetract<10 AND
    // travel distance is below the longTravelFloor (max(comb, minTravel,
    // wallLW*4, 2)), skip the retraction.
    const pp = makeProfile({
      minimumExtrusionDistanceWindow: 10,
      maxCombDistanceNoRetract: 6,
      retractionMinTravel: 1.5,
      wallLineWidth: 0.4,
    });
    // longTravelFloor = max(6, 1.5, 1.6, 2) = 6. Travel of 5 (over comb but
    // under floor) → should NOT retract because we're still in the window.
    expect(shouldRetractOnTravel(5, 0.5, pp)).toBe(false);
  });

  it('still retracts past the longTravelFloor even inside the extrusion window', () => {
    const pp = makeProfile({
      minimumExtrusionDistanceWindow: 10,
      maxCombDistanceNoRetract: 6,
      retractionMinTravel: 1.5,
      wallLineWidth: 0.4,
    });
    // Travel of 20mm → past longTravelFloor → retract.
    expect(shouldRetractOnTravel(20, 0.5, pp)).toBe(true);
  });

  it('exits the extrusion window once enough has been extruded', () => {
    const pp = makeProfile({
      minimumExtrusionDistanceWindow: 10,
      maxCombDistanceNoRetract: 6,
      retractionMinTravel: 1.5,
    });
    expect(shouldRetractOnTravel(8, 15, pp)).toBe(true);
  });
});

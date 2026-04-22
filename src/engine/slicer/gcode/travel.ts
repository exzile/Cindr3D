import type { PrintProfile } from '../../../types/slicer';

export function shouldRetractOnTravel(
  dist: number,
  extrudedSinceRetract: number,
  pp: PrintProfile,
): boolean {
  const forceRetract = (pp.avoidPrintedParts ?? false) || (pp.avoidSupports ?? false);
  let maxComb = pp.maxCombDistanceNoRetract ?? 0;
  const avoidPad = (pp.travelAvoidDistance ?? 0) + (pp.insideTravelAvoidDistance ?? 0);
  if (avoidPad > 0) maxComb = Math.max(0, maxComb - avoidPad);
  const minTravel = pp.retractionMinTravel ?? 0;
  const shortByDistance = !forceRetract && (
    (maxComb > 0 && dist < maxComb) ||
    (minTravel > 0 && dist < minTravel)
  );
  if (shortByDistance) return false;

  const minExtrudeWindow = pp.minimumExtrusionDistanceWindow ?? 0;
  if (minExtrudeWindow > 0 && extrudedSinceRetract < minExtrudeWindow && !forceRetract) {
    const longTravelFloor = Math.max(maxComb, minTravel, pp.wallLineWidth * 4, 2);
    if (dist < longTravelFloor) return false;
  }

  return true;
}

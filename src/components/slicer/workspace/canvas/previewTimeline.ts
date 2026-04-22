import type { SliceMove, SliceResult } from '../../../../types/slicer';

export interface MoveTimeline {
  cumulative: Float32Array;
  moves: Array<{ move: SliceMove; z: number }>;
  layerIndices: Int32Array;
  moveWithinLayer: Int32Array;
  total: number;
}

export interface BuildMoveTimelineOptions {
  filamentDiameter: number;
  travelSpeed: number;
  initialLayerTravelSpeed?: number;
  retractionDistance?: number;
  retractionSpeed?: number;
  retractionRetractSpeed?: number;
  retractionPrimeSpeed?: number;
  retractionMinTravel?: number;
  minimumExtrusionDistanceWindow?: number;
  maxCombDistanceNoRetract?: number;
  travelAvoidDistance?: number;
  insideTravelAvoidDistance?: number;
  avoidPrintedParts?: boolean;
  avoidSupports?: boolean;
  zHopWhenRetracted?: boolean;
  zHopHeight?: number;
  zHopSpeed?: number;
}

export function estimateMoveDistance(
  move: SliceMove,
  fallbackLayerHeight: number,
  filamentDiameter: number,
): number {
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;
  const xyDistance = Math.hypot(dx, dy);
  if (xyDistance > 1e-6) return xyDistance;

  if (move.extrusion <= 1e-9) return 0;

  const layerHeight = Math.max(move.layerHeight ?? fallbackLayerHeight, 1e-6);
  const lineWidth = Math.max(move.lineWidth ?? 0.4, 1e-6);
  const filamentArea = Math.PI * Math.pow(Math.max(filamentDiameter, 0.1) / 2, 2);
  return (move.extrusion * filamentArea) / (lineWidth * layerHeight);
}

export function buildMoveTimeline(
  sliceResult: SliceResult,
  options: BuildMoveTimelineOptions,
): MoveTimeline {
  const {
    filamentDiameter,
    travelSpeed,
    initialLayerTravelSpeed,
    retractionDistance = 0,
    retractionSpeed = 0,
    retractionRetractSpeed,
    retractionPrimeSpeed,
    retractionMinTravel = 0,
    minimumExtrusionDistanceWindow = 0,
    maxCombDistanceNoRetract = 0,
    travelAvoidDistance = 0,
    insideTravelAvoidDistance = 0,
    avoidPrintedParts = false,
    avoidSupports = false,
    zHopWhenRetracted = false,
    zHopHeight = 0,
    zHopSpeed,
  } = options;

  const flat: Array<{ move: SliceMove; z: number }> = [];
  let totalMoves = 0;
  for (const layer of sliceResult.layers) totalMoves += layer.moves.length;
  const cumulative = new Float32Array(totalMoves);
  const layerIndices = new Int32Array(totalMoves);
  const moveWithinLayer = new Int32Array(totalMoves);

  let t = 0;
  let i = 0;
  let prevLayerZ = 0;
  let isRetracted = false;
  let extrudedSinceRetract = 0;
  const retractSpeedMm = Math.max(retractionRetractSpeed ?? retractionSpeed, 1e-6);
  const primeSpeedMm = Math.max(retractionPrimeSpeed ?? retractionSpeed, 1e-6);
  const hopSpeedMm = Math.max(zHopSpeed ?? travelSpeed, 1e-6);
  const hopEnabled = zHopWhenRetracted && zHopHeight > 0;

  for (const layer of sliceResult.layers) {
    const fallbackLayerHeight = Math.max(layer.z - prevLayerZ, 0.001);
    const layerTravelSpeed = layer.layerIndex === 0
      ? Math.max(initialLayerTravelSpeed ?? travelSpeed, 1e-6)
      : Math.max(travelSpeed, 1e-6);
    const zDistance = Math.abs(layer.z - prevLayerZ);
    if (zDistance > 1e-6) t += zDistance / layerTravelSpeed;

    for (let mi = 0; mi < layer.moves.length; mi++) {
      const move = layer.moves[mi];
      if (move.type === 'travel') {
        const distance = estimateMoveDistance(move, fallbackLayerHeight, filamentDiameter);
        const forceRetract = avoidPrintedParts || avoidSupports;
        let effectiveMaxComb = maxCombDistanceNoRetract;
        const avoidPad = travelAvoidDistance + insideTravelAvoidDistance;
        if (avoidPad > 0) effectiveMaxComb = Math.max(0, effectiveMaxComb - avoidPad);
        const shortTravel = !forceRetract && (
          (effectiveMaxComb > 0 && distance < effectiveMaxComb) ||
          (retractionMinTravel > 0 && distance < retractionMinTravel) ||
          (minimumExtrusionDistanceWindow > 0 && extrudedSinceRetract < minimumExtrusionDistanceWindow)
        );
        if (!shortTravel && !isRetracted && retractionDistance > 0) {
          t += retractionDistance / retractSpeedMm;
          if (hopEnabled) t += zHopHeight / hopSpeedMm;
          isRetracted = true;
          extrudedSinceRetract = 0;
        }
      } else if (move.extrusion > 1e-9) {
        if (isRetracted && retractionDistance > 0) {
          if (hopEnabled) t += zHopHeight / hopSpeedMm;
          t += retractionDistance / primeSpeedMm;
          isRetracted = false;
        }
        extrudedSinceRetract += move.extrusion;
      }

      const distance = estimateMoveDistance(move, fallbackLayerHeight, filamentDiameter);
      t += move.speed > 0 ? distance / move.speed : 0;
      cumulative[i] = t;
      layerIndices[i] = layer.layerIndex;
      moveWithinLayer[i] = mi;
      const moveZ = move.type === 'travel' && isRetracted && hopEnabled
        ? layer.z + zHopHeight
        : layer.z;
      flat.push({ move, z: moveZ });
      i++;
    }

    prevLayerZ = layer.z;
  }

  return { cumulative, moves: flat, layerIndices, moveWithinLayer, total: t };
}

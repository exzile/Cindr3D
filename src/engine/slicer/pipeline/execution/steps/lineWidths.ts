import type { PrintProfile } from '../../../../../types/slicer';

export type LineWidthSpec = number | number[];
type InitialLayerLineWidthProfile = Pick<PrintProfile, 'initialLayerLineWidthFactor' | 'lineWidth'>;

export function initialLayerLineWidthScale(
  pp: Pick<PrintProfile, 'initialLayerLineWidthFactor'>,
  isFirstLayer: boolean,
): number {
  if (!isFirstLayer) return 1;
  return Math.max(0.01, (pp.initialLayerLineWidthFactor ?? 100) / 100);
}

export function initialLayerLineWidth(
  pp: InitialLayerLineWidthProfile,
): number {
  return Math.max(0.01, pp.lineWidth * initialLayerLineWidthScale(pp, true));
}

export function lineWidthForLayer(
  lineWidth: number,
  pp: InitialLayerLineWidthProfile,
  isFirstLayer: boolean,
): number {
  return isFirstLayer ? initialLayerLineWidth(pp) : lineWidth;
}

export function lineWidthSpecForLayer(
  lineWidth: LineWidthSpec,
  pp: InitialLayerLineWidthProfile,
  isFirstLayer: boolean,
): LineWidthSpec {
  if (!isFirstLayer) return lineWidth;
  const firstLayerWidth = initialLayerLineWidth(pp);
  return Array.isArray(lineWidth)
    ? lineWidth.map(() => firstLayerWidth)
    : firstLayerWidth;
}

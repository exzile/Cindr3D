import type { MaterialProfile, PrintProfile, PrinterProfile } from '../../../../types/slicer';
import type { FirstLayerContext } from './types';

/**
 * Pad positions match generateFirstLayerTestGCode in engine/calibration/basicPrints.ts.
 * Labels are semantic so the AI can refer to "front-left" rather than coordinates.
 */
const PADS = [
  { label: 'front-left',   x:  25, y: 25 },
  { label: 'front-center', x:  95, y: 25 },
  { label: 'front-right',  x: 165, y: 25 },
  { label: 'back-left',    x:  25, y: 95 },
  { label: 'back-right',   x: 165, y: 95 },
] as const;

/**
 * Derive expected first-layer geometry for the AI: pad positions, line width,
 * first-layer Z, and material/temperatures. The AI uses this to reason about
 * which pad is "too high" (gaps) vs "squished" (ridges).
 */
export function deriveFirstLayerContext(
  printerProfile: PrinterProfile | undefined,
  printProfile: PrintProfile | undefined,
  materialProfile: MaterialProfile | undefined,
): FirstLayerContext | null {
  if (!printProfile) return null;

  const baseLineWidth = printProfile.lineWidth ?? printerProfile?.nozzleDiameter ?? 0.4;
  const lineWidthMm = printProfile.initialLayerLineWidthFactor
    ? baseLineWidth * (printProfile.initialLayerLineWidthFactor / 100)
    : baseLineWidth;

  return {
    pads: PADS,
    firstLayerHeightMm: printProfile.firstLayerHeight ?? 0.2,
    lineWidthMm,
    bedTempC: materialProfile?.bedTempFirstLayer ?? materialProfile?.bedTemp ?? 60,
    nozzleTempC: materialProfile?.nozzleTempFirstLayer ?? materialProfile?.nozzleTemp ?? 210,
    materialName: materialProfile?.name ?? 'unknown',
  };
}

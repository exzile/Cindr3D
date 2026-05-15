/**
 * useCurrentLayer — cross-firmware 0-based layer index for the dashboard
 * print preview.
 *
 *   Duet     → model.job.layer (RRF object model, 1-based)
 *   Marlin   → model.job.layer populated by DuetService.handleSerialLine
 *              parsing M73 / "echo:Layer N/M" off the WebSerial line stream
 *   Klipper  → useKlipperPrintStatus() (Moonraker print_stats; 1-based, or
 *              estimated from progress %)
 *   Other    → slicerStore.previewLayer (0-based) or last slice layer
 *
 * Returned index is suitable for InlineGCodeWirePreview / LayeredGCodePreview.
 */
import { useMemo } from 'react';
import { useKlipperPrintStatus } from '../../hooks/useKlipperPrintStatus';
import { layerFromPercent } from '../../../../services/gcode/marlinProgressParser';

interface JobLayerSource {
  boardType?: string;
  modelJobLayer: number | undefined;
  previewLayer: number | null | undefined;
  totalLayers: number;
}

export function useCurrentLayer({ boardType, modelJobLayer, previewLayer, totalLayers }: JobLayerSource) {
  const klipperStatus = useKlipperPrintStatus();

  const currentLayer = useMemo(() => {
    const fromOneBased = (n: number) => Math.max(0, Math.min(Math.max(0, totalLayers - 1), n - 1));
    if (boardType === 'duet' && modelJobLayer !== undefined) return fromOneBased(modelJobLayer);
    if (boardType === 'marlin' && modelJobLayer !== undefined) return fromOneBased(modelJobLayer);
    if (boardType === 'klipper' && klipperStatus) {
      if (klipperStatus.currentLayer !== undefined) return fromOneBased(klipperStatus.currentLayer);
      if (totalLayers > 0) return fromOneBased(layerFromPercent(klipperStatus.progress * 100, totalLayers));
    }
    return previewLayer ?? Math.max(0, totalLayers - 1);
  }, [boardType, modelJobLayer, klipperStatus, previewLayer, totalLayers]);

  return { currentLayer, klipperStatus };
}

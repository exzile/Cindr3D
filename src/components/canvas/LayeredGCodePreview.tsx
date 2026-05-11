import { InlineGCodeWirePreview } from '../slicer/workspace/canvas/GCodeWirePreview';
import type { SliceResult } from '../../types/slicer';
import type { PreviewColorMode } from '../../types/slicer-preview.types';

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

interface LayeredGCodePreviewProps {
  sliceResult: SliceResult;
  displayedLayer: number;
  colorMode: PreviewColorMode;
  hiddenTypes?: ReadonlySet<string>;
  layerTimeRange: [number, number];
}

/**
 * LayeredGCodePreview — renders the standard ghost+active two-pass GCode layer preview.
 *
 * Layers 0..displayedLayer-1 are rendered as a dim ghost (opacity 0.2).
 * The current displayedLayer is rendered at full opacity (opacity 1).
 * Both MeshPreviewPanel and StepSlicePreview share this exact pattern.
 */
export function LayeredGCodePreview({
  sliceResult,
  displayedLayer,
  colorMode,
  hiddenTypes = EMPTY_HIDDEN,
  layerTimeRange,
}: LayeredGCodePreviewProps) {
  return (
    <>
      {displayedLayer > 0 && (
        <InlineGCodeWirePreview
          sliceResult={sliceResult}
          startLayer={0}
          currentLayer={displayedLayer - 1}
          showTravel={false}
          showRetractions={false}
          colorMode={colorMode}
          hiddenTypes={hiddenTypes}
          layerTimeRange={layerTimeRange}
          opacity={0.2}
          renderOrder={0}
        />
      )}
      <InlineGCodeWirePreview
        sliceResult={sliceResult}
        startLayer={displayedLayer}
        currentLayer={displayedLayer}
        showTravel={false}
        showRetractions={false}
        colorMode={colorMode}
        hiddenTypes={hiddenTypes}
        layerTimeRange={layerTimeRange}
        opacity={1}
        renderOrder={10}
      />
    </>
  );
}

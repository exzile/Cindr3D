import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatDurationWords } from '../../../../utils/printerFormat';
import { clampLayerIndex } from './helpers';

interface CurrentLayerIssue { message: string }

/**
 * Bottom-overlay layer slider + per-layer stats row. The host owns
 * `displayedLayer`/`isLiveLayer` and the override setter; this component
 * is purely presentational + keyboard wiring.
 */
export function LayerScrubber({
  totalLayers,
  displayedLayer,
  isLiveLayer,
  layerZ,
  progressPercent,
  activeObjectName,
  elapsedSeconds,
  remainingSeconds,
  currentLayerIssues,
  onManualLayer,
  onReturnToLive,
}: {
  totalLayers: number;
  displayedLayer: number;
  isLiveLayer: boolean;
  layerZ: number | undefined;
  progressPercent: number | null;
  activeObjectName: string | null;
  elapsedSeconds: number | undefined;
  remainingSeconds: number | undefined;
  currentLayerIssues: CurrentLayerIssue[];
  onManualLayer: (layer: number) => void;
  onReturnToLive: () => void;
}) {
  const handleLayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onManualLayer(displayedLayer - (event.shiftKey ? 10 : 1));
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onManualLayer(displayedLayer + (event.shiftKey ? 10 : 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onManualLayer(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onManualLayer(clampLayerIndex(totalLayers - 1, totalLayers));
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      onReturnToLive();
    }
  }, [displayedLayer, onManualLayer, onReturnToLive, totalLayers]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        display: 'grid',
        gridTemplateColumns: 'minmax(90px, 1fr) auto',
        gap: 8,
        alignItems: 'center',
        padding: '6px 8px',
        background: 'rgba(10, 10, 20, 0.82)',
        border: '1px solid var(--border, #2a2a4a)',
        borderRadius: 6,
        pointerEvents: 'auto',
        backdropFilter: 'blur(6px)',
      }}
    >
      <input
        type="range"
        min={0}
        max={Math.max(0, totalLayers - 1)}
        value={displayedLayer}
        aria-label="Preview layer"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={handleLayerKeyDown}
        onWheel={(e) => {
          e.stopPropagation();
          onManualLayer(displayedLayer + (e.deltaY > 0 ? 1 : -1));
        }}
        onChange={(e) => onManualLayer(Number(e.currentTarget.value))}
        style={{ width: '100%', minWidth: 0 }}
      />
      <button
        type="button"
        onClick={onReturnToLive}
        disabled={isLiveLayer}
        title="Return to live layer"
        aria-label="Return to live layer"
        style={{
          border: '1px solid var(--border, #2a2a4a)',
          borderRadius: 4,
          background: isLiveLayer ? 'transparent' : 'rgba(68, 170, 255, 0.14)',
          color: isLiveLayer ? 'var(--text-muted, #777)' : '#9bd7ff',
          cursor: isLiveLayer ? 'default' : 'pointer',
          fontSize: 10,
          padding: '3px 7px',
        }}
      >
        Live
      </button>
      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-muted, #aaa)', fontSize: 10, flexWrap: 'wrap' }}>
        <span>Layer {displayedLayer + 1} / {totalLayers}</span>
        <span>Z {layerZ?.toFixed(2) ?? '--'} mm</span>
        {progressPercent !== null && <span>{progressPercent.toFixed(0)}%</span>}
        {activeObjectName && <span>{activeObjectName}</span>}
        <span>Elapsed {formatDurationWords(elapsedSeconds, '--', false)}</span>
        <span>ETA {formatDurationWords(remainingSeconds, '--', false)}</span>
        {currentLayerIssues.length > 0 && <span>{currentLayerIssues.length} issue{currentLayerIssues.length === 1 ? '' : 's'}</span>}
        {currentLayerIssues[0] && <span title={currentLayerIssues[0].message}>{currentLayerIssues[0].message}</span>}
      </div>
    </div>
  );
}

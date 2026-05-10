import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';

interface StepMonitorProps {
  onMinimize: () => void;
}

type ModelWithHeat = {
  heat?: { heaters?: Array<{ current?: number; active?: number }> };
  job?: {
    layer?: number;
    file?: { size?: number };
    filePosition?: number;
    timesLeft?: { file?: number };
    duration?: number;
  };
};

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function tempStatusColor(actual: number | undefined, active: number | undefined): string {
  if (actual === undefined) return 'var(--text-secondary, #aaa)';
  if (active && active > 30 && Math.abs(actual - active) > 8) return '#f97316';
  return '#22c55e';
}

export function StepMonitor({ onMinimize }: StepMonitorProps) {
  const model       = usePrinterStore((s) => s.model) as ModelWithHeat;
  const connected   = usePrinterStore((s) => s.connected);
  const boardType   = usePrinterStore((s) => s.config.boardType);
  const sliceResult = useSlicerStore((s) => s.sliceResult);

  const hotend = model.heat?.heaters?.[1];
  const bed    = model.heat?.heaters?.[0];
  const totalLayers   = sliceResult?.layerCount ?? 0;
  const currentLayer  = model.job?.layer ?? null;
  const fileSize      = model.job?.file?.size ?? null;
  const filePos       = model.job?.filePosition ?? null;
  const elapsed       = model.job?.duration;
  const remaining     = model.job?.timesLeft?.file;

  const progressPct = (fileSize && filePos !== null)
    ? Math.min(100, (filePos / fileSize) * 100)
    : (totalLayers > 0 && currentLayer !== null)
      ? Math.min(100, (currentLayer / totalLayers) * 100)
      : null;

  return (
    <div className="calib-step">

      <p>Your calibration print is running. Review the live stats below, then click <strong>Next</strong> when the print finishes to inspect the result.</p>

      {!connected && (
        <div className="calib-step__warning">
          Not connected — reconnect to see live data.
        </div>
      )}

      {connected && (
        <div className="calib-step__checklist">
          {hotend !== undefined && (
            <span style={{ color: tempStatusColor(hotend.current, hotend.active) }}>
              Hotend: {hotend.current?.toFixed(1) ?? '--'} °C
              {hotend.active != null ? ` / ${hotend.active.toFixed(0)} °C target` : ''}
            </span>
          )}
          {bed !== undefined && (
            <span style={{ color: tempStatusColor(bed.current, bed.active) }}>
              Bed: {bed.current?.toFixed(1) ?? '--'} °C
              {bed.active != null ? ` / ${bed.active.toFixed(0)} °C target` : ''}
            </span>
          )}
          {currentLayer !== null && totalLayers > 0 && (
            <span>Layer: {currentLayer} / {totalLayers}</span>
          )}
          {progressPct !== null && (
            <span>Progress: {progressPct.toFixed(1)}%</span>
          )}
          {elapsed != null && (
            <span>Elapsed: {formatDuration(elapsed)}</span>
          )}
          {remaining != null && (
            <span>Remaining: {formatDuration(remaining)}</span>
          )}
          {boardType && (
            <span>Firmware: {boardType}</span>
          )}
        </div>
      )}

      <div className="calib-step__panel">
        <p>You can minimize this wizard and monitor the print from the Printer dashboard — your progress is saved and you can resume the Inspect step from the calibration card when the print is done.</p>
        <button type="button" onClick={onMinimize}>
          Minimize (monitor from dashboard)
        </button>
      </div>
    </div>
  );
}

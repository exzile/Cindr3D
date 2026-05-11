import { useState } from 'react';
import { Check, Download, Play } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { useAsyncAction } from '../../../hooks/useAsyncAction';

interface StepQueueProps {
  testType: string;
  printerId: string;
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function downloadGCodeBlob(filename: string, gcode: string): void {
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function StepQueue({ testType }: StepQueueProps) {
  const [busy, setBusy]         = useState(false);
  const [printSent, setPrintSent] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const run = useAsyncAction(setBusy, setError);

  const connected      = usePrinterStore((s) => s.connected);
  const uploading      = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const startPrint     = usePrinterStore((s) => s.startPrint);
  const sendToPrinter  = useSlicerStore((s) => s.sendToPrinter);
  const sliceResult    = useSlicerStore((s) => s.sliceResult);

  if (!sliceResult) {
    return (
      <div className="calib-step">

        <p>No GCode available — go back and complete the slice step first.</p>
      </div>
    );
  }

  const handleUploadAndPrint = () => run(async () => {
    // sendToPrinter uploads to currentDirectory (defaults to 0:/gcodes) with
    // thumbnails embedded. startPrint issues M32 to start the job.
    await sendToPrinter();
    await startPrint('0:/gcodes/output.gcode');
    setPrintSent(true);
  });

  const isBusy = busy || uploading;
  const progressLabel = uploading
    ? `Uploading… ${Math.round(uploadProgress)}%`
    : 'Upload & Start print';

  return (
    <div className="calib-step">

      <p>Upload the calibration GCode directly to the printer and start the job, or download it to send manually.</p>

      <div className="calib-step__checklist">
        <span>Layers: {sliceResult.layerCount}</span>
        <span>
          Estimated time:{' '}
          {formatDuration((sliceResult as unknown as Record<string, unknown>).estimatedPrintTime as number | undefined)}
        </span>
        <span>
          Filament:{' '}
          {(sliceResult.filamentUsed?.toFixed(1) ?? '--')} mm /{' '}
          {(sliceResult.filamentWeight?.toFixed(2) ?? '--')} g
        </span>
      </div>

      <div className="calib-step__queue-actions">
        <button
          type="button"
          onClick={() => downloadGCodeBlob(`${testType}-calibration.gcode`, sliceResult.gcode)}
        >
          <Download size={13} /> Download GCode
        </button>

        {connected ? (
          printSent ? (
            <button type="button" disabled>
              <Check size={13} /> Print started — click Next to monitor.
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleUploadAndPrint()}
            >
              <Play size={13} /> {isBusy ? progressLabel : 'Upload & Start print'}
            </button>
          )
        ) : (
          <span className="calib-step__muted">
            Connect to your printer to upload directly.
          </span>
        )}
      </div>

      {error && <span className="calib-step__error">Error: {error}</span>}
    </div>
  );
}

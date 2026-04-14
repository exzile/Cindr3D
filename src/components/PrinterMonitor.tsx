import { useEffect } from 'react';
import {
  Wifi, WifiOff, Thermometer, Clock,
  Play, Pause, Square, Home, Settings,
  Trash2, RefreshCw, ArrowUp, ArrowDown,
  ArrowLeft, ArrowRight, Video
} from 'lucide-react';
import { usePrinterStore } from '../store/printerStore';

function TemperatureDisplay() {
  const temperature = usePrinterStore((s) => s.temperature);

  if (!temperature) return null;

  return (
    <div className="printer-temps">
      <div className="temp-item">
        <Thermometer size={14} className="temp-icon nozzle" />
        <div className="temp-info">
          <span className="temp-label">Nozzle</span>
          <span className="temp-value">
            {temperature.tool0.actual.toFixed(1)}°C
            <span className="temp-target">/ {temperature.tool0.target}°C</span>
          </span>
          <div className="temp-bar">
            <div
              className="temp-bar-fill nozzle"
              style={{ width: `${Math.min(100, (temperature.tool0.actual / Math.max(temperature.tool0.target, 1)) * 100)}%` }}
            />
          </div>
        </div>
      </div>
      <div className="temp-item">
        <Thermometer size={14} className="temp-icon bed" />
        <div className="temp-info">
          <span className="temp-label">Bed</span>
          <span className="temp-value">
            {temperature.bed.actual.toFixed(1)}°C
            <span className="temp-target">/ {temperature.bed.target}°C</span>
          </span>
          <div className="temp-bar">
            <div
              className="temp-bar-fill bed"
              style={{ width: `${Math.min(100, (temperature.bed.actual / Math.max(temperature.bed.target, 1)) * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressDisplay() {
  const progress = usePrinterStore((s) => s.progress);
  const job = usePrinterStore((s) => s.job);

  if (!progress || !job) return null;

  const formatTime = (seconds: number) => {
    if (!seconds || seconds <= 0) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="printer-progress">
      <div className="progress-file">{job.file?.name || 'No file'}</div>
      <div className="progress-bar-container">
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress.completion || 0}%` }}
          />
        </div>
        <span className="progress-percent">{(progress.completion || 0).toFixed(1)}%</span>
      </div>
      <div className="progress-times">
        <span>
          <Clock size={12} /> Elapsed: {formatTime(progress.printTime)}
        </span>
        <span>
          <Clock size={12} /> Remaining: {formatTime(progress.printTimeLeft)}
        </span>
      </div>
    </div>
  );
}

function PrintControls() {
  const service = usePrinterStore((s) => s.service);
  const status = usePrinterStore((s) => s.status);
  const setError = usePrinterStore((s) => s.setError);

  if (!service || !status) return null;

  const isPrinting = status.flags.printing;
  const isPaused = status.flags.paused;

  const handleAction = async (action: () => Promise<void>, label: string) => {
    try {
      await action();
    } catch (err) {
      setError(`${label} failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="print-controls">
      {!isPrinting && !isPaused && (
        <button
          className="control-btn"
          title="Home axes"
          onClick={() => handleAction(() => service.homeAxes(), 'Home')}
        >
          <Home size={16} />
        </button>
      )}
      {isPrinting && (
        <button
          className="control-btn"
          title="Pause print"
          onClick={() => handleAction(() => service.pausePrint(), 'Pause')}
        >
          <Pause size={16} />
        </button>
      )}
      {isPaused && (
        <button
          className="control-btn success"
          title="Resume print"
          onClick={() => handleAction(() => service.resumePrint(), 'Resume')}
        >
          <Play size={16} />
        </button>
      )}
      {(isPrinting || isPaused) && (
        <button
          className="control-btn danger"
          title="Cancel print"
          onClick={() => {
            if (confirm('Cancel the current print?')) {
              handleAction(() => service.cancelPrint(), 'Cancel');
            }
          }}
        >
          <Square size={16} />
        </button>
      )}
    </div>
  );
}

function JogControls() {
  const service = usePrinterStore((s) => s.service);
  const status = usePrinterStore((s) => s.status);

  if (!service || !status || status.flags.printing) return null;

  const jog = (x?: number, y?: number, z?: number) => {
    service.jog(x, y, z).catch(() => {});
  };

  return (
    <div className="jog-controls">
      <div className="jog-label">Manual Jog</div>
      <div className="jog-grid">
        <div /><button className="jog-btn" onClick={() => jog(0, 10)}><ArrowUp size={14} /></button><div />
        <button className="jog-btn" onClick={() => jog(-10)}><ArrowLeft size={14} /></button>
        <button className="jog-btn home" onClick={() => service.homeAxes()}><Home size={12} /></button>
        <button className="jog-btn" onClick={() => jog(10)}><ArrowRight size={14} /></button>
        <div /><button className="jog-btn" onClick={() => jog(0, -10)}><ArrowDown size={14} /></button><div />
      </div>
      <div className="jog-z">
        <button className="jog-btn" onClick={() => jog(0, 0, 10)}>Z+10</button>
        <button className="jog-btn" onClick={() => jog(0, 0, 1)}>Z+1</button>
        <button className="jog-btn" onClick={() => jog(0, 0, -1)}>Z-1</button>
        <button className="jog-btn" onClick={() => jog(0, 0, -10)}>Z-10</button>
      </div>
    </div>
  );
}

function FileList() {
  const service = usePrinterStore((s) => s.service);
  const files = usePrinterStore((s) => s.files);
  const refreshFiles = usePrinterStore((s) => s.refreshFiles);
  const setError = usePrinterStore((s) => s.setError);

  if (!service) return null;

  const handlePrint = async (filename: string) => {
    try {
      await service.startPrint(filename);
    } catch (err) {
      setError(`Failed to start print: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await service.deleteFile(filename);
      refreshFiles();
    } catch (err) {
      setError(`Failed to delete: ${(err as Error).message}`);
    }
  };

  return (
    <div className="printer-files">
      <div className="files-header">
        <span>Files on Printer</span>
        <button className="icon-btn" onClick={refreshFiles} title="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="files-list">
        {files.length === 0 ? (
          <div className="files-empty">No files</div>
        ) : (
          files.map((file) => (
            <div key={file.path} className="file-item">
              <span className="file-name" title={file.name}>{file.name}</span>
              <div className="file-actions">
                <button className="icon-btn" onClick={() => handlePrint(file.path)} title="Print">
                  <Play size={12} />
                </button>
                <button className="icon-btn danger" onClick={() => handleDelete(file.path)} title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WebcamView() {
  const webcamUrl = usePrinterStore((s) => s.webcamUrl);
  const connected = usePrinterStore((s) => s.connected);

  if (!connected || !webcamUrl) return null;

  return (
    <div className="webcam-container">
      <div className="webcam-header">
        <Video size={12} />
        <span>Webcam</span>
      </div>
      <img
        src={webcamUrl}
        alt="Printer webcam"
        className="webcam-feed"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );
}

export default function PrinterMonitor() {
  const connected = usePrinterStore((s) => s.connected);
  const status = usePrinterStore((s) => s.status);
  const error = usePrinterStore((s) => s.error);
  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const startPolling = usePrinterStore((s) => s.startPolling);
  const stopPolling = usePrinterStore((s) => s.stopPolling);

  useEffect(() => {
    if (connected) {
      startPolling();
      return () => stopPolling();
    }
  }, [connected, startPolling, stopPolling]);

  if (!showPrinter) return null;

  return (
    <div className="printer-panel">
      <div className="printer-header">
        <div className="printer-title">
          {connected ? <Wifi size={14} className="connected" /> : <WifiOff size={14} className="disconnected" />}
          <h3>3D Printer</h3>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <Settings size={14} />
        </button>
      </div>

      {error && (
        <div className="printer-error">{error}</div>
      )}

      {!connected ? (
        <div className="printer-disconnected">
          <WifiOff size={32} />
          <p>Not connected to printer</p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowSettings(true)}>
            Connect
          </button>
        </div>
      ) : (
        <div className="printer-content">
          <div className="printer-status">
            <span className={`status-dot ${status?.flags.printing ? 'printing' : status?.flags.ready ? 'ready' : 'idle'}`} />
            <span>{status?.stateDescription || status?.state || 'Unknown'}</span>
          </div>

          <TemperatureDisplay />
          <ProgressDisplay />
          <PrintControls />
          <WebcamView />
          <JogControls />
          <FileList />
        </div>
      )}
    </div>
  );
}

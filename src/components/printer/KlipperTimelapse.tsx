import { useState, useEffect, useCallback } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { errorMessage } from '../../utils/errorHandling';
import { WifiOff, Camera, RefreshCw, Trash2, Download, Film, AlertCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService, type MoonrakerTimelapseFile } from '../../services/MoonrakerService';
import './KlipperTabs.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString();
}

export default function KlipperTimelapse() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);

  const [files, setFiles] = useState<MoonrakerTimelapseFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const run = useAsyncAction(setLoading, setError, 'Failed to load timelapse files — ensure [timelapse] is in moonraker.conf');
  const runRender = useAsyncAction(setRendering, setError, 'Render failed');
  const refresh = useCallback(async () => {
    if (!service) return;
    await run(async () => {
      const f = await service.getTimelapseFiles();
      setFiles(f);
    });
  }, [service, run]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleRender = useCallback(async () => {
    if (!service) return;
    await runRender(async () => {
      await service.renderTimelapse();
      await new Promise((r) => setTimeout(r, 2000));
      await refresh();
    });
  }, [service, refresh, runRender]);

  const handleDelete = useCallback(async (filename: string) => {
    if (!service || !confirm(`Delete "${filename}"?`)) return;
    try {
      await service.deleteTimelapseFile(filename);
      setFiles((prev) => prev.filter((f) => f.filename !== filename));
    } catch (e) {
      setError(errorMessage(e, 'Delete failed'));
    }
  }, [service]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to manage timelapse recordings.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Camera size={15} />
        <h3>Timelapse</h3>
        <div className="spacer" />
        <button className="klipper-btn klipper-btn-primary" onClick={handleRender} disabled={rendering}>
          <Film size={13} /> {rendering ? 'Rendering…' : 'Render Now'}
        </button>
        <button className="klipper-btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={14} /> {error}
            </div>
          </div>
        )}

        <div className="klipper-card">
          <div className="klipper-card-header">How it works</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              The Moonraker Timelapse plugin captures a frame at each layer change during a print (triggered by <code>TIMELAPSE_TAKE_FRAME</code> in your slicer's layer-change G-code). After the print finishes, click <strong>Render Now</strong> to assemble the frames into a video file. Videos are stored in the <code>timelapse/</code> folder on the printer.
            </p>
          </div>
        </div>

        <div className="klipper-card">
          <div className="klipper-card-header">
            Timelapse Videos
            <span className="klipper-badge info" style={{ marginLeft: 6 }}>{files.length}</span>
          </div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            {files.length === 0 && !loading ? (
              <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                No timelapse videos yet. Add <code>TIMELAPSE_TAKE_FRAME</code> to your layer-change G-code and print something.
              </div>
            ) : (
              <table className="klipper-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Size</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.filename}>
                      <td style={{ fontWeight: 600 }}>
                        <Film size={13} style={{ display: 'inline', marginRight: 5, color: 'var(--accent)' }} />
                        {f.filename}
                      </td>
                      <td>{formatBytes(f.size)}</td>
                      <td>{formatDate(f.modified)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a
                            href={service?.getFileUrl('timelapse', f.filename)}
                            download={f.filename}
                            className="klipper-btn"
                            style={{ textDecoration: 'none' }}
                          >
                            <Download size={12} />
                          </a>
                          <button
                            className="klipper-btn klipper-btn-danger"
                            onClick={() => handleDelete(f.filename)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

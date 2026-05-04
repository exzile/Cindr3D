import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleOff,
  Gauge,
  ListFilter,
  ListOrdered,
  MonitorPlay,
  Pencil,
  Plus,
  PlugZap,
  Settings,
  Thermometer,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { usePrintQueueStore } from '../../../store/printQueueStore';
import type { SavedPrinter } from '../../../types/duet';
import type { DuetPrefs } from '../../../utils/duetPrefs';
import { DEFAULT_PREFS } from '../../../utils/duetPrefs';
import { enabledCamerasFromPrefs, prefsWithCamera } from '../../../utils/cameraStreamUrl';
import { cameraDisplayUrl, previewCameraStreamUrl } from '../../../utils/cameraStreamUrl';
import { formatDurationWords } from '../../../utils/printerFormat';
import { formatUptime, statusColor } from './helpers';

function normalizedHost(hostname: string): string {
  const value = hostname.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  return `http://${value.replace(/\/$/, '')}`;
}

function prefsForPrinter(printer: SavedPrinter): DuetPrefs {
  return { ...DEFAULT_PREFS, ...(printer.prefs as Partial<DuetPrefs> | undefined) };
}

function cameraUrlForPrinter(printer: SavedPrinter): string {
  const prefs = prefsForPrinter(printer);
  const cameraPrefs = prefsWithCamera(prefs, prefs.dashboardCameraId);
  const fallbackUrl = (() => {
    const host = normalizedHost(printer.config.hostname);
    return host ? `${host}/webcam/?action=stream` : '';
  })();
  const cameraUrl = previewCameraStreamUrl(cameraPrefs, fallbackUrl);
  if (!cameraUrl) return '';
  return cameraDisplayUrl(cameraUrl, cameraPrefs.webcamUsername, cameraPrefs.webcamPassword);
}

const CLIP_DB_NAME = 'cindr3d-camera-clips';
const CLIP_STORE = 'clips';

async function countClipsForPrinter(printerId: string): Promise<number> {
  try {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(CLIP_DB_NAME, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(CLIP_STORE, 'readonly').objectStore(CLIP_STORE).getAll();
        req.onsuccess = () => resolve((req.result as Array<{ printerId: string }>).filter((c) => c.printerId === printerId).length);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

async function deleteClipsForPrinter(printerId: string): Promise<void> {
  try {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(CLIP_DB_NAME, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const tx = db.transaction(CLIP_STORE, 'readwrite');
      const store = tx.objectStore(CLIP_STORE);
      const all: Array<{ id: string; printerId: string }> = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const clip of all) {
        if (clip.printerId === printerId) store.delete(clip.id);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch { /* best effort */ }
}

function ManagePrintersDialog({
  printers,
  activePrinterId,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: {
  printers: SavedPrinter[];
  activePrinterId: string;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [clipCount, setClipCount] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!confirmDeleteId) return;
    let cancelled = false;
    countClipsForPrinter(confirmDeleteId).then((n) => { if (!cancelled) setClipCount(n); });
    return () => { cancelled = true; };
  }, [confirmDeleteId]);

  const startRename = (printer: SavedPrinter) => {
    setRenamingId(printer.id);
    setRenameDraft(printer.name);
  };

  const commitRename = (id: string) => {
    if (renameDraft.trim()) onRename(id, renameDraft.trim());
    setRenamingId(null);
  };

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    await deleteClipsForPrinter(confirmDeleteId);
    await onDelete(confirmDeleteId);
    setDeleting(false);
    setClipCount(null);
    setConfirmDeleteId(null);
  }, [confirmDeleteId, onDelete]);

  const deleteTarget = confirmDeleteId ? printers.find((p) => p.id === confirmDeleteId) : null;

  return (
    <div className="fleet-manage-overlay" onClick={onClose}>
      <div className="fleet-manage-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="fleet-manage-dialog__header">
          <h3>Manage Printers</h3>
          <button type="button" className="fleet-manage-dialog__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="fleet-manage-dialog__list">
          {printers.map((printer) => (
            <div key={printer.id} className={`fleet-manage-row${printer.id === activePrinterId ? ' is-active' : ''}`}>
              <div className="fleet-manage-row__info">
                {renamingId === printer.id ? (
                  <input
                    className="fleet-manage-row__rename"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(printer.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(printer.id); if (e.key === 'Escape') setRenamingId(null); }}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="fleet-manage-row__name">{printer.name}</span>
                    <span className="fleet-manage-row__host">{printer.config.hostname || 'No host'}</span>
                  </>
                )}
              </div>
              <div className="fleet-manage-row__actions">
                <button type="button" title="Rename" onClick={() => startRename(printer)}>
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  title={printers.length <= 1 ? 'Cannot delete last printer' : 'Delete printer'}
                  className="fleet-manage-row__delete"
                  disabled={printers.length <= 1}
                  onClick={() => {
                    setClipCount(null);
                    setConfirmDeleteId(printer.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="fleet-manage-dialog__footer">
          <button type="button" className="fleet-add-printer-btn" onClick={onAdd}>
            <Plus size={14} /> Add Printer
          </button>
        </div>

        {confirmDeleteId && deleteTarget && (
          <div
            className="fleet-manage-confirm-overlay"
            onClick={() => {
              if (!deleting) {
                setClipCount(null);
                setConfirmDeleteId(null);
              }
            }}
          >
            <div className="fleet-manage-confirm" onClick={(e) => e.stopPropagation()}>
              <div className="fleet-manage-confirm__icon">
                <AlertTriangle size={28} />
              </div>
              <h4>Delete "{deleteTarget.name}"?</h4>
              <p>This will permanently remove this printer and all associated data:</p>
              <ul className="fleet-manage-confirm__cascade">
                <li>Printer configuration and preferences</li>
                {clipCount === null ? (
                  <li>Camera recordings (checking...)</li>
                ) : clipCount > 0 ? (
                  <li><strong>{clipCount} camera recording{clipCount !== 1 ? 's' : ''}</strong> (clips, timelapses, snapshots)</li>
                ) : (
                  <li>No camera recordings</li>
                )}
                {deleteTarget.id === activePrinterId && (
                  <li>Active connection will be disconnected</li>
                )}
              </ul>
              <p className="fleet-manage-confirm__warning">This action cannot be undone.</p>
              <div className="fleet-manage-confirm__actions">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setClipCount(null);
                    setConfirmDeleteId(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="fleet-manage-confirm__delete" disabled={deleting} onClick={() => { void confirmDelete(); }}>
                  {deleting ? 'Deleting...' : 'Delete Printer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTemp(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--';
  return `${Math.round(value)}C`;
}

function CameraPreview({ name, url }: { name: string; url: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const available = Boolean(url) && failedUrl !== url;

  return (
    <div className="fleet-camera">
      {available ? (
        <img
          src={url}
          alt={`${name} camera preview`}
          loading="lazy"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <div className="fleet-camera__empty">
          <Camera size={20} />
          <span>{url ? 'Camera unavailable' : 'No camera URL'}</span>
        </div>
      )}
    </div>
  );
}

export default function PrinterFleetDashboard() {
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const connecting = usePrinterStore((s) => s.connecting);
  const reconnecting = usePrinterStore((s) => s.reconnecting);
  const model = usePrinterStore((s) => s.model);
  const addPrinter = usePrinterStore((s) => s.addPrinter);
  const removePrinter = usePrinterStore((s) => s.removePrinter);
  const renamePrinter = usePrinterStore((s) => s.renamePrinter);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const updatePrinterPrefs = usePrinterStore((s) => s.updatePrinterPrefs);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const connect = usePrinterStore((s) => s.connect);
  const queueJobs = usePrintQueueStore((s) => s.jobs);
  const [showManage, setShowManage] = useState(false);

  const activeStatus = model.state?.status ?? (connected ? 'connected' : 'disconnected');
  const isPrinting = connected && (activeStatus === 'processing' || activeStatus === 'simulating');

  const stats = useMemo(() => {
    const configured = printers.filter((printer) => printer.config.hostname.trim()).length;
    const cameraCount = printers.filter((printer) => cameraUrlForPrinter(printer)).length;
    return [
      { label: 'Printers', value: printers.length, icon: <MonitorPlay size={15} /> },
      { label: 'Configured', value: configured, icon: <CheckCircle2 size={15} /> },
      { label: 'Connected', value: connected ? 1 : 0, icon: <Wifi size={15} /> },
      { label: 'Cameras', value: cameraCount, icon: <Camera size={15} /> },
    ];
  }, [connected, printers]);

  const queuePreview = useMemo(() => {
    const active = queueJobs.filter((job) => !['done', 'cancelled', 'failed'].includes(job.status));
    return {
      active,
      ready: active.filter((job) => job.status === 'ready').length,
      blocked: active.filter((job) => job.status === 'blocked').length,
      printing: active.filter((job) => job.status === 'printing').length,
    };
  }, [queueJobs]);

  const jobFile = model.job?.file?.fileName ?? 'No active job';
  const fileSize = model.job?.file?.size ?? 0;
  const filePosition = model.job?.filePosition ?? 0;
  const hasActiveJob = connected && Boolean(model.job?.file?.fileName) && fileSize > 0;
  const progress = hasActiveJob ? Math.min(100, Math.max(0, (filePosition / fileSize) * 100)) : 0;
  const firstToolHeater = model.tools?.[0]?.heaters?.[0];
  const toolTemp = firstToolHeater !== undefined ? model.heat?.heaters?.[firstToolHeater]?.current : undefined;
  const firstBedHeater = model.heat?.bedHeaters?.[0];
  const bedTemp = firstBedHeater !== undefined ? model.heat?.heaters?.[firstBedHeater]?.current : undefined;

  const handleAddPrinter = () => {
    const id = addPrinter(`Printer ${printers.length + 1}`);
    selectPrinter(id).catch(() => {});
    setActiveTab('settings');
  };

  const monitorPrinter = async (printerId: string) => {
    if (printerId !== activePrinterId) {
      await selectPrinter(printerId);
    }
    setActiveTab('dashboard');
  };

  const connectPrinter = async (printerId: string) => {
    if (printerId !== activePrinterId) {
      await selectPrinter(printerId);
    }
    setActiveTab('dashboard');
    await connect();
  };

  return (
    <section className="fleet-dashboard" aria-label="Printer fleet dashboard">
      <div className="fleet-dashboard__header">
        <div>
          <div className="fleet-dashboard__eyebrow">Printer Fleet</div>
          <h2>Printers</h2>
        </div>
        <div className="fleet-dashboard__header-actions">
          <button type="button" className="fleet-add-printer-btn" onClick={handleAddPrinter}>
            <Plus size={14} /> Add Printer
          </button>
          <button type="button" className="fleet-manage-btn" onClick={() => setShowManage(true)}>
            <ListFilter size={14} /> Manage
          </button>
          <div className="fleet-dashboard__status">
            <span className="fleet-dashboard__dot" style={{ background: statusColor(activeStatus) }} />
            {reconnecting ? 'Reconnecting' : connected ? activeStatus : 'Offline'}
          </div>
        </div>
      </div>

      <div className="fleet-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="fleet-stat">
            <span className="fleet-stat__icon">{stat.icon}</span>
            <span className="fleet-stat__label">{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(160px, 1fr) auto',
          gap: 12,
          alignItems: 'center',
          padding: 12,
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-panel)',
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
            <ListOrdered size={15} /> Smart Queue
            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>
              {queuePreview.active.length} active - {queuePreview.ready} ready - {queuePreview.blocked} blocked - {queuePreview.printing} printing
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 6, overflow: 'hidden', color: 'var(--text-muted)', fontSize: 12 }}>
            {queuePreview.active.slice(0, 3).map((job) => (
              <span key={job.id} title={job.filePath} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.fileName}
              </span>
            ))}
            {queuePreview.active.length === 0 && <span>No queued jobs</span>}
          </div>
        </div>
        <button type="button" className="fleet-manage-btn" onClick={() => setActiveTab('queue')}>
          Open Queue
        </button>
      </div>

      <div className="fleet-printer-list">
          {printers.map((printer) => {
            const isActive = printer.id === activePrinterId;
            const hasHost = Boolean(printer.config.hostname.trim());
            const status = isActive ? activeStatus : hasHost ? 'saved' : 'setup needed';
            const cameraUrl = cameraUrlForPrinter(printer);
            const printerPrefs = prefsForPrinter(printer);
            const cameraOptions = enabledCamerasFromPrefs(printerPrefs);
            const cardHasLiveJob = isActive && hasActiveJob;
            const cardIsPrinting = isActive && isPrinting;
            const cardProgress = cardHasLiveJob ? progress : 0;
            const cardJobTitle = isActive && connected ? jobFile : hasHost ? 'No live connection' : 'Configure printer';
            const cardJobMeta = cardHasLiveJob
              ? `${Math.round(cardProgress)}% complete - ${formatDurationWords(model.job?.timesLeft?.file, '--', false)} left`
              : isActive && connected
                ? activeStatus
                : hasHost
                  ? 'Connect to show print job status'
                  : 'Add host/IP in settings';
            const cardProgressLabel = cardHasLiveJob ? `${Math.round(cardProgress)}%` : '--';
            const cardToolTemp = isActive && connected ? formatTemp(toolTemp) : '--';
            const cardBedTemp = isActive && connected ? formatTemp(bedTemp) : '--';
            const cardUptime = isActive && connected ? formatUptime(model.state?.upTime ?? 0) : '--';
            const cardTimeLeft = cardHasLiveJob ? formatDurationWords(model.job?.timesLeft?.file, '--', false) : '--';

            return (
              <article key={printer.id} className={`fleet-printer-row${isActive ? ' is-active' : ''}`}>
                <CameraPreview name={printer.name} url={cameraUrl} />
                <div className="fleet-printer-row__body">
                  <div className="fleet-printer-row__main">
                    <div className="fleet-printer-row__identity">
                      <div>
                        <h3>{printer.name}</h3>
                        <span>{printer.config.hostname || 'No host configured'}</span>
                      </div>
                      <span className="fleet-printer-row__state">
                        {isActive && connected ? <Wifi size={13} /> : hasHost ? <PlugZap size={13} /> : <CircleOff size={13} />}
                        {status}
                      </span>
                    </div>
                    <div className="fleet-printer-row__actions fleet-printer-row__actions--inline">
                      <button type="button" onClick={() => { void monitorPrinter(printer.id); }}>
                        <MonitorPlay size={13} /> Monitor
                      </button>
                      <button
                        type="button"
                        className={isActive && connected ? 'is-connected' : undefined}
                        disabled={!hasHost || connecting || (isActive && connected)}
                        onClick={() => { void connectPrinter(printer.id); }}
                      >
                        <Wifi size={13} /> {isActive && connected ? 'Connected' : connecting && isActive ? 'Connecting' : 'Connect'}
                      </button>
                      <button type="button" onClick={() => { void monitorPrinter(printer.id); setActiveTab('settings'); }}>
                        <Settings size={13} /> Settings
                      </button>
                      {cameraOptions.length > 1 && (
                        <select
                          value={printerPrefs.dashboardCameraId || printerPrefs.activeCameraId}
                          title="Dashboard camera"
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updatePrinterPrefs(printer.id, { dashboardCameraId: event.target.value })}
                        >
                          {cameraOptions.map((camera) => (
                            <option key={camera.id} value={camera.id}>{camera.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className={`fleet-printer-row__job${cardIsPrinting ? ' is-printing' : ''}`}>
                    <div className="fleet-printer-row__job-top">
                      <span>{cardJobTitle}</span>
                      <strong>{cardProgressLabel}</strong>
                    </div>
                    <div className="fleet-printer-row__job-meta">{cardJobMeta}</div>
                    <div className="fleet-printer-row__job-bar">
                      <span style={{ width: `${cardHasLiveJob ? cardProgress : 0}%` }} />
                    </div>
                  </div>

                  <div className="fleet-printer-row__metrics" aria-label={`${printer.name} live metrics`}>
                    <div>
                      <Thermometer size={14} />
                      <span>Tool</span>
                      <strong>{cardToolTemp}</strong>
                    </div>
                    <div>
                      <Thermometer size={14} />
                      <span>Bed</span>
                      <strong>{cardBedTemp}</strong>
                    </div>
                    <div>
                      <Gauge size={14} />
                      <span>Uptime</span>
                      <strong>{cardUptime}</strong>
                    </div>
                    <div>
                      <Activity size={14} />
                      <span>Left</span>
                      <strong>{cardTimeLeft}</strong>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
      </div>

      {showManage && (
        <ManagePrintersDialog
          printers={printers}
          activePrinterId={activePrinterId}
          onAdd={() => { setShowManage(false); handleAddPrinter(); }}
          onRename={renamePrinter}
          onDelete={async (id) => { removePrinter(id); }}
          onClose={() => setShowManage(false)}
        />
      )}
    </section>
  );
}

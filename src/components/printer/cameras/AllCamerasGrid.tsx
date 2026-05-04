import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Expand, Grid2X2, Minimize2, RefreshCcw, Timer, WifiOff } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import type { SavedPrinter } from '../../../types/duet';
import type { DuetPrefs } from '../../../utils/duetPrefs';
import { DEFAULT_PREFS } from '../../../utils/duetPrefs';
import { cameraDisplayUrl, enabledCamerasFromPrefs, prefsWithCamera, previewCameraStreamUrl } from '../../../utils/cameraStreamUrl';
import { formatDurationWords } from '../../../utils/printerFormat';
import { statusColor } from '../dashboard/helpers';
import './AllCamerasGrid.css';

type GridMode = 'compact' | 'expanded';

const REFRESH_OPTIONS = [0, 5, 15, 30, 60] as const;

function normalizedHost(hostname: string): string {
  const value = hostname.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, '');
  return `http://${value.replace(/\/$/, '')}`;
}

function prefsForPrinter(printer: SavedPrinter): DuetPrefs {
  const partial = printer.prefs as Partial<DuetPrefs> | undefined;
  return {
    ...DEFAULT_PREFS,
    ...partial,
    cameraDashboard: {
      ...DEFAULT_PREFS.cameraDashboard,
      ...(partial?.cameraDashboard ?? {}),
    },
  };
}

function cameraUrlForPrinter(printer: SavedPrinter, cameraId: string, refreshTick: number): string {
  const prefs = prefsWithCamera(prefsForPrinter(printer), cameraId);
  const fallbackUrl = (() => {
    const host = normalizedHost(printer.config.hostname);
    return host ? `${host}/webcam/?action=stream` : '';
  })();
  const cameraUrl = previewCameraStreamUrl(prefs, fallbackUrl);
  if (!cameraUrl) return '';
  const displayUrl = cameraDisplayUrl(cameraUrl, prefs.webcamUsername, prefs.webcamPassword);
  if (refreshTick === 0) return displayUrl;
  try {
    const url = new URL(displayUrl, window.location.href);
    url.searchParams.set('cameraRefresh', String(refreshTick));
    return url.toString();
  } catch {
    const joiner = displayUrl.includes('?') ? '&' : '?';
    return `${displayUrl}${joiner}cameraRefresh=${refreshTick}`;
  }
}

function formatLayer(layer: number | undefined): string {
  if (layer === undefined || Number.isNaN(layer)) return '--';
  return String(layer);
}

export default function AllCamerasGrid() {
  const printers = usePrinterStore((s) => s.printers);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const selectPrinter = usePrinterStore((s) => s.selectPrinter);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const updatePrinterPrefs = usePrinterStore((s) => s.updatePrinterPrefs);
  const [mode, setMode] = useState<GridMode>('expanded');
  const [refreshRateSec, setRefreshRateSec] = useState<(typeof REFRESH_OPTIONS)[number]>(15);
  const [refreshTick, setRefreshTick] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (refreshRateSec === 0) return undefined;
    const timer = window.setInterval(() => setRefreshTick((tick) => tick + 1), refreshRateSec * 1000);
    return () => window.clearInterval(timer);
  }, [refreshRateSec]);

  const activeStatus = model.state?.status ?? (connected ? 'connected' : 'disconnected');
  const hasActiveJob = connected && Boolean(model.job?.file?.fileName);
  const activeLayer = model.job?.layer;
  const activeEta = formatDurationWords(model.job?.timesLeft?.file, '--', false);
  const activeAlerts = useMemo(() => {
    const alerts: string[] = [];
    if (model.state?.displayMessage) alerts.push(model.state.displayMessage);
    if (model.state?.status === 'paused') alerts.push('Paused');
    if (model.state?.status === 'cancelling') alerts.push('Cancelling');
    return alerts;
  }, [model.state?.displayMessage, model.state?.status]);

  const tiles = useMemo(() => printers.flatMap((printer) => {
    const isActive = printer.id === activePrinterId;
    const cameraOptions = enabledCamerasFromPrefs(prefsForPrinter(printer));
    return cameraOptions.map((camera) => {
    const url = cameraUrlForPrinter(printer, camera.id, refreshTick);
    const tileId = `${printer.id}:${camera.id}`;
    const failed = failedUrls[tileId] === url;
    const status = isActive ? activeStatus : printer.config.hostname.trim() ? 'saved' : 'setup needed';
    return {
      id: tileId,
      printer,
      camera,
      isActive,
      status,
      cameraUrl: failed ? '' : url,
      layer: isActive && hasActiveJob ? formatLayer(activeLayer) : '--',
      eta: isActive && hasActiveJob ? activeEta : '--',
      alerts: isActive ? activeAlerts : [],
    };
    });
  }), [activeAlerts, activeEta, activeLayer, activePrinterId, activeStatus, failedUrls, hasActiveJob, printers, refreshTick]);

  const openPrinter = useCallback(async (printerId: string, cameraId: string) => {
    if (printerId !== activePrinterId) {
      await selectPrinter(printerId);
    }
    updatePrinterPrefs(printerId, { activeCameraId: cameraId });
    setActiveTab('camera');
  }, [activePrinterId, selectPrinter, setActiveTab, updatePrinterPrefs]);

  return (
    <section className={`all-cameras-grid all-cameras-grid--${mode}`} aria-label="All cameras grid">
      <div className="all-cameras-grid__toolbar">
        <div className="all-cameras-grid__title">
          <Grid2X2 size={17} />
          <h2>All Cameras</h2>
          <span>{printers.length} saved printer{printers.length === 1 ? '' : 's'}</span>
        </div>
        <div className="all-cameras-grid__controls">
          <button
            type="button"
            className={mode === 'compact' ? 'is-active' : undefined}
            title="Compact mode"
            onClick={() => setMode('compact')}
          >
            <Minimize2 size={14} />
          </button>
          <button
            type="button"
            className={mode === 'expanded' ? 'is-active' : undefined}
            title="Expanded mode"
            onClick={() => setMode('expanded')}
          >
            <Expand size={14} />
          </button>
          <label>
            <RefreshCcw size={13} />
            <select
              value={refreshRateSec}
              onChange={(event) => setRefreshRateSec(Number(event.target.value) as (typeof REFRESH_OPTIONS)[number])}
              title="Refresh rate"
            >
              {REFRESH_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0 ? 'Live' : `${seconds}s`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="all-cameras-grid__tiles">
        {tiles.map(({ id, printer, camera, isActive, status, cameraUrl, layer, eta, alerts }) => (
          <button
            type="button"
            key={id}
            className={`all-camera-tile${isActive ? ' is-active' : ''}`}
            onClick={() => { void openPrinter(printer.id, camera.id); }}
          >
            <div className="all-camera-tile__media">
              {cameraUrl ? (
                <img
                  src={cameraUrl}
                  alt={`${printer.name} webcam`}
                  loading="lazy"
                  onError={() => setFailedUrls((current) => ({ ...current, [id]: cameraUrl }))}
                />
              ) : (
                <div className="all-camera-tile__empty">
                  {printer.config.hostname.trim() ? <Camera size={24} /> : <WifiOff size={24} />}
                  <span>{printer.config.hostname.trim() ? 'Camera unavailable' : 'No host configured'}</span>
                </div>
              )}
              <div className="all-camera-tile__overlay">
                <div className="all-camera-tile__topline">
                  <strong>{printer.name}</strong>
                  <span>
                    <i style={{ background: statusColor(status) }} />
                    {status}
                  </span>
                </div>
                <div className="all-camera-tile__metrics">
                  <span><Camera size={13} /> {camera.label}</span>
                  <span><Grid2X2 size={13} /> Layer {layer}</span>
                  <span><Timer size={13} /> ETA {eta}</span>
                </div>
                {alerts.length > 0 && (
                  <div className="all-camera-tile__alerts">
                    {alerts.slice(0, 2).map((alert) => <span key={alert}>{alert}</span>)}
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

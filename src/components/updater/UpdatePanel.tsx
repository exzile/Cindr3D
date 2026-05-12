import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import './UpdatePanel.css';
import { errorMessage } from '../../utils/errorHandling';

interface UpdateStatus {
  ok: boolean;
  repo?: string;
  installed?: {
    channel?: string;
    releaseTag?: string;
    installedAt?: string;
  };
  releaseUpdate?: {
    tag: string;
    name: string;
    publishedAt: string;
    available: boolean;
    hasInstallableAsset: boolean;
  } | null;
  error?: string;
}

interface ApplyResult {
  ok: boolean;
  message?: string;
  error?: string;
  installed?: UpdateStatus['installed'];
}

const tokenStorageKey = 'cindr3d.updaterToken';

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

interface UpdatePanelProps {
  onAlertChange?: (hasAlert: boolean) => void;
}

export default function UpdatePanel({ onAlertChange }: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState('Checking for updates...');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(tokenStorageKey) ?? '');
  const inFlightRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }, []);

  const releaseAvailable = useMemo(() => {
    return Boolean(status?.releaseUpdate?.available && status.releaseUpdate.hasInstallableAsset);
  }, [status]);

  const loadStatus = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setBusy(true);
    try {
      const result = await readJson<UpdateStatus>(await fetch('/api/update/status', { signal: controller.signal }));
      if (!mountedRef.current || controller.signal.aborted) return;
      setStatus(result);
      setMessage(result.ok ? 'Update status refreshed.' : result.error ?? 'Updater is unavailable.');
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setMessage(`Updater is unavailable: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      if (mountedRef.current) setBusy(false);
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (token) localStorage.setItem(tokenStorageKey, token);
    else localStorage.removeItem(tokenStorageKey);
  }, [token]);

  useEffect(() => {
    onAlertChange?.(releaseAvailable);
  }, [onAlertChange, releaseAvailable]);

  const applyUpdate = async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setBusy(true);
    setMessage('Installing latest release...');
    try {
      const response = await fetch('/api/update/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Cindr3D-Updater-Key': token } : {}),
        },
        body: JSON.stringify({ channel: 'release' }),
        signal: controller.signal,
      });
      const result = await readJson<ApplyResult>(response);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? `Install failed with HTTP ${response.status}`);
        return;
      }
      setMessage(result.message ?? 'Update installed. Reloading...');
      await loadStatus();
      if (!mountedRef.current) return;
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setMessage(`Install failed: ${errorMessage(err, 'Unknown error')}`);
    } finally {
      if (mountedRef.current) setBusy(false);
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  };

  return (
    <div className="update-panel">
      <div className={`update-panel-card${releaseAvailable ? ' update-panel-card--alert' : ''}`}>
        <div className="update-panel-header">
          <div className="update-panel-title">
            <DownloadCloud size={16} />
            <span>{releaseAvailable ? 'Release available' : 'Site Updates'}</span>
          </div>
        </div>

        <div className="update-panel-row">
          <span className="update-panel-label">Installed</span>
          <span className="update-panel-value strong">
            {status?.installed?.releaseTag ?? 'manual install'}
          </span>
        </div>
        <div className="update-panel-row">
          <span className="update-panel-label">Release</span>
          <span className="update-panel-value">
            {status?.releaseUpdate
              ? `${status.releaseUpdate.tag}${status.releaseUpdate.available ? ' available' : ' current'}`
              : 'none found'}
          </span>
        </div>

        <label className="update-panel-token">
          <span className="update-panel-label">Updater key</span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste key from the Pi"
            type="password"
          />
        </label>

        <div className="update-panel-actions">
          <button onClick={loadStatus} disabled={busy}>
            <RefreshCw size={14} />
            <span>Check</span>
          </button>
          <button
            className="primary"
            onClick={applyUpdate}
            disabled={busy || !releaseAvailable}
          >
            <DownloadCloud size={14} />
            <span>Install</span>
          </button>
        </div>

        <div className="update-panel-message">{message}</div>
      </div>
    </div>
  );
}

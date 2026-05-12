import { useState, useEffect, useCallback } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { errorMessage } from '../../utils/errorHandling';
import { RefreshCw, WifiOff, ArrowUpCircle, CheckCircle2, AlertCircle, Loader2, Download } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService, type MoonrakerUpdateStatus, type MoonrakerUpdateComponent } from '../../services/MoonrakerService';
import './KlipperTabs.css';

function ComponentRow({
  name,
  comp,
  onUpdate,
  updating,
}: {
  name: string;
  comp: MoonrakerUpdateComponent;
  onUpdate: (name: string) => void;
  updating: boolean;
}) {
  const behind = comp.commits_behind?.length ?? 0;
  const hasUpdate = behind > 0 || comp.is_dirty;

  return (
    <tr>
      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{name}</td>
      <td>
        <code style={{ fontSize: 11 }}>{comp.version || '—'}</code>
      </td>
      <td>
        <code style={{ fontSize: 11 }}>{comp.remote_version || '—'}</code>
      </td>
      <td>
        {hasUpdate ? (
          <span className="klipper-badge warn">
            <ArrowUpCircle size={11} />
            {behind > 0 ? `${behind} commit${behind !== 1 ? 's' : ''} behind` : 'Dirty'}
          </span>
        ) : (
          <span className="klipper-badge on">
            <CheckCircle2 size={11} /> Up to date
          </span>
        )}
      </td>
      <td>
        {hasUpdate && (
          <button
            className="klipper-btn klipper-btn-primary"
            onClick={() => onUpdate(name)}
            disabled={updating}
          >
            {updating ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
            Update
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * When `embedded` is true the component renders only the card content
 * (no outer klipper-tab wrapper or tab-bar) so UpdateManager.tsx can
 * include it inline inside its own tab body.
 */
export default function KlipperUpdateManager({ embedded = false }: { embedded?: boolean } = {}) {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);

  const [status, setStatus] = useState<MoonrakerUpdateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingComponent, setUpdatingComponent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const run = useAsyncAction(setLoading, setError, 'Failed to load update status');
  const refresh = useCallback(async (forceRefresh = false) => {
    if (!service) return;
    await run(async () => {
      const s = await service.getUpdateStatus(forceRefresh);
      setStatus(s);
    });
  }, [service, run]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleUpdate = useCallback(async (name: string) => {
    if (!service) return;
    if (!confirm(`Update "${name}"? Klipper will restart.`)) return;
    setUpdatingComponent(name);
    try {
      await service.updateComponent(name);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Update failed'));
    } finally {
      setUpdatingComponent(null);
    }
  }, [service, refresh]);

  const handleFullUpdate = useCallback(async () => {
    if (!service) return;
    if (!confirm('Run a full system update? Klipper and Moonraker will restart.')) return;
    setUpdatingComponent('all');
    try {
      await service.fullUpdate();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Full update failed'));
    } finally {
      setUpdatingComponent(null);
    }
  }, [service, refresh]);

  const components = status?.components ?? {};
  const entries = Object.entries(components);
  const updatableCount = entries.filter(([, c]) => (c.commits_behind?.length ?? 0) > 0 || c.is_dirty).length;

  if (!connected) {
    if (embedded) {
      return (
        <div className="klipper-card">
          <div className="klipper-card-header">Moonraker Components</div>
          <div className="klipper-card-body" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Not connected to Klipper — component update status unavailable.
          </div>
        </div>
      );
    }
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to manage software updates.</span>
        </div>
      </div>
    );
  }

  // Embedded mode: render only the content cards, no outer wrapper
  if (embedded) {
    return (
      <>
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={13} style={{ display: 'inline', marginRight: 4 }} />{error}
            </div>
          </div>
        )}
        <div className="klipper-card">
          <div className="klipper-card-header">
            Moonraker Components
            {updatableCount > 0 && (
              <span className="klipper-badge warn" style={{ marginLeft: 6 }}>{updatableCount} update{updatableCount !== 1 ? 's' : ''}</span>
            )}
            <div style={{ flex: 1 }} />
            <button className="klipper-btn" style={{ marginLeft: 'auto' }} onClick={() => refresh(true)} disabled={loading || updatingComponent !== null}>
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
            </button>
          </div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            <table className="klipper-table">
              <thead><tr><th>Component</th><th>Current</th><th>Latest</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {entries.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 12, color: 'var(--text-muted)' }}>{loading ? 'Loading…' : 'No components'}</td></tr>
                )}
                {entries.map(([name, comp]) => (
                  <ComponentRow key={name} name={name} comp={comp} onUpdate={handleUpdate} updating={updatingComponent === name} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <ArrowUpCircle size={15} />
        <h3>Update Manager</h3>
        {updatableCount > 0 && (
          <span className="klipper-badge warn">{updatableCount} update{updatableCount !== 1 ? 's' : ''} available</span>
        )}
        <div className="spacer" />
        {updatableCount > 0 && (
          <button
            className="klipper-btn klipper-btn-primary"
            onClick={handleFullUpdate}
            disabled={updatingComponent !== null}
          >
            {updatingComponent === 'all' ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
            Update All
          </button>
        )}
        <button
          className="klipper-btn"
          onClick={() => refresh(true)}
          disabled={loading || updatingComponent !== null}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Check for Updates
        </button>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={13} style={{ display: 'inline', marginRight: 4 }} />
              {error}
            </div>
          </div>
        )}

        {status?.busy && (
          <div className="klipper-card">
            <div className="klipper-card-body" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Loader2 size={16} className="spin" />
              <span>Update in progress…</span>
            </div>
          </div>
        )}

        <div className="klipper-card">
          <div className="klipper-card-header">Software Components</div>
          <div className="klipper-card-body" style={{ padding: 0 }}>
            <table className="klipper-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Current</th>
                  <th>Latest</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                      {loading ? 'Loading…' : 'No components found'}
                    </td>
                  </tr>
                )}
                {entries.map(([name, comp]) => (
                  <ComponentRow
                    key={name}
                    name={name}
                    comp={comp}
                    onUpdate={handleUpdate}
                    updating={updatingComponent === name}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

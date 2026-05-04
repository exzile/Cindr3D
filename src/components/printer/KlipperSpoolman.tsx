import { useState, useEffect, useCallback } from 'react';
import { WifiOff, Package, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService, type MoonrakerSpoolmanSpool } from '../../services/MoonrakerService';
import './KlipperTabs.css';

export default function KlipperSpoolman() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);

  const [spool, setSpool] = useState<MoonrakerSpoolmanSpool | null>(null);
  const [loading, setLoading] = useState(false);
  const [newSpoolId, setNewSpoolId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const refresh = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      const spoolId = await service.getActiveSpoolId();
      if (spoolId !== null) {
        const s = await service.getSpoolById(spoolId);
        setSpool(s);
      } else {
        setSpool(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load spool — ensure [spoolman] is in moonraker.conf');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSetSpool = useCallback(async () => {
    if (!service) return;
    const id = parseInt(newSpoolId);
    if (isNaN(id)) { setError('Enter a valid spool ID'); return; }
    try {
      await service.setActiveSpool(id);
      setNewSpoolId('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set spool');
    }
  }, [service, newSpoolId, refresh]);

  const handleClearSpool = useCallback(async () => {
    if (!service) return;
    try {
      await service.setActiveSpool(null);
      setSpool(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear spool');
    }
  }, [service]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to manage filament spools.</span>
        </div>
      </div>
    );
  }

  const spoolmanUrl = service ? `http://${config.hostname.replace(/^https?:\/\//, '').replace(/\/+$/, '')}:7912` : '';

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Package size={15} />
        <h3>Spoolman</h3>
        <div className="spacer" />
        <a
          href={spoolmanUrl}
          target="_blank"
          rel="noreferrer"
          className="klipper-btn"
          style={{ textDecoration: 'none' }}
        >
          <ExternalLink size={13} /> Open Spoolman
        </a>
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
          <div className="klipper-card-header">Active Spool</div>
          <div className="klipper-card-body">
            {spool ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: `#${spool.filament?.color_hex ?? 'aaaaaa'}`,
                      border: '2px solid var(--border)',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {spool.filament?.vendor?.name} — {spool.filament?.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {spool.filament?.material} · Spool #{spool.id}
                    </div>
                  </div>
                </div>
                <table className="klipper-table">
                  <tbody>
                    {spool.remaining_weight !== undefined && (
                      <tr>
                        <td style={{ fontWeight: 600 }}>Remaining weight</td>
                        <td>{spool.remaining_weight.toFixed(1)} g</td>
                      </tr>
                    )}
                    {spool.remaining_length !== undefined && (
                      <tr>
                        <td style={{ fontWeight: 600 }}>Remaining length</td>
                        <td>{(spool.remaining_length / 1000).toFixed(2)} m</td>
                      </tr>
                    )}
                    {spool.used_weight !== undefined && (
                      <tr>
                        <td style={{ fontWeight: 600 }}>Used weight</td>
                        <td>{spool.used_weight.toFixed(1)} g</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div>
                  <button className="klipper-btn klipper-btn-danger" onClick={handleClearSpool}>
                    Clear Active Spool
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No active spool selected.</p>
            )}
          </div>
        </div>

        <div className="klipper-card">
          <div className="klipper-card-header">Set Active Spool</div>
          <div className="klipper-card-body">
            <div className="klipper-form-row">
              <label>Spool ID</label>
              <input
                type="number"
                min={1}
                placeholder="e.g. 42"
                value={newSpoolId}
                onChange={(e) => setNewSpoolId(e.target.value)}
                style={{ width: 100 }}
              />
              <button className="klipper-btn klipper-btn-primary" onClick={handleSetSpool} disabled={!newSpoolId}>
                Set Spool
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              Find the spool ID in the Spoolman web UI. Klipper will automatically track filament usage for the active spool.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

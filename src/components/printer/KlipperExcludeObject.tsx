import { useState, useEffect, useCallback } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { errorMessage } from '../../utils/errorHandling';
import { RefreshCw, WifiOff, Layers, X } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService, type MoonrakerExcludeObjectStatus } from '../../services/MoonrakerService';
import './KlipperTabs.css';

export default function KlipperExcludeObject() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);

  const [status, setStatus] = useState<MoonrakerExcludeObjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const run = useAsyncAction(setLoading, setError, 'Failed to load object list');
  const refresh = useCallback(async () => {
    if (!service) return;
    await run(async () => {
      const s = await service.getExcludeObjectStatus();
      setStatus(s);
    });
  }, [service, run]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleExclude = useCallback(async (name: string) => {
    if (!service) return;
    try {
      await service.excludeObject(name);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Failed to exclude object'));
    }
  }, [service, refresh]);

  const handleReset = useCallback(async () => {
    if (!service) return;
    if (!confirm('Reset all excluded objects?')) return;
    try {
      await service.resetExcludeObjects();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, 'Failed to reset'));
    }
  }, [service, refresh]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to manage excluded objects.</span>
        </div>
      </div>
    );
  }

  const objects = status?.objects ?? [];
  const excluded = new Set(status?.excluded_objects ?? []);
  const current = status?.current_object;

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Layers size={15} />
        <h3>Exclude Object</h3>
        <div className="spacer" />
        {excluded.size > 0 && (
          <button className="klipper-btn klipper-btn-danger" onClick={handleReset}>
            <X size={13} /> Reset All
          </button>
        )}
        <button className="klipper-btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ color: '#ef4444', fontSize: 12 }}>
              {error}
            </div>
          </div>
        )}

        {objects.length === 0 && !loading && (
          <div className="klipper-disconnected" style={{ flex: 'none', padding: '24px' }}>
            <Layers size={28} />
            <span>No print objects available. Exclude Object requires a Klipper config entry and an active print with labeled objects.</span>
          </div>
        )}

        {objects.length > 0 && (
          <div className="klipper-card">
            <div className="klipper-card-header">
              Objects on plate &nbsp;
              <span className="klipper-badge info">{objects.length - excluded.size} remaining</span>
              {excluded.size > 0 && (
                <span className="klipper-badge error" style={{ marginLeft: 4 }}>{excluded.size} excluded</span>
              )}
            </div>
            <div className="klipper-card-body">
              <div className="klipper-object-grid">
                {objects.map((obj) => (
                  <button
                    key={obj.name}
                    className={`klipper-object-btn${excluded.has(obj.name) ? ' excluded' : ''}${obj.name === current ? ' current' : ''}`}
                    onClick={() => !excluded.has(obj.name) && handleExclude(obj.name)}
                    title={excluded.has(obj.name) ? 'Excluded' : `Click to exclude "${obj.name}"`}
                  >
                    <span>{obj.name}</span>
                    {obj.name === current && <span className="klipper-badge info" style={{ marginTop: 2 }}>Printing</span>}
                    {excluded.has(obj.name) && <span className="klipper-badge error" style={{ marginTop: 2 }}>Excluded</span>}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Click an object to exclude it from the current print. Excluded objects cannot be un-excluded mid-print.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

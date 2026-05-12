import { useState, useEffect, useCallback } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { RefreshCw, WifiOff, Zap, Power, AlertCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { MoonrakerService, type MoonrakerPowerDevice } from '../../services/MoonrakerService';
import './KlipperTabs.css';

function DeviceCard({ device, onToggle }: { device: MoonrakerPowerDevice; onToggle: (name: string, action: 'on' | 'off') => Promise<void> }) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    const next = device.status === 'on' ? 'off' : 'on';
    setToggling(true);
    try { await onToggle(device.device, next); } finally { setToggling(false); }
  };

  const statusClass = device.status === 'on' ? 'on' : device.status === 'error' ? 'error' : 'off';

  return (
    <div className="klipper-card" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
      <Power size={18} style={{ color: device.status === 'on' ? '#22c55e' : 'var(--text-muted)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{device.device}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Type: {device.type}
          {device.locked_while_printing && <span style={{ marginLeft: 6 }}>· Locked while printing</span>}
        </div>
      </div>
      <span className={`klipper-badge ${statusClass}`}>{device.status}</span>
      <button
        className={`klipper-btn ${device.status === 'on' ? '' : 'klipper-btn-primary'}`}
        onClick={handleToggle}
        disabled={toggling || device.status === 'error'}
        style={{ flexShrink: 0 }}
      >
        <Power size={13} />
        {device.status === 'on' ? 'Turn Off' : 'Turn On'}
      </button>
    </div>
  );
}

export default function KlipperPowerDevices() {
  const connected = usePrinterStore((s) => s.connected);
  const config = usePrinterStore((s) => s.config);

  const [devices, setDevices] = useState<MoonrakerPowerDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service] = useState(() => connected ? new MoonrakerService(config.hostname) : null);

  const run = useAsyncAction(setLoading, setError, 'Failed to load devices — ensure [power] is configured in moonraker.conf');
  const refresh = useCallback(async () => {
    if (!service) return;
    await run(async () => {
      const d = await service.getPowerDevices();
      setDevices(d);
    });
  }, [service, run]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleToggle = useCallback(async (name: string, action: 'on' | 'off') => {
    if (!service) return;
    await service.setPowerDevice(name, action);
    await refresh();
  }, [service, refresh]);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Klipper printer to control power devices.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Zap size={15} />
        <h3>Power Devices</h3>
        <div className="spacer" />
        <button className="klipper-btn" onClick={refresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="klipper-tab-body">
        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, color: '#ef4444', fontSize: 12 }}>
              <AlertCircle size={14} />
              {error}
            </div>
          </div>
        )}

        {devices.length === 0 && !loading && !error && (
          <div className="klipper-disconnected" style={{ flex: 'none', padding: '24px' }}>
            <Zap size={28} />
            <span>No power devices found. Add a <code>[power]</code> section to <code>moonraker.conf</code> to control power relays and smart plugs.</span>
          </div>
        )}

        {devices.map((d) => (
          <DeviceCard key={d.device} device={d} onToggle={handleToggle} />
        ))}
      </div>
    </div>
  );
}

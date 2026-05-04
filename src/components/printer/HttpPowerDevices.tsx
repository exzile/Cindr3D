/**
 * HttpPowerDevices — smart plug control via HTTP REST APIs.
 * Supports: Tasmota, Shelly Gen1, Shelly Gen2, generic URL toggle.
 * Device list is persisted in localStorage.
 */
import { useState } from 'react';
import { Zap, Plus, Trash2, Power, RefreshCw, X, Save, Info } from 'lucide-react';
import './KlipperTabs.css';

type DeviceType = 'tasmota' | 'shelly1' | 'shelly2' | 'generic';

interface PowerDevice {
  id: string;
  name: string;
  type: DeviceType;
  host: string; // http://192.168.1.x
  /** relay channel index — for multi-relay devices */
  channel: number;
  /** current known state, null = unknown */
  state: 'on' | 'off' | null;
}

const STORAGE_KEY = 'cindr3d-power-devices';

function loadDevices(): PowerDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PowerDevice[]) : [];
  } catch { return []; }
}

function saveDevices(devices: PowerDevice[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(devices)); } catch { /* noop */ }
}

const TYPE_LABELS: Record<DeviceType, string> = {
  tasmota: 'Tasmota',
  shelly1: 'Shelly (Gen1)',
  shelly2: 'Shelly (Gen2)',
  generic: 'Generic HTTP',
};

/** Build the URL to turn a device on or off */
function buildUrl(device: PowerDevice, action: 'on' | 'off' | 'toggle'): string {
  const base = device.host.replace(/\/+$/, '');
  const ch = device.channel;
  switch (device.type) {
    case 'tasmota':
      return `${base}/cm?cmnd=Power${ch > 0 ? ch : ''}%20${action.charAt(0).toUpperCase() + action.slice(1)}`;
    case 'shelly1':
      return `${base}/relay/${ch}?turn=${action}`;
    case 'shelly2':
      return `${base}/rpc/Switch.Set?id=${ch}&on=${action === 'on' ? 'true' : 'false'}`;
    case 'generic':
      return `${base}/${action}`;
  }
}

/** Try to read current state from the device */
async function fetchState(device: PowerDevice): Promise<'on' | 'off' | null> {
  try {
    const base = device.host.replace(/\/+$/, '');
    const ch = device.channel;
    let url = '';
    switch (device.type) {
      case 'tasmota':
        url = `${base}/cm?cmnd=Power${ch > 0 ? ch : ''}`;
        break;
      case 'shelly1':
        url = `${base}/relay/${ch}`;
        break;
      case 'shelly2':
        url = `${base}/rpc/Switch.GetStatus?id=${ch}`;
        break;
      default:
        return null;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const json = await res.json() as Record<string, unknown>;
    // Tasmota: { "POWER": "ON" } or { "POWER1": "ON" }
    if (device.type === 'tasmota') {
      const key = ch > 0 ? `POWER${ch}` : 'POWER';
      const val = json[key];
      return val === 'ON' ? 'on' : val === 'OFF' ? 'off' : null;
    }
    // Shelly Gen1: { "ison": true }
    if (device.type === 'shelly1') {
      return (json as { ison?: boolean }).ison ? 'on' : 'off';
    }
    // Shelly Gen2: { "output": true }
    if (device.type === 'shelly2') {
      return (json as { output?: boolean }).output ? 'on' : 'off';
    }
    return null;
  } catch { return null; }
}

/** Send an on/off/toggle command */
async function sendCommand(device: PowerDevice, action: 'on' | 'off' | 'toggle'): Promise<void> {
  const url = buildUrl(device, action);
  const res = await fetch(url, { method: device.type === 'shelly2' ? 'POST' : 'GET', signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ─── AddDeviceModal ──────────────────────────────────────────────────────────

function AddDeviceModal({ onClose, onAdd }: { onClose: () => void; onAdd: (d: PowerDevice) => void }) {
  const [form, setForm] = useState<{ name: string; type: DeviceType; host: string; channel: number }>({
    name: '', type: 'tasmota', host: 'http://192.168.1.', channel: 0,
  });

  const patch = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleAdd = () => {
    if (!form.host || !form.name) return;
    onAdd({
      id: `pd-${Date.now()}`,
      name: form.name,
      type: form.type,
      host: form.host,
      channel: form.channel,
      state: null,
    });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8,
        padding: 20, width: 360, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Add Power Device</span>
          <button className="klipper-btn" style={{ padding: '2px 6px' }} onClick={onClose}><X size={13} /></button>
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 80 }}>Name</label>
          <input type="text" placeholder="e.g. PSU" value={form.name}
            onChange={(e) => patch('name', e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 80 }}>Type</label>
          <select value={form.type} onChange={(e) => patch('type', e.target.value as DeviceType)} style={{ flex: 1 }}>
            {(Object.keys(TYPE_LABELS) as DeviceType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="klipper-form-row">
          <label style={{ minWidth: 80 }}>Host URL</label>
          <input type="text" placeholder="http://192.168.1.x" value={form.host}
            onChange={(e) => patch('host', e.target.value)} style={{ flex: 1 }} />
        </div>
        {(form.type === 'shelly1' || form.type === 'shelly2') && (
          <div className="klipper-form-row">
            <label style={{ minWidth: 80 }}>Channel</label>
            <input type="number" min={0} max={7} value={form.channel}
              onChange={(e) => patch('channel', parseInt(e.target.value) || 0)} style={{ width: 70 }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="klipper-btn" onClick={onClose}>Cancel</button>
          <button className="klipper-btn klipper-btn-primary" onClick={handleAdd}
            disabled={!form.name || !form.host}>
            <Save size={13} /> Add Device
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DeviceCard ──────────────────────────────────────────────────────────────

function DeviceCard({ device, onUpdate, onRemove }: {
  device: PowerDevice;
  onUpdate: (patch: Partial<PowerDevice>) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setBusy(true); setError(null);
    try {
      const action = device.state === 'on' ? 'off' : 'on';
      await sendCommand(device, action);
      onUpdate({ state: action });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed');
    } finally { setBusy(false); }
  };

  const handleRefresh = async () => {
    setBusy(true); setError(null);
    try {
      const s = await fetchState(device);
      onUpdate({ state: s });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="klipper-card">
      <div className="klipper-card-body" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Power
          size={20}
          style={{ color: device.state === 'on' ? '#22c55e' : device.state === 'off' ? '#ef4444' : 'var(--text-muted)', flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{device.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {TYPE_LABELS[device.type]} · {device.host}
            {device.channel > 0 ? ` · ch${device.channel}` : ''}
          </div>
          {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{error}</div>}
        </div>
        <span className={`klipper-badge ${device.state === 'on' ? 'on' : device.state === 'off' ? 'off' : 'warn'}`}>
          {device.state ?? '?'}
        </span>
        <button className="klipper-btn" onClick={handleRefresh} disabled={busy} title="Refresh state">
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
        </button>
        <button
          className={`klipper-btn ${device.state === 'on' ? 'klipper-btn-danger' : 'klipper-btn-primary'}`}
          onClick={handleToggle}
          disabled={busy}
        >
          <Power size={13} /> {device.state === 'on' ? 'Turn Off' : 'Turn On'}
        </button>
        <button className="klipper-btn klipper-btn-danger" onClick={onRemove} style={{ padding: '4px 6px' }}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function HttpPowerDevices() {
  const [devices, setDevices] = useState<PowerDevice[]>(loadDevices);
  const [showAdd, setShowAdd] = useState(false);

  const persist = (updated: PowerDevice[]) => { setDevices(updated); saveDevices(updated); };

  const addDevice = (d: PowerDevice) => persist([...devices, d]);
  const removeDevice = (id: string) => persist(devices.filter((d) => d.id !== id));
  const updateDevice = (id: string, patch: Partial<PowerDevice>) =>
    persist(devices.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="klipper-tab">
      {showAdd && <AddDeviceModal onClose={() => setShowAdd(false)} onAdd={addDevice} />}

      <div className="klipper-tab-bar">
        <Zap size={15} />
        <h3>Power Devices</h3>
        <div className="spacer" />
        <button className="klipper-btn klipper-btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Add Device
        </button>
      </div>

      <div className="klipper-tab-body">
        {devices.length === 0 && (
          <div className="klipper-card">
            <div className="klipper-card-body" style={{ alignItems: 'center', padding: '24px 16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No power devices yet. Add a Tasmota or Shelly smart plug above.
            </div>
          </div>
        )}

        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onUpdate={(patch) => updateDevice(d.id, patch)}
            onRemove={() => removeDevice(d.id)}
          />
        ))}

        <div className="klipper-card">
          <div className="klipper-card-header"><Info size={13} style={{ display: 'inline', marginRight: 4 }} />Supported Devices</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              <strong>Tasmota</strong> — any Tasmota-flashed smart plug. Uses the built-in HTTP API.<br />
              <strong>Shelly Gen1</strong> — Shelly 1, Plug S, 2.5, etc. Uses REST relay API.<br />
              <strong>Shelly Gen2</strong> — Shelly Plus/Pro series. Uses the RPC API.<br />
              <strong>Generic HTTP</strong> — any device that accepts GET <code>/on</code> and <code>/off</code>.<br />
              <em>Note: the printer browser tab must be on the same local network as the plug, or a CORS proxy must be configured.</em>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

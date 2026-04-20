import { useMemo, useState } from 'react';
import {
  Wifi, WifiOff, Cable, Cpu, Globe, HardDrive,
  Server, RefreshCw, Save, Loader2, AlertTriangle, Lock,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import type { DuetNetworkInterface } from '../../types/duet';
import './DuetNetworkAndFirmware.css';

// Well-known protocol ↔ service mapping for the Duet object model.
// Values match what M586 exposes in `network.interfaces[].activeProtocols`.
const PROTOCOL_META: Record<string, { label: string; cmd: number; tls?: boolean }> = {
  http:    { label: 'HTTP',    cmd: 0 },
  ftp:     { label: 'FTP',     cmd: 1 },
  telnet:  { label: 'Telnet',  cmd: 2 },
  https:   { label: 'HTTPS',   cmd: 0, tls: true },
  mqtt:    { label: 'MQTT',    cmd: 3 },
};

export default function DuetNetworkAndFirmware() {
  const model = usePrinterStore((s) => s.model);
  const connected = usePrinterStore((s) => s.connected);
  const firmwareUpdatePending = usePrinterStore((s) => s.firmwareUpdatePending);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const board = model.boards?.[0];
  const network = model.network;
  const interfaces: DuetNetworkInterface[] = network?.interfaces ?? [];

  const [hostnameDraft, setHostnameDraft] = useState<string>(network?.hostname ?? '');
  const [ssidDraft, setSsidDraft] = useState<string>('');
  const [ssidPassword, setSsidPassword] = useState<string>('');
  const [busy, setBusy] = useState<'idle' | 'hostname' | 'wifi' | 'proto' | 'reboot'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  // Reset drafts when the model updates and no change is pending.
  const liveHostname = network?.hostname ?? '';
  const sameHostname = hostnameDraft === liveHostname;
  useMemo(() => { if (hostnameDraft === '' && liveHostname) setHostnameDraft(liveHostname); }, [liveHostname, hostnameDraft]);

  const applyHostname = async () => {
    if (!connected || !hostnameDraft || sameHostname) return;
    setMessage(null);
    try {
      setBusy('hostname');
      // M550 P<name>
      await sendGCode(`M550 P"${hostnameDraft.replace(/"/g, '')}"`);
      setMessage(`Hostname set to ${hostnameDraft}. A reboot (M999) is usually needed for it to take effect.`);
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  };

  const applyWifi = async () => {
    if (!connected || !ssidDraft) return;
    setMessage(null);
    try {
      setBusy('wifi');
      // M587 S"ssid" P"password" — stores the network. Users typically run
      // M552 S1 afterwards to enable the interface.
      const cmd = ssidPassword
        ? `M587 S"${ssidDraft.replace(/"/g, '')}" P"${ssidPassword.replace(/"/g, '')}"`
        : `M587 S"${ssidDraft.replace(/"/g, '')}"`;
      await sendGCode(cmd);
      setMessage(`Stored Wi-Fi credentials for "${ssidDraft}". Run "M552 S1" (or press Connect) to join.`);
      setSsidPassword('');
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  };

  const toggleProtocol = async (interfaceIdx: number, proto: string, enable: boolean) => {
    const meta = PROTOCOL_META[proto];
    if (!meta) return;
    try {
      setBusy('proto');
      // M586 I<interface> P<protocol> S0|1
      await sendGCode(`M586 I${interfaceIdx} P${meta.cmd} S${enable ? 1 : 0}`);
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  };

  const reboot = async () => {
    if (!connected) return;
    if (!confirm('Reboot the printer now? Any in-progress print will be cancelled.')) return;
    try {
      setBusy('reboot');
      await sendGCode('M999');
      setMessage('Reboot command sent.');
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="dnf">
      {/* -------- Firmware -------- */}
      <section className="dnf__section">
        <div className="dnf__section-header">
          <Cpu size={14} />
          <span>Firmware</span>
        </div>
        {!board ? (
          <div className="dnf__empty">Connect to a printer to see firmware details.</div>
        ) : (
          <>
            <div className="dnf__grid">
              <Row label="Board" value={board.name || board.shortName || '—'} />
              <Row label="Firmware" value={board.firmwareName || '—'} />
              <Row label="Version" value={board.firmwareVersion || '—'} />
              <Row label="Build date" value={board.firmwareDate || '—'} />
              {board.mcuTemp && (
                <Row label="MCU temp" value={`${board.mcuTemp.current.toFixed(1)} °C`} />
              )}
              {board.vIn && (
                <Row label="VIN" value={`${board.vIn.current.toFixed(1)} V`} />
              )}
            </div>
            {firmwareUpdatePending && (
              <div className="dnf__banner dnf__banner--warn">
                <AlertTriangle size={14} /> An update may have been staged already.
                Run <code>M997</code> from the console to apply when ready.
              </div>
            )}
            <div className="dnf__actions">
              <a
                className="dnf__btn"
                href="https://github.com/Duet3D/RepRapFirmware/releases"
                target="_blank"
                rel="noreferrer"
              >
                <Globe size={13} /> View release notes
              </a>
              <button
                className="dnf__btn dnf__btn--danger"
                onClick={reboot}
                disabled={!connected || busy !== 'idle'}
                title="Send M999 — resets the controller"
              >
                {busy === 'reboot' ? <Loader2 size={13} className="dnf__spin" /> : <RefreshCw size={13} />}
                Reboot printer
              </button>
            </div>
          </>
        )}
      </section>

      {/* -------- Hostname -------- */}
      <section className="dnf__section">
        <div className="dnf__section-header">
          <Server size={14} />
          <span>Hostname</span>
        </div>
        <div className="dnf__row-inline">
          <input
            type="text"
            value={hostnameDraft}
            onChange={(e) => setHostnameDraft(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
            placeholder="duet-printer"
            maxLength={40}
            disabled={!connected || busy !== 'idle'}
          />
          <button
            className="dnf__btn dnf__btn--primary"
            disabled={!connected || sameHostname || !hostnameDraft || busy !== 'idle'}
            onClick={applyHostname}
          >
            {busy === 'hostname' ? <Loader2 size={13} className="dnf__spin" /> : <Save size={13} />}
            Apply
          </button>
        </div>
        <div className="dnf__hint">Sent as <code>M550 P"…"</code>. Reboot afterwards for mDNS to register.</div>
      </section>

      {/* -------- Interfaces -------- */}
      <section className="dnf__section">
        <div className="dnf__section-header">
          {interfaces.some((i) => i.type === 'wifi') ? <Wifi size={14} /> : <Cable size={14} />}
          <span>Network interfaces</span>
        </div>
        {interfaces.length === 0 && (
          <div className="dnf__empty">No network info reported by the printer.</div>
        )}
        {interfaces.map((ifc, idx) => {
          const isWifi = ifc.type === 'wifi';
          const online = ifc.state !== 'disabled' && ifc.actualIP && ifc.actualIP !== '0.0.0.0';
          return (
            <div key={idx} className="dnf__iface">
              <div className="dnf__iface-head">
                <div className="dnf__iface-title">
                  {isWifi
                    ? (online ? <Wifi size={13} /> : <WifiOff size={13} />)
                    : <Cable size={13} />}
                  <span>{isWifi ? 'Wi-Fi' : 'Ethernet'} · {ifc.state}</span>
                </div>
                <div className="dnf__iface-ip">{ifc.actualIP || 'unassigned'}</div>
              </div>
              <div className="dnf__grid dnf__grid--compact">
                {isWifi && ifc.ssid && <Row label="SSID" value={ifc.ssid} />}
                {isWifi && ifc.signal !== undefined && <Row label="Signal" value={`${ifc.signal} dBm`} />}
                <Row label="Subnet" value={ifc.subnet || '—'} />
                <Row label="Gateway" value={ifc.gateway || '—'} />
                <Row label="MAC" value={ifc.mac || '—'} mono />
                <Row label="Speed" value={ifc.speed ? `${ifc.speed} Mbps` : '—'} />
              </div>
              <div className="dnf__subheader">Active protocols</div>
              <div className="dnf__proto-row">
                {Object.entries(PROTOCOL_META).map(([key, meta]) => {
                  const active = ifc.activeProtocols.includes(key);
                  return (
                    <button
                      key={key}
                      className={`dnf__proto${active ? ' is-active' : ''}`}
                      onClick={() => toggleProtocol(idx, key, !active)}
                      disabled={!connected || busy !== 'idle'}
                      title={`${active ? 'Disable' : 'Enable'} ${meta.label}`}
                    >
                      {meta.tls && <Lock size={10} />} {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* -------- Wi-Fi setup -------- */}
      {interfaces.some((i) => i.type === 'wifi') && (
        <section className="dnf__section">
          <div className="dnf__section-header">
            <HardDrive size={14} />
            <span>Save Wi-Fi network</span>
          </div>
          <div className="dnf__grid dnf__grid--form">
            <label>
              <span>SSID</span>
              <input
                type="text"
                value={ssidDraft}
                onChange={(e) => setSsidDraft(e.target.value)}
                placeholder="home-wifi"
                disabled={!connected || busy !== 'idle'}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={ssidPassword}
                onChange={(e) => setSsidPassword(e.target.value)}
                placeholder="(leave blank for open/stored)"
                disabled={!connected || busy !== 'idle'}
              />
            </label>
          </div>
          <div className="dnf__actions">
            <button
              className="dnf__btn dnf__btn--primary"
              disabled={!connected || !ssidDraft || busy !== 'idle'}
              onClick={applyWifi}
            >
              {busy === 'wifi' ? <Loader2 size={13} className="dnf__spin" /> : <Save size={13} />}
              Save credentials (M587)
            </button>
          </div>
          <div className="dnf__hint">Credentials are stored on the printer; run <code>M552 S1</code> to reconnect afterwards.</div>
        </section>
      )}

      {message && <div className="dnf__toast">{message}</div>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="dnf__row">
      <span className="dnf__row-label">{label}</span>
      <span className={`dnf__row-value${mono ? ' is-mono' : ''}`} title={value}>{value}</span>
    </div>
  );
}

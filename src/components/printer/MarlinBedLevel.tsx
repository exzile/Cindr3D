/**
 * MarlinBedLevel — bed levelling controls for Marlin firmware.
 *
 * Marlin does not expose the mesh data via a query endpoint, so we cannot
 * render a heat-map remotely. Instead this component provides:
 *   • G29 auto-level trigger
 *   • M420 save/restore
 *   • Z-offset adjustment
 *   • UBL (Unified Bed Levelling) helpers if available
 */
import { useState, useCallback } from 'react';
import { Grid3x3, Send, Info, RefreshCw } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import './KlipperTabs.css';

export default function MarlinBedLevel() {
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);
  const [sending, setSending] = useState(false);
  const [zOffset, setZOffset] = useState(0.0);
  const [lastCmd, setLastCmd] = useState<string | null>(null);

  const send = useCallback(async (...cmds: string[]) => {
    if (!connected) return;
    setSending(true);
    try {
      for (const cmd of cmds) {
        await sendGCode(cmd);
        setLastCmd(cmd);
      }
    } finally { setSending(false); }
  }, [connected, sendGCode]);

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Grid3x3 size={15} />
        <h3>Bed Levelling — Marlin</h3>
        {lastCmd && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
            Last: <code style={{ color: 'var(--accent)' }}>{lastCmd}</code>
          </span>
        )}
        <div className="spacer" />
      </div>

      <div className="klipper-tab-body">
        {/* Info */}
        <div className="klipper-card">
          <div className="klipper-card-header">
            <Info size={13} style={{ display: 'inline', marginRight: 4 }} />Marlin Bed Mesh
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Marlin does not expose mesh data via a queryable endpoint, so a graphical heat-map cannot be displayed.
              Use the controls below to run Auto Bed Levelling (G29) and save the result. For a visual mesh,
              consider switching to Klipper which provides a full mesh API.
            </p>
          </div>
        </div>

        {/* Auto Bed Levelling */}
        <div className="klipper-card">
          <div className="klipper-card-header">Auto Bed Levelling (G29)</div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              G29 probes the bed in a grid pattern and builds a compensation mesh. Home all axes first.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="klipper-btn klipper-btn-primary" onClick={() => send('G28')} disabled={!connected || sending}>
                <Send size={13} /> Home All (G28)
              </button>
              <button className="klipper-btn klipper-btn-primary" onClick={() => send('G29')} disabled={!connected || sending}>
                <RefreshCw size={13} /> Auto Level (G29)
              </button>
              <button className="klipper-btn" onClick={() => send('G29 T')} disabled={!connected || sending}
                title="Print the existing mesh to the console (G29 T)">
                <Send size={13} /> Print Mesh (G29 T)
              </button>
            </div>
          </div>
        </div>

        {/* Save / Restore mesh */}
        <div className="klipper-card">
          <div className="klipper-card-header">Save &amp; Restore Mesh (M420)</div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              M420 S1 enables bed levelling compensation. M500 saves the mesh to EEPROM so it persists across reboots.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="klipper-btn klipper-btn-primary" onClick={() => send('M420 S1')} disabled={!connected || sending}>
                <Send size={13} /> Enable Mesh (M420 S1)
              </button>
              <button className="klipper-btn" onClick={() => send('M420 S0')} disabled={!connected || sending}>
                <Send size={13} /> Disable Mesh (M420 S0)
              </button>
              <button className="klipper-btn" onClick={() => send('M500')} disabled={!connected || sending}>
                <Send size={13} /> Save to EEPROM (M500)
              </button>
            </div>
          </div>
        </div>

        {/* Z-offset */}
        <div className="klipper-card">
          <div className="klipper-card-header">Live Z-Offset (M851)</div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              M851 sets the probe Z-offset. Negative values bring the nozzle closer to the bed.
            </p>
            <div className="klipper-form-row">
              <label>Z offset (mm)</label>
              <input type="number" step={0.01} value={zOffset}
                onChange={(e) => setZOffset(parseFloat(e.target.value) || 0)}
                style={{ width: 90 }} />
              <button className="klipper-btn klipper-btn-primary"
                onClick={() => send(`M851 Z${zOffset.toFixed(2)}`, 'M500')}
                disabled={!connected || sending}>
                <Send size={13} /> Set &amp; Save
              </button>
            </div>
          </div>
        </div>

        {/* UBL section */}
        <div className="klipper-card">
          <div className="klipper-card-header">Unified Bed Levelling (UBL) — if enabled</div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              If your Marlin build has UBL enabled, use these commands:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="klipper-btn" onClick={() => send('G29 P1')} disabled={!connected || sending}>
                <Send size={13} /> Phase 1: Probe (G29 P1)
              </button>
              <button className="klipper-btn" onClick={() => send('G29 P3')} disabled={!connected || sending}>
                <Send size={13} /> Phase 3: Fill (G29 P3)
              </button>
              <button className="klipper-btn klipper-btn-primary" onClick={() => send('G29 S1')} disabled={!connected || sending}>
                <Send size={13} /> Save Mesh (G29 S1)
              </button>
              <button className="klipper-btn" onClick={() => send('G29 L1')} disabled={!connected || sending}>
                <Send size={13} /> Load Mesh (G29 L1)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

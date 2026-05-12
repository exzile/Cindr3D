// =============================================================================
// DuetPlugins — DSF / DWC plugin registry browser & installer.
//
// Lists everything under the board's `plugins` object-model key. Users can
// install a plugin ZIP (via M750), start/stop it (M751/M752) and attempt an
// uninstall (M753 — DSF only).
//
// Standalone boards do not run most plugins, but the `plugins` key still
// exists and returns an empty dict — we show a friendly "no plugins" state
// rather than an error in that case.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plug, Upload, Play, Square, Trash2, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import type { DuetPluginInfo } from '../../types/duet';

function isRunning(p: DuetPluginInfo): boolean {
  // DSF sets pid > 0 when a plugin is running; -1 / undefined means stopped.
  return typeof p.pid === 'number' && p.pid > 0;
}

export default function DuetPlugins() {
  const connected = usePrinterStore((s) => s.connected);
  const plugins = usePrinterStore((s) => s.plugins);
  const loading = usePrinterStore((s) => s.pluginsLoading);
  const refreshPlugins = usePrinterStore((s) => s.refreshPlugins);
  const installPlugin = usePrinterStore((s) => s.installPlugin);
  const startPlugin = usePrinterStore((s) => s.startPlugin);
  const stopPlugin = usePrinterStore((s) => s.stopPlugin);
  const uninstallPlugin = usePrinterStore((s) => s.uninstallPlugin);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Load plugins once on mount / when the connection comes up. Subsequent
  // refreshes are user-driven via the Refresh button so we don't spam the
  // board while the user is editing.
  useEffect(() => {
    if (connected) refreshPlugins();
  }, [connected, refreshPlugins]);

  const handleInstall = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await installPlugin(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [installPlugin]);

  const runAction = useCallback(
    async (id: string, fn: (id: string) => Promise<void>) => {
      setBusyId(id);
      try { await fn(id); } finally { setBusyId(null); }
    },
    [],
  );

  if (!connected) {
    return (
      <div style={styles.empty}>
        <Plug size={32} style={{ opacity: 0.4 }} />
        <div>Connect to a printer to manage plugins.</div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.title}>
          <Plug size={16} /> Plugins
          {plugins.length > 0 && <span style={styles.count}>{plugins.length}</span>}
        </div>
        <div style={styles.actions}>
          <button
            style={styles.btn}
            onClick={() => refreshPlugins()}
            disabled={loading}
            title="Refresh plugin list"
          >
            {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            style={{ ...styles.btn, ...styles.primary }}
            onClick={() => fileInputRef.current?.click()}
            title="Install a plugin ZIP on the board"
          >
            <Upload size={13} /> Install…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={handleInstall}
          />
        </div>
      </div>

      {plugins.length === 0 ? (
        <div style={styles.empty}>
          {loading ? (
            <><Loader2 size={20} className="spin" /><div>Loading plugins…</div></>
          ) : (
            <>
              <Plug size={32} style={{ opacity: 0.4 }} />
              <div>No plugins installed.</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Click <em>Install…</em> to upload a DSF / DWC plugin ZIP.
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={styles.list}>
          {plugins.map((p) => {
            const running = isRunning(p);
            const busy = busyId === p.id;
            return (
              <div key={p.id} style={styles.row}>
                <div style={styles.rowMain}>
                  <div style={styles.name}>
                    {p.name ?? p.id}
                    {p.version && <span style={styles.version}>v{p.version}</span>}
                    <span style={running ? styles.badgeRunning : styles.badgeStopped}>
                      {running ? 'running' : 'stopped'}
                    </span>
                  </div>
                  <div style={styles.meta}>
                    {p.author && <span>by {p.author}</span>}
                    {p.sbcRequired && <span style={styles.sbcTag}>SBC</span>}
                    {p.homepage && (
                      <a
                        href={p.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.homepage}
                      >
                        <ExternalLink size={11} /> homepage
                      </a>
                    )}
                  </div>
                </div>
                <div style={styles.rowActions}>
                  {running ? (
                    <button
                      style={styles.iconBtn}
                      onClick={() => runAction(p.id, stopPlugin)}
                      disabled={busy}
                      title="Stop plugin"
                    >
                      {busy ? <Loader2 size={13} className="spin" /> : <Square size={13} />}
                    </button>
                  ) : (
                    <button
                      style={styles.iconBtn}
                      onClick={() => runAction(p.id, startPlugin)}
                      disabled={busy}
                      title="Start plugin"
                    >
                      {busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                    </button>
                  )}
                  <button
                    style={{ ...styles.iconBtn, ...styles.danger }}
                    onClick={() => {
                      if (!window.confirm(`Uninstall "${p.name ?? p.id}"?`)) return;
                      runAction(p.id, uninstallPlugin);
                    }}
                    disabled={busy}
                    title="Uninstall plugin (DSF only)"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inline styles match the rest of the printer panel rather than adding a CSS
// file — other tabs (DuetStatus, DuetObjectModelBrowser) do the same.
const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid var(--panel-border, #333)',
  },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 },
  count: {
    background: 'var(--panel-border, #333)', padding: '1px 6px', borderRadius: 10,
    fontSize: 11, opacity: 0.8,
  },
  actions: { display: 'flex', gap: 6 },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
    background: 'transparent', color: 'inherit', border: '1px solid var(--panel-border, #333)',
    borderRadius: 4, fontSize: 12, cursor: 'pointer',
  },
  primary: { background: 'var(--accent, #2f80ed)', color: '#fff', borderColor: 'transparent' },
  list: { flex: 1, overflow: 'auto', padding: '8px 12px' },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    padding: '10px 12px', borderBottom: '1px solid var(--panel-border, #222)',
  },
  rowMain: { flex: 1, minWidth: 0 },
  name: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 },
  version: { fontSize: 11, opacity: 0.7 },
  badgeRunning: {
    background: '#14532d', color: '#86efac', fontSize: 10, padding: '1px 6px',
    borderRadius: 10, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  badgeStopped: {
    background: '#3f3f46', color: '#a1a1aa', fontSize: 10, padding: '1px 6px',
    borderRadius: 10, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  sbcTag: {
    background: '#1e3a8a', color: '#bfdbfe', fontSize: 10, padding: '1px 6px',
    borderRadius: 10,
  },
  meta: { display: 'flex', gap: 10, fontSize: 11, opacity: 0.75, marginTop: 4, alignItems: 'center' },
  homepage: { display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent, #2f80ed)' },
  rowActions: { display: 'flex', gap: 4 },
  iconBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, background: 'transparent', border: '1px solid var(--panel-border, #333)',
    borderRadius: 4, cursor: 'pointer', color: 'inherit',
  },
  danger: { color: '#f87171' },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center' as const,
    opacity: 0.85,
  },
};

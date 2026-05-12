/**
 * MarlinExcludeObject — Marlin mid-print object exclusion via M486.
 *
 * Marlin 2.0.9.2+ ships M486 when the build defines `CANCEL_OBJECTS`.
 * Unlike Duet, Marlin does NOT report a live object list back to the host —
 * we have to read the labels out of the G-code ourselves. We use the most
 * recently sliced job (`useSlicerStore().sliceResult.gcode`) when available,
 * and fall back to a manual "M486 P<n>" entry for SD-card prints.
 *
 * The "cancelled" set is tracked locally because Marlin doesn't report cancel
 * state — once you press cancel, we mark it cancelled in the UI and trust the
 * G-code stream did the rest.
 */
import { useMemo, useState } from 'react';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import {
  Layers, WifiOff, AlertCircle, XCircle, ArrowUpCircle, Send, Info,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { useSlicerStore } from '../../store/slicerStore';
import { parseM486Labels } from '../../services/gcode/m486Labels';
import './KlipperTabs.css';

/** First Marlin release that ships M486 cancellation in mainline. */
const M486_MIN_MARLIN: readonly [number, number, number] = [2, 0, 9];

function parseMarlinVersion(banner: string | undefined): [number, number, number] | null {
  if (!banner) return null;
  // Banners look like: "Marlin 2.1.2.4 (Github)" — sometimes prefixed by other tokens.
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(banner);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function meetsMinVersion(parsed: [number, number, number] | null, min: readonly [number, number, number]): boolean {
  if (!parsed) return false;
  for (let i = 0; i < 3; i++) {
    if (parsed[i] !== min[i]) return parsed[i] > min[i];
  }
  return true;
}

export default function MarlinExcludeObject() {
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);
  const sliceResult = useSlicerStore((s) => s.sliceResult);

  const [cancelled, setCancelled] = useState<Set<number>>(new Set());
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');

  const board = model.boards?.[0];
  const firmwareVersion = board?.firmwareVersion ?? board?.firmwareName;
  const parsedVersion = parseMarlinVersion(firmwareVersion);
  const meetsMin = meetsMinVersion(parsedVersion, M486_MIN_MARLIN);
  const versionUnknown = parsedVersion === null;
  // Best-effort send when the version is unparseable: button enabled for both
  // a known-good version and unknown, but disabled when we definitively know
  // the firmware is too old. Matches the user-facing copy.
  const supported = meetsMin || versionUnknown;

  const { labels, declaredCount } = useMemo(
    () => parseM486Labels(sliceResult?.gcode ?? ''),
    [sliceResult?.gcode],
  );

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Marlin printer to manage object exclusion.</span>
        </div>
      </div>
    );
  }

  const run = useAsyncAction(setBusy, setError, 'Failed to send M486');
  const sendCancel = async (id: number) => {
    if (!supported || cancelled.has(id)) return;
    await run(async () => {
      await sendGCode(`M486 P${id}`);
      setCancelled((prev) => new Set(prev).add(id));
      setConfirmIndex(null);
    });
  };

  const handleManualSend = () => {
    const id = Number(manualId);
    if (!Number.isFinite(id) || id < 0 || !Number.isInteger(id)) {
      setError('Object ID must be a non-negative integer');
      return;
    }
    setManualId('');
    void sendCancel(id);
  };

  const minVerStr = `${M486_MIN_MARLIN[0]}.${M486_MIN_MARLIN[1]}.${M486_MIN_MARLIN[2]}`;

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Layers size={15} />
        <h3>Exclude Object</h3>
        <span className="klipper-badge info" style={{ marginLeft: 4 }}>Marlin · M486</span>
        {firmwareVersion && (
          <span
            className={`klipper-badge ${meetsMin ? 'on' : versionUnknown ? 'warn' : 'error'}`}
            style={{ marginLeft: 4 }}
            title={firmwareVersion}
          >
            {firmwareVersion}
          </span>
        )}
        <div className="spacer" />
      </div>

      <div className="klipper-tab-body">
        {!supported && !versionUnknown && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-header">
              <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, color: '#ef4444' }} />
              Firmware too old for M486
            </div>
            <div className="klipper-card-body">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                Mid-print object cancellation requires <strong>Marlin {minVerStr}</strong> or newer
                with the <code>CANCEL_OBJECTS</code> build flag enabled. Your printer reports{' '}
                <strong>{firmwareVersion}</strong>, which does not implement <code>M486</code>.
                Cancel actions are disabled.
              </p>
              <button className="klipper-btn" onClick={() => setActiveTab('updates')}>
                <ArrowUpCircle size={13} /> Check for firmware updates
              </button>
            </div>
          </div>
        )}

        {versionUnknown && (
          <div className="klipper-card" style={{ borderColor: '#f59e0b' }}>
            <div className="klipper-card-body" style={{ flexDirection: 'row', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <span>
                Could not detect a Marlin version
                {firmwareVersion ? <> (reported <code>{firmwareVersion}</code>)</> : ''}.
                M486 will be sent anyway — the printer will reject cleanly if unsupported.
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="klipper-card" style={{ borderColor: '#ef4444' }}>
            <div className="klipper-card-body" style={{ color: '#ef4444', fontSize: 12 }}>
              {error}
            </div>
          </div>
        )}

        {labels.length > 0 ? (
          <div className="klipper-card">
            <div className="klipper-card-header">
              Objects in last sliced G-code &nbsp;
              <span className="klipper-badge info">{labels.length - cancelled.size} remaining</span>
              {cancelled.size > 0 && (
                <span className="klipper-badge error" style={{ marginLeft: 4 }}>{cancelled.size} cancelled</span>
              )}
              {declaredCount !== null && declaredCount !== labels.length && (
                <span className="klipper-badge warn" style={{ marginLeft: 4 }} title="The G-code declared a different object count via M486 T">
                  T={declaredCount} declared
                </span>
              )}
            </div>
            <div className="klipper-card-body">
              <div className="klipper-object-grid">
                {labels.map(({ id, name }) => {
                  const isCancelled = cancelled.has(id);
                  const display = name || `Object ${id}`;
                  const confirming = confirmIndex === id;
                  return (
                    <button
                      key={id}
                      className={`klipper-object-btn${isCancelled ? ' excluded' : ''}`}
                      onClick={() => {
                        if (isCancelled || busy || !supported) return;
                        if (confirming) void sendCancel(id);
                        else setConfirmIndex(id);
                      }}
                      title={
                        !supported
                          ? `Disabled — requires Marlin ${minVerStr}+`
                          : isCancelled
                            ? 'Cancelled'
                            : confirming
                              ? `Click again to confirm M486 P${id}`
                              : `Click to cancel "${display}"`
                      }
                      disabled={isCancelled || busy || !supported}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6 }}>#{id}</span>
                        {display}
                      </span>
                      {isCancelled && (
                        <span className="klipper-badge error" style={{ marginTop: 2 }}>Cancelled</span>
                      )}
                      {confirming && !isCancelled && (
                        <span className="klipper-badge warn" style={{ marginTop: 2 }}>
                          <XCircle size={10} style={{ marginRight: 2 }} /> Click to confirm
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                Marlin doesn't report which object is currently printing — the cancelled state above
                is tracked locally based on the M486 commands you've sent this session.
              </p>
            </div>
          </div>
        ) : (
          <div className="klipper-card">
            <div className="klipper-card-header">
              <Info size={13} style={{ display: 'inline', marginRight: 6 }} />
              No M486 labels found
            </div>
            <div className="klipper-card-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {sliceResult
                  ? 'The most recent slice did not contain any M486 labels. '
                  : 'No sliced G-code is loaded in Cindr3D. '}
                M486 needs object labels in the G-code itself — enable{' '}
                <strong>Label objects</strong> in PrusaSlicer / SuperSlicer / OrcaSlicer
                (Print Settings → Output) or run the <em>Label Objects</em> post-processing
                script in Cura 5.x, then re-slice.
              </p>
            </div>
          </div>
        )}

        {/* Manual entry — always available so SD-card prints can still be controlled. */}
        <div className="klipper-card">
          <div className="klipper-card-header">Send M486 manually</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Use this for SD-card prints or any G-code Cindr3D didn't slice. Enter the
              object ID printed in your slicer's preview, then click Send.
            </p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                step={1}
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="Object ID"
                disabled={!supported || busy}
                style={{
                  width: 100, padding: '4px 8px', fontSize: 13,
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', borderRadius: 4,
                }}
              />
              <button
                className="klipper-btn"
                onClick={handleManualSend}
                disabled={!supported || busy || manualId === ''}
              >
                <Send size={13} /> Send M486 P{manualId || '<id>'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * DuetExcludeObject — RRF mid-print object exclusion via M486.
 *
 * RepRapFirmware 3.5+ supports M486 object cancellation. The store's
 * `cancelObject(index)` already emits `M486 P<index>`; the live object list
 * comes from the Duet object model at `model.job.build.objects`.
 *
 * Slicer must emit object labels (PrusaSlicer/SuperSlicer/OrcaSlicer with
 * "Label objects" enabled, Cura 5.x with the Label Objects post-processor).
 */
import { useState } from 'react';
import { Layers, WifiOff, AlertCircle, XCircle, ArrowUpCircle } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import './KlipperTabs.css';

/** First RRF version to ship M486 object-cancellation support. */
const M486_MIN_RRF: readonly [number, number] = [3, 5];

/**
 * Parse the leading "major.minor" out of a firmware-version string.
 * Returns null when the input doesn't look like a version (e.g. "USB serial",
 * blank, or a non-RRF banner).
 */
function parseVersion(v: string | undefined): [number, number] | null {
  if (!v) return null;
  const m = /(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function meetsMinVersion(parsed: [number, number] | null, min: readonly [number, number]): boolean {
  if (!parsed) return false;
  if (parsed[0] !== min[0]) return parsed[0] > min[0];
  return parsed[1] >= min[1];
}

export default function DuetExcludeObject() {
  const connected = usePrinterStore((s) => s.connected);
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);
  const setActiveTab = usePrinterStore((s) => s.setActiveTab);

  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connected) {
    return (
      <div className="klipper-tab">
        <div className="klipper-disconnected">
          <WifiOff size={32} />
          <span>Connect to a Duet printer to manage object exclusion.</span>
        </div>
      </div>
    );
  }

  const board = model.boards?.[0];
  const firmwareVersion = board?.firmwareVersion;
  const firmwareName = board?.firmwareName ?? '';
  const parsedVersion = parseVersion(firmwareVersion);
  const meetsMin = meetsMinVersion(parsedVersion, M486_MIN_RRF);
  // Treat an unparseable banner as "unknown" — best-effort send rather than
  // hard-blocking, since some transports (USB serial seed) only report a free-form string.
  const versionUnknown = parsedVersion === null;
  // Buttons are enabled when the parsed version meets the minimum OR when
  // we can't tell. Only block when we definitively know the firmware is
  // too old. This matches the user-facing copy ("M486 will be sent anyway").
  const supported = meetsMin || versionUnknown;

  const objects = model.job?.build?.objects ?? [];
  const currentObject = model.job?.build?.currentObject ?? -1;
  const cancelledCount = objects.filter((o) => o.cancelled).length;
  const remainingCount = objects.length - cancelledCount;

  const handleCancel = async (index: number) => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      await cancelObject(index);
      setConfirmIndex(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send M486');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Layers size={15} />
        <h3>Exclude Object</h3>
        <span className="klipper-badge info" style={{ marginLeft: 4 }}>Duet · M486</span>
        {firmwareVersion && (
          <span
            className={`klipper-badge ${meetsMin ? 'on' : versionUnknown ? 'warn' : 'error'}`}
            style={{ marginLeft: 4 }}
            title={firmwareName ? `${firmwareName} ${firmwareVersion}` : firmwareVersion}
          >
            RRF {firmwareVersion}
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
                Mid-print object cancellation requires <strong>RepRapFirmware {M486_MIN_RRF[0]}.{M486_MIN_RRF[1]}</strong> or newer.
                Your printer reports <strong>{firmwareName || 'RepRapFirmware'} {firmwareVersion}</strong>,
                which does not implement <code>M486</code>. Cancel buttons are disabled to avoid
                sending an unrecognised G-code to your printer.
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
                Could not detect a RepRapFirmware version
                {firmwareVersion ? <> (reported <code>{firmwareVersion}</code>)</> : ''}.
                M486 will be sent anyway — your printer will reject it cleanly if unsupported.
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

        {objects.length === 0 ? (
          <div className="klipper-card">
            <div className="klipper-card-header">
              <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, color: '#f59e0b' }} />
              No labelled objects in this print
            </div>
            <div className="klipper-card-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                M486 needs object labels in your G-code. Enable <strong>Label objects</strong>
                {' '}in PrusaSlicer / SuperSlicer / OrcaSlicer (Print Settings → Output) or run
                {' '}the <em>Label Objects</em> post-processing script in Cura 5.x, then re-slice
                {' '}and start a print. Labelled objects will appear here automatically.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Requires RepRapFirmware 3.5 or newer.
              </p>
            </div>
          </div>
        ) : (
          <div className="klipper-card">
            <div className="klipper-card-header">
              Objects on plate &nbsp;
              <span className="klipper-badge info">{remainingCount} remaining</span>
              {cancelledCount > 0 && (
                <span className="klipper-badge error" style={{ marginLeft: 4 }}>{cancelledCount} cancelled</span>
              )}
            </div>
            <div className="klipper-card-body">
              <div className="klipper-object-grid">
                {objects.map((obj, i) => {
                  const isCurrent = i === currentObject;
                  const isCancelled = obj.cancelled;
                  const name = obj.name || `Object ${i}`;
                  const confirming = confirmIndex === i;
                  return (
                    <button
                      key={i}
                      className={`klipper-object-btn${isCancelled ? ' excluded' : ''}${isCurrent ? ' current' : ''}`}
                      onClick={() => {
                        if (isCancelled || busy || !supported) return;
                        if (confirming) void handleCancel(i);
                        else setConfirmIndex(i);
                      }}
                      title={
                        !supported
                          ? `Disabled — requires RRF ${M486_MIN_RRF[0]}.${M486_MIN_RRF[1]}+`
                          : isCancelled
                            ? 'Cancelled'
                            : confirming
                              ? `Click again to confirm M486 P${i}`
                              : `Click to cancel "${name}"`
                      }
                      disabled={isCancelled || busy || !supported}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6 }}>#{i}</span>
                        {name}
                      </span>
                      {isCurrent && !isCancelled && (
                        <span className="klipper-badge info" style={{ marginTop: 2 }}>Printing</span>
                      )}
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
                Click an object once to arm, again to send <code>M486 P&lt;n&gt;</code>. Cancellation cannot be undone mid-print.
                {confirmIndex !== null && (
                  <>
                    {' '}
                    <button
                      type="button"
                      onClick={() => setConfirmIndex(null)}
                      style={{
                        background: 'none', border: 'none', color: 'var(--accent)',
                        cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline',
                      }}
                    >
                      Clear armed selection
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

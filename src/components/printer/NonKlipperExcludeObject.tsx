/**
 * NonKlipperExcludeObject — fallback workaround UI.
 *
 * Klipper, Duet, and Marlin each have their own dedicated component now;
 * this one only renders for firmwares that genuinely have no M486 support
 * (Smoothieware, grbl, Repetier, "other"). It surfaces the detected firmware
 * version so the user can see exactly what was reported, and points them at
 * the pre-print Prepare workaround.
 */
import { Layers, AlertCircle, Info } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import './KlipperTabs.css';

interface FirmwareInfo {
  /** Display label for the firmware. */
  label: string;
  /** Short, version-aware note about why M486 isn't available here. */
  note: (version: string | undefined) => string;
}

/** Render the firmware version plus a trailing space, or "" if none. */
const ver = (v: string | undefined) => (v ? `${v} ` : '');

const FIRMWARE_INFO: Record<string, FirmwareInfo> = {
  smoothie: {
    label: 'Smoothieware',
    note: (v) =>
      `Smoothieware ${ver(v)}does not support mid-print object cancellation. The project is no longer actively developed for FDM. Consider migrating to Klipper or Marlin if you need M486-style cancellation.`,
  },
  grbl: {
    label: 'grbl',
    note: (v) =>
      `grbl ${ver(v)}is a CNC firmware and has no concept of FDM print objects. M486 is not part of the grbl command set.`,
  },
  repetier: {
    label: 'Repetier',
    note: (v) =>
      `Repetier-Firmware ${ver(v)}does not implement M486 in any released mainline version. A handful of community forks have added it, but Cindr3D cannot rely on that being present. The pre-print workaround below is the most reliable option.`,
  },
  other: {
    label: 'Unknown firmware',
    note: (v) =>
      `Your firmware ${v ? `(${v}) ` : ''}may not support mid-print object cancellation. Check your firmware's docs for an M486 equivalent — if it exists, change the board type in Settings to the matching firmware to unlock the dedicated UI.`,
  },
  // Defensive fallbacks: these firmwares have dedicated components, but if
  // someone lands here through a misconfig, we still tell them where to go.
  duet: {
    label: 'Duet',
    note: () =>
      'RepRapFirmware 3.5+ supports M486. Set the board type to "Duet" in Settings to use the dedicated Exclude Object UI.',
  },
  marlin: {
    label: 'Marlin',
    note: () =>
      'Marlin 2.0.9+ supports M486 (when built with CANCEL_OBJECTS). Set the board type to "Marlin" in Settings to use the dedicated Exclude Object UI.',
  },
};

export default function NonKlipperExcludeObject() {
  const boardType = usePrinterStore((s) => s.config.boardType ?? 'other');
  const model = usePrinterStore((s) => s.model);
  const firmwareVersion = model.boards?.[0]?.firmwareVersion;

  const info = FIRMWARE_INFO[boardType] ?? FIRMWARE_INFO.other;

  return (
    <div className="klipper-tab">
      <div className="klipper-tab-bar">
        <Layers size={15} />
        <h3>Exclude Object</h3>
        <span className="klipper-badge info" style={{ marginLeft: 4 }}>{info.label}</span>
        {firmwareVersion && (
          <span
            className="klipper-badge off"
            style={{ marginLeft: 4 }}
            title={`Firmware version reported by your printer: ${firmwareVersion}`}
          >
            {firmwareVersion}
          </span>
        )}
        <div className="spacer" />
      </div>

      <div className="klipper-tab-body">
        {/* Why this firmware can't do mid-print exclusion */}
        <div className="klipper-card" style={{ borderColor: '#f59e0b' }}>
          <div className="klipper-card-header">
            <AlertCircle size={13} style={{ display: 'inline', marginRight: 6, color: '#f59e0b' }} />
            Mid-print exclusion not available
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {info.note(firmwareVersion)}
            </p>
          </div>
        </div>

        {/* Pre-print workaround */}
        <div className="klipper-card">
          <div className="klipper-card-header">
            <Info size={13} style={{ display: 'inline', marginRight: 4 }} />
            Pre-Print Workaround
          </div>
          <div className="klipper-card-body">
            <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6 }}>
              The most reliable way to exclude objects before printing is to remove them from your model
              in the <strong>Prepare</strong> workspace before slicing:
            </p>
            <div className="klipper-step">
              <div className="klipper-step-num">1</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Open the Prepare workspace</div>
                <div className="klipper-step-desc">
                  Close this printer panel and switch to the Prepare tab in the main toolbar.
                  Your model bodies appear in the build plate viewport.
                </div>
              </div>
            </div>
            <div className="klipper-step">
              <div className="klipper-step-num">2</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Delete or hide the bodies you want to skip</div>
                <div className="klipper-step-desc">
                  Select a body on the build plate and press Delete, or toggle its visibility in the body list.
                  Only visible bodies are included in the sliced G-code.
                </div>
              </div>
            </div>
            <div className="klipper-step">
              <div className="klipper-step-num">3</div>
              <div className="klipper-step-body">
                <div className="klipper-step-title">Re-slice and upload</div>
                <div className="klipper-step-desc">
                  Click Slice in the Prepare workspace, then upload the new G-code to your printer.
                  The excluded body will not appear in this print.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Migration nudge */}
        <div className="klipper-card">
          <div className="klipper-card-header">Want real mid-print cancellation?</div>
          <div className="klipper-card-body">
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Cindr3D currently supports mid-print object exclusion on:
              <br />
              <strong>Klipper</strong> (via <code>EXCLUDE_OBJECT</code>),{' '}
              <strong>Duet RRF 3.5+</strong> (via <code>M486</code>), and{' '}
              <strong>Marlin 2.0.9+</strong> (via <code>M486</code>, requires <code>CANCEL_OBJECTS</code> in the firmware build).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

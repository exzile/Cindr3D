import { useState, useEffect } from 'react';
import { AudioLines, HardDrive, Save, Trash2, Zap } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { useStepperTuningStore, type StepperMode, type StepperPreset } from '../../../store/stepperTuningStore';
import {
  buildStepperTuningCommands,
  buildStepperWiggleCommands,
  parseStepperConfigFromGCode,
} from '../../../services/integrations/stepperTuning';

const DEFAULT_AXIS_LETTERS = ['X', 'Y', 'Z', 'E'];
const MICROSTEP_OPTIONS    = [8, 16, 32, 64, 128, 256];
const EMPTY_PRESETS: StepperPreset[] = [];
const MODES: { value: StepperMode; label: string }[] = [
  { value: 'stealthchop', label: 'StealthChop' },
  { value: 'spreadcycle', label: 'SpreadCycle' },
];

interface MotorEntry {
  storeKey:      string;
  label:         string;
  commandLetter: string;
  driverIndex:   number;
  kind:          'axis' | 'extruder';
  filament?:     string;
}

function parseDriverIndex(driver: string): number {
  const parts = driver.split('.');
  return parseInt(parts[parts.length - 1] ?? '0', 10);
}

export default function StepperTuningPanel() {
  const model           = usePrinterStore((s) => s.model);
  const config          = usePrinterStore((s) => s.config);
  const connected       = usePrinterStore((s) => s.connected);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const service         = usePrinterStore((s) => s.service);
  const sendGCode       = usePrinterStore((s) => s.sendGCode);
  const getAxisTuning    = useStepperTuningStore((s) => s.getAxisTuning);
  const updateAxisTuning = useStepperTuningStore((s) => s.updateAxisTuning);
  const seedAxisTuning   = useStepperTuningStore((s) => s.seedAxisTuning);
  const savePreset  = useStepperTuningStore((s) => s.savePreset);
  const applyPreset = useStepperTuningStore((s) => s.applyPreset);
  const removePreset = useStepperTuningStore((s) => s.removePreset);
  // Selector must not inline `?? []` — new array reference on every render causes
  // an infinite Zustand re-render loop.
  const presets = useStepperTuningStore((s) => activePrinterId ? s.presets[activePrinterId] : null) ?? EMPTY_PRESETS;
  const [presetName, setPresetName]     = useState('Quiet ABS');
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  const firmwareSaveCmd = config.boardType === 'klipper' ? 'SAVE_CONFIG' : 'M500';

  function handleSavePresetOnly() {
    savePreset(activePrinterId!, presetName);
    setShowSaveMenu(false);
  }

  async function handleSaveWithFirmware() {
    savePreset(activePrinterId!, presetName);
    await sendGCode(firmwareSaveCmd);
    setShowSaveMenu(false);
  }

  // Seed tuning values from config.g once per printer connection.
  // Only writes axes that have no persisted data yet — user edits are preserved.
  useEffect(() => {
    if (!activePrinterId || !connected || !service) return;
    let cancelled = false;

    void (async () => {
      try {
        const blob = await service.downloadFile('0:/sys/config.g');
        if (cancelled) return;
        const text = await blob.text();
        const parsed = parseStepperConfigFromGCode(text);

        // Expand the generic 'E' entry to each numbered extruder key (E0, E1 …)
        // so the extruder section of the card picks up real values too.
        const eBase = parsed['E'];
        if (eBase) {
          const extruderCount = model.move?.extruders?.length ?? 0;
          for (let i = 0; i < extruderCount; i++) {
            const key = `E${i}`;
            if (!parsed[key]) parsed[key] = { ...eBase };
          }
        }

        seedAxisTuning(activePrinterId, parsed);
      } catch {
        // config.g unavailable (Klipper, Marlin, serial setups) — silently skip
      }
    })();

    return () => { cancelled = true; };
  // Re-seed when the active printer or connection changes (new printer connected).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePrinterId, connected]);

  // Extruder motor entries — built first so axis list can skip 'E' if there are real extruders
  const extruderEntries: MotorEntry[] = (model.move?.extruders ?? []).map((ext, i) => ({
    storeKey:      `E${i}`,
    label:         `E${i}`,
    commandLetter: 'E',
    driverIndex:   parseDriverIndex(ext.driver),
    kind:          'extruder',
    filament:      ext.filament || undefined,
  }));

  // Axis motor entries — drop the generic 'E' fallback when real extruder entries exist
  const axisEntries: MotorEntry[] = model.move?.axes?.length
    ? model.move.axes.map((axis, i) => ({
        storeKey:      axis.letter.toUpperCase(),
        label:         axis.letter.toUpperCase(),
        commandLetter: axis.letter.toUpperCase(),
        driverIndex:   axis.drives?.[0] ?? i,
        kind:          'axis' as const,
      }))
    : DEFAULT_AXIS_LETTERS
        .filter((l) => l !== 'E' || extruderEntries.length === 0)
        .map((letter, i) => ({
          storeKey:      letter,
          label:         letter,
          commandLetter: letter,
          driverIndex:   i,
          kind:          'axis' as const,
        }));

  const hasBothSections = axisEntries.length > 0 && extruderEntries.length > 0;

  const sendCommands = async (cmds: string[]) => {
    for (const cmd of cmds) await sendGCode(cmd);
  };

  const renderMotor = (entry: MotorEntry) => {
    const tuning    = getAxisTuning(activePrinterId, entry.storeKey, entry.driverIndex);
    const isKlipper = config.boardType === 'klipper';

    return (
      <div
        key={entry.storeKey}
        className="st-axis"
        data-axis={entry.label}
        data-kind={entry.kind}
      >
        {/* ── head ── */}
        <div className="st-axis__head">
          <div
            className="st-axis__badge"
            title={entry.kind === 'extruder'
              ? `Extruder motor ${entry.label} — driver ${tuning.driverIndex}`
              : `${entry.label}-axis motor — driver ${tuning.driverIndex}`}
          >
            {entry.label}
          </div>
          <div className="st-axis__meta">
            {entry.filament && (
              <span className="st-filament-tag" title={`Loaded filament: ${entry.filament}`}>
                {entry.filament}
              </span>
            )}
            <span
              className="st-drv-label"
              title="Driver index used in M569 P commands (RRF) or stepper name (Klipper)"
            >
              DRV
            </span>
            <input
              type="number"
              className="st-driver-input"
              value={tuning.driverIndex}
              title="Driver number — must match the physical port on your board"
              onChange={(e) => updateAxisTuning(activePrinterId!, entry.storeKey, { driverIndex: Number(e.target.value) })}
            />
          </div>
        </div>

        {/* ── current mA ── */}
        <label
          className="st-field"
          title="Peak motor current in milliamps (M906). Too high = heat & skipped steps; too low = weak torque."
        >
          <span>Current mA</span>
          <input
            type="number"
            value={tuning.currentMa}
            onChange={(e) => updateAxisTuning(activePrinterId!, entry.storeKey, { currentMa: Number(e.target.value) })}
          />
        </label>

        {/* ── microsteps ── */}
        <label
          className={`st-field${isKlipper ? ' is-locked' : ''}`}
          title={isKlipper
            ? 'Microsteps are defined in printer.cfg and cannot be changed at runtime on Klipper'
            : 'Microstep resolution (M350). Higher = smoother motion; steps/mm must be adjusted proportionally.'}
        >
          <span>Microsteps{isKlipper && <em> (cfg)</em>}</span>
          <select
            value={tuning.microsteps}
            disabled={isKlipper}
            onChange={(e) => updateAxisTuning(activePrinterId!, entry.storeKey, { microsteps: Number(e.target.value) })}
          >
            {MICROSTEP_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>

        {/* ── mode pills ── */}
        <div className="st-field st-field--full">
          <span title="Chopper mode determines how the driver synthesises current waveforms">Mode</span>
          <div className="st-mode-row">
            <button
              key="stealthchop"
              type="button"
              className={`st-mode-pill st-mode-pill--stealthchop${tuning.mode === 'stealthchop' ? ' is-active' : ''}`}
              title="StealthChop — ultra-quiet voltage-mode PWM. Best for slow to medium speeds. May reduce torque at high speeds."
              onClick={() => updateAxisTuning(activePrinterId!, entry.storeKey, { mode: 'stealthchop' })}
            >
              StealthChop
            </button>
            <button
              key="spreadcycle"
              type="button"
              className={`st-mode-pill st-mode-pill--spreadcycle${tuning.mode === 'spreadcycle' ? ' is-active' : ''}`}
              title="SpreadCycle — precise current-mode chopper. Better torque at high speeds; audibly louder."
              onClick={() => updateAxisTuning(activePrinterId!, entry.storeKey, { mode: 'spreadcycle' })}
            >
              SpreadCycle
            </button>
          </div>
        </div>

        {/* ── actions ── */}
        <div className="st-actions">
          <button
            type="button"
            className="st-btn st-btn--apply"
            disabled={!connected}
            title={`Send current, microstep, and mode commands to the ${entry.label} driver (M906 / M350 / M569)`}
            onClick={() => void sendCommands(
              buildStepperTuningCommands(config.boardType, entry.commandLetter, { ...tuning, driverIndex: entry.driverIndex }),
            )}
          >
            <Zap size={12} /> Apply
          </button>
          <button
            type="button"
            className="st-btn st-btn--wiggle"
            disabled={!connected}
            title={`Jog the ${entry.label} axis ±1 mm to verify motor connection and direction`}
            onClick={() => void sendCommands(buildStepperWiggleCommands(entry.commandLetter))}
          >
            <AudioLines size={12} /> Wiggle
          </button>
        </div>
      </div>
    );
  };

  if (!activePrinterId) {
    return <div className="st-empty">Connect a printer before tuning stepper drivers.</div>;
  }

  return (
    <div className="st-panel">

      {/* Preset save bar */}
      <div className="st-preset-bar">
        <input
          className="st-name-input"
          value={presetName}
          placeholder="Preset name…"
          title="Name for this tuning preset"
          onChange={(e) => setPresetName(e.target.value)}
        />

        {/* Save button + dropdown menu */}
        <div className="st-save-wrap">
          {/* Invisible backdrop — closes menu when clicking anywhere outside */}
          {showSaveMenu && (
            <div className="st-save-overlay" onClick={() => setShowSaveMenu(false)} />
          )}

          <button
            type="button"
            className={`st-save-btn${showSaveMenu ? ' is-open' : ''}`}
            title="Choose how to save these settings"
            onClick={() => setShowSaveMenu((v) => !v)}
          >
            <Save size={12} /> Save
          </button>

          {showSaveMenu && (
            <div className="st-save-menu">
              <button
                type="button"
                className="st-save-menu__item"
                title="Save settings as a local preset — recalled from this app only"
                onClick={handleSavePresetOnly}
              >
                <Save size={12} />
                <span>
                  <strong>Local preset</strong>
                  <em>Recall from this app — not written to the printer</em>
                </span>
              </button>
              <button
                type="button"
                className="st-save-menu__item"
                title={`Save preset and send ${firmwareSaveCmd} so settings survive a printer reboot`}
                onClick={() => void handleSaveWithFirmware()}
              >
                <HardDrive size={12} />
                <span>
                  <strong>Preset + write to firmware</strong>
                  <em>Saves preset and sends {firmwareSaveCmd} to persist on the printer</em>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Saved preset chips */}
      {presets.length > 0 && (
        <div className="st-preset-row">
          {presets.map((preset) => (
            <span key={preset.id} className="st-preset">
              <button
                type="button"
                title={`Apply preset "${preset.name}" to all motors`}
                onClick={() => applyPreset(activePrinterId, preset.id)}
              >
                {preset.name}
              </button>
              <button
                type="button"
                title={`Delete preset "${preset.name}"`}
                onClick={() => removePreset(activePrinterId, preset.id)}
              >
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Axis motors */}
      {hasBothSections && <div className="st-section-label">Axis Motors</div>}
      <div className="st-grid">{axisEntries.map(renderMotor)}</div>

      {/* Extruder motors */}
      {extruderEntries.length > 0 && (
        <>
          <div className="st-section-label">Extruder Motors</div>
          <div className="st-grid">{extruderEntries.map(renderMotor)}</div>
        </>
      )}

    </div>
  );
}

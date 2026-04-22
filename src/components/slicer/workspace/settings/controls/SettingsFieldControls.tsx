import { Cpu, AlertCircle, HelpCircle } from 'lucide-react';
import { clamp, parseIntOr, parseNumberOr } from '../helpers/numberParsing';
import './SettingsFieldControls.css';

// Machine-sourced fields come from the printer's config.g (RRF) or equivalent.
// We still show the machine badge (Cpu icon) so the user recognises the source,
// and disable the input so edits only happen on the board + a resync.
const LOCK_TOOLTIP = 'Value synced from the printer. Edit on the board (config.g) and use "Sync from Duet" in the Printer Manager.';

function MachineLock() {
  return (
    <span className="slicer-settings-field__machine-lock" title={LOCK_TOOLTIP}>
      <Cpu size={10} />
    </span>
  );
}

function FirmwareIncompatible({ reason }: { reason: string }) {
  return (
    <span className="slicer-settings-field__firmware-incompatible" title={reason}>
      <AlertCircle size={10} />
    </span>
  );
}

function HelpIcon({
  brief,
  onClick,
}: {
  brief: string;
  onClick: () => void;
}) {
  return (
    <button
      className="slicer-settings-field__help-icon"
      title={brief}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      type="button"
      aria-label="Show help"
    >
      <HelpCircle size={10} />
    </button>
  );
}

export function Num({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  unit,
  machineSourced,
  firmwareUnsupported,
  helpBrief,
  onShowHelp,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  machineSourced?: boolean;
  firmwareUnsupported?: string | null;
  helpBrief?: string;
  onShowHelp?: () => void;
}) {
  const disabled = machineSourced || !!firmwareUnsupported;
  const title = firmwareUnsupported ?? (machineSourced ? LOCK_TOOLTIP : undefined);
  const classes = [
    'slicer-settings-field',
    machineSourced && 'slicer-settings-field--locked',
    firmwareUnsupported && 'slicer-settings-field--firmware-unsupported',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} title={title}>
      <div className="slicer-settings-field__label">
        {helpBrief && onShowHelp && <HelpIcon brief={helpBrief} onClick={onShowHelp} />}
        {label}
        {machineSourced && <MachineLock />}
        {firmwareUnsupported && <FirmwareIncompatible reason={firmwareUnsupported} />}
      </div>
      <div className="slicer-settings-field__input-wrap">
        <input
          type="number"
          className="slicer-settings-field__input"
          value={value}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          readOnly={disabled}
          onChange={(e) => {
            if (disabled) return;
            const next = clamp(parseNumberOr(e.target.value, min), min, max);
            if (next !== value) onChange(next);
          }}
        />
        <span className="slicer-settings-field__unit">{unit ?? ''}</span>
      </div>
    </div>
  );
}

export function Check({
  label,
  value,
  onChange,
  machineSourced,
  firmwareUnsupported,
  helpBrief,
  onShowHelp,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  machineSourced?: boolean;
  firmwareUnsupported?: string | null;
  helpBrief?: string;
  onShowHelp?: () => void;
}) {
  const disabled = machineSourced || !!firmwareUnsupported;
  const title = firmwareUnsupported ?? (machineSourced ? LOCK_TOOLTIP : undefined);
  const classes = [
    'slicer-settings-field__check',
    machineSourced && 'slicer-settings-field__check--locked',
    firmwareUnsupported && 'slicer-settings-field__check--firmware-unsupported',
  ].filter(Boolean).join(' ');

  return (
    <label className={classes} title={title}>
      {helpBrief && onShowHelp && <HelpIcon brief={helpBrief} onClick={onShowHelp} />}
      <input
        className="slicer-settings-field__check-input"
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => {
          if (disabled) return;
          const next = e.target.checked;
          if (next !== value) onChange(next);
        }}
      />
      {label}
      {machineSourced && <MachineLock />}
      {firmwareUnsupported && <FirmwareIncompatible reason={firmwareUnsupported} />}
    </label>
  );
}

export function Sel<T extends string>({
  label,
  value,
  onChange,
  options,
  firmwareUnsupported,
  helpBrief,
  onShowHelp,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  firmwareUnsupported?: string | null;
  helpBrief?: string;
  onShowHelp?: () => void;
}) {
  const classes = [
    'slicer-settings-field',
    firmwareUnsupported && 'slicer-settings-field--firmware-unsupported',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} title={firmwareUnsupported ?? undefined}>
      <div className="slicer-settings-field__label">
        {helpBrief && onShowHelp && <HelpIcon brief={helpBrief} onClick={onShowHelp} />}
        {label}
        {firmwareUnsupported && <FirmwareIncompatible reason={firmwareUnsupported} />}
      </div>
      <select
        className="slicer-settings-field__select"
        value={value}
        disabled={!!firmwareUnsupported}
        onChange={(e) => {
          if (firmwareUnsupported) return;
          const next = e.target.value as T;
          if (next !== value) onChange(next);
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Density({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="slicer-settings-field">
      <div className="slicer-settings-field__label">Density</div>
      <div className="slicer-settings-field__density-row">
        <input
          className="slicer-settings-field__range"
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => {
            const next = clamp(parseIntOr(e.target.value, 0), 0, 100);
            if (next !== value) onChange(next);
          }}
        />
        <input
          type="number"
          className="slicer-settings-field__input slicer-settings-field__input--density"
          value={value}
          min={0}
          max={100}
          onChange={(e) => {
            const next = clamp(parseIntOr(e.target.value, 0), 0, 100);
            if (next !== value) onChange(next);
          }}
        />
        <span className="slicer-settings-field__unit">%</span>
      </div>
    </div>
  );
}

export function SectionDivider({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div className={`slicer-settings-field__divider${icon ? ' slicer-settings-field__divider--icon' : ''}`}>
      {icon && <span className="slicer-settings-field__divider-icon">{icon}</span>}
      {label}
    </div>
  );
}

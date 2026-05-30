import { useState, type CSSProperties } from "react";
import { clamp, selectNumberText } from "./numberUtils";

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  fallback: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
  labelStyle?: CSSProperties;
  inputStyle?: CSSProperties;
}

// Permits the empty string, a lone "-", a lone ".", and partial decimals like
// "0.", ".25", "-.5", "12.5" — i.e. every intermediate state while typing a number.
const PARTIAL_NUMBER = /^-?\d*\.?\d*$/;

/**
 * Decimal-friendly numeric field. Uses a local "draft" buffer (not a controlled
 * `type=number`) so the user can type intermediate values like ".25", "0.", or
 * "0" without the field snapping back to the fallback mid-keystroke. While not
 * editing, the field simply renders the live numeric `value` (so external updates
 * — gizmo drag, mode switch — are reflected with no effect/state sync). A valid,
 * in-range number is emitted on every keystroke; on blur the buffer is dropped and
 * the field reverts to the clamped numeric value (empty/partial → `fallback`).
 */
export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  fallback,
  title,
  className = "form-group",
  style,
  labelStyle,
  inputStyle,
}: NumberInputProps) {
  // null = not editing → show the controlled `value`; string = active edit buffer.
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  return (
    <div className={className} style={style}>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        inputMode="decimal"
        style={inputStyle}
        value={display}
        onFocus={(e) => {
          setDraft(String(value));
          selectNumberText(e);
        }}
        onClick={selectNumberText}
        onChange={(e) => {
          const next = e.target.value;
          // Reject anything that isn't a (partial) decimal so letters/symbols can't
          // land in the field; allow every valid intermediate.
          if (next !== "" && !PARTIAL_NUMBER.test(next)) return;
          setDraft(next);
          const parsed = parseFloat(next);
          // Emit only when the buffer is a real number — staying silent on ""/"."
          // keeps the live value stable while the user is mid-entry.
          if (!Number.isNaN(parsed)) onChange(clamp(parsed, min, max));
        }}
        onBlur={() => {
          const parsed = parseFloat(draft ?? "");
          const finalValue = clamp(Number.isNaN(parsed) ? fallback : parsed, min, max);
          onChange(finalValue);
          setDraft(null); // revert to the controlled (now-normalised) value
        }}
        // step is retained for API compatibility; with type=text the browser has no
        // spinner, so it's informational only.
        data-step={step}
        title={title}
      />
    </div>
  );
}

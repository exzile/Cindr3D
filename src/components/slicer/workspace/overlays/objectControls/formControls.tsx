import type { ReactNode } from 'react';

export function NumberInput({
  val,
  onChange,
  disabled = false,
  narrow = false,
}: {
  val: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  narrow?: boolean;
}) {
  return (
    <input
      type="number"
      disabled={disabled}
      className={`slicer-overlay-number-input${narrow ? ' slicer-overlay-number-input--narrow' : ''}`}
      value={val}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function CheckRow({
  label,
  checked,
  onClick,
}: {
  label: ReactNode;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <label
      className="slicer-overlay-check-row"
      onClick={(event) => { event.preventDefault(); onClick(); }}
    >
      <input type="checkbox" checked={checked} onChange={onClick} className="slicer-overlay-check-input" />
      {label}
    </label>
  );
}

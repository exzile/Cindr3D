import type { CSSProperties } from 'react';
import { colors, sharedStyles } from '../../utils/theme';

const inputStyle = sharedStyles.input;
const selectStyle = sharedStyles.select;
const labelStyle = sharedStyles.label;

export function Num({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
      <div style={labelStyle}>{label}{unit ? ` (${unit})` : ''}</div>
      <input
        type="number"
        style={inputStyle}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || min)}
      />
    </div>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: colors.accent }} />
      {label}
    </label>
  );
}

export function Sel<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
      <div style={labelStyle}>{label}</div>
      <select style={selectStyle} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Density({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
      <div style={labelStyle}>Density ({value}%)</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          style={{ flex: 1, accentColor: colors.accent }}
        />
        <input
          type="number"
          style={{ ...inputStyle, width: 48 }}
          value={value}
          min={0}
          max={100}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        />
      </div>
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  const style: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: colors.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    borderBottom: `1px solid ${colors.panelBorder}`,
    paddingBottom: 3,
    marginBottom: 8,
    marginTop: 4,
  };
  return <div style={style}>{label}</div>;
}

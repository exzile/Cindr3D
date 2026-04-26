/* eslint-disable react-refresh/only-export-components */
import type React from 'react';
import { Cpu } from 'lucide-react';
import { colors, sharedStyles } from '../../../../../utils/theme';

export const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 0 };
export const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, marginBottom: 4 };

const LOCK_TOOLTIP = 'Value synced from the printer. Edit on the board (config.g) and use "Sync from Duet".';

export function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ flex: 1, fontSize: 12, color: colors.text }}>{children}</div>;
}

export function MachineLockIcon() {
  return (
    <span
      title={LOCK_TOOLTIP}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 4,
        color: colors.accent,
        opacity: 0.85,
        cursor: 'help',
        flexShrink: 0,
      }}
    >
      <Cpu size={10} />
    </span>
  );
}

export function NumIn({ value, onChange, step = 1, min, max, suffix, width = 80, locked }: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; suffix?: string; width?: number; locked?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }} title={locked ? LOCK_TOOLTIP : undefined}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={locked}
        readOnly={locked}
        onChange={(e) => { if (locked) return; onChange(parseFloat(e.target.value) || 0); }}
        style={{
          ...sharedStyles.input,
          width,
          textAlign: 'right',
          borderRadius: suffix ? '4px 0 0 4px' : 4,
          borderRight: suffix ? 'none' : undefined,
          opacity: locked ? 0.55 : 1,
          cursor: locked ? 'not-allowed' : undefined,
        }}
      />
      {suffix && (
        <div
          style={{
            padding: '0 7px',
            fontSize: 11,
            color: colors.textDim,
            background: colors.panelLight,
            border: `1px solid ${colors.panelBorder}`,
            borderLeft: 'none',
            borderRadius: '0 4px 4px 0',
            height: 24,
            display: 'flex',
            alignItems: 'center',
            opacity: locked ? 0.55 : 1,
          }}
        >
          {suffix}
        </div>
      )}
    </div>
  );
}

export function SelIn<T extends string>({ value, onChange, options, width = 180, locked }: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[]; width?: number; locked?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={locked}
      onChange={(e) => { if (locked) return; onChange(e.target.value as T); }}
      title={locked ? LOCK_TOOLTIP : undefined}
      style={{ ...sharedStyles.select, width, opacity: locked ? 0.55 : 1, cursor: locked ? 'not-allowed' : undefined }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Chk({ checked, onChange, label, locked }: { checked: boolean; onChange: (v: boolean) => void; label: string; locked?: boolean }) {
  return (
    <label title={locked ? LOCK_TOOLTIP : undefined} style={{ ...row, cursor: locked ? 'not-allowed' : 'pointer', gap: 7, marginBottom: 2, opacity: locked ? 0.55 : 1 }}>
      <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => { if (locked) return; onChange(e.target.checked); }} style={{ accentColor: colors.accent }} />
      <span style={{ fontSize: 12, color: colors.text, display: 'flex', alignItems: 'center' }}>{label}{locked && <MachineLockIcon />}</span>
    </label>
  );
}

export function Lbl2({ locked, children }: { locked?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, fontSize: 12, color: colors.text, display: 'flex', alignItems: 'center' }}>
      {children}{locked && <MachineLockIcon />}
    </div>
  );
}

export function GCode({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...sharedStyles.input,
          flex: 1,
          minHeight: 140,
          fontFamily: 'monospace',
          fontSize: 11,
          resize: 'none',
          lineHeight: 1.5,
        }}
      />
    </div>
  );
}

export function ColHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 10 }}>{children}</div>;
}

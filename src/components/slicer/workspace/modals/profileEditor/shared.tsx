/* eslint-disable react-refresh/only-export-components */
import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { Cpu } from 'lucide-react';
import { colors, sharedStyles } from '../../../../../utils/theme';

export const LOCK_TITLE = 'Value synced from the printer. Edit on the board (config.g) and use "Sync from Duet" in the Printer Manager.';

export const btnAccent = sharedStyles.btnAccent;
export const inputStyle = sharedStyles.input;
export const selectStyle = sharedStyles.select;
export const labelStyle = sharedStyles.label;

export const fieldRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  marginBottom: 10,
};

export function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '8px 16px',
    background: active ? colors.panelLight : 'transparent',
    color: active ? colors.text : colors.textDim,
    border: 'none',
    borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  };
}

export function MachineLockBadge({ title = LOCK_TITLE }: { title?: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 4,
        color: colors.accent,
        opacity: 0.85,
        verticalAlign: 'middle',
        flexShrink: 0,
        cursor: 'help',
      }}
    >
      <Cpu size={10} />
    </span>
  );
}

export function lockedInputProps(locked: boolean): InputHTMLAttributes<HTMLInputElement> {
  if (!locked) return {};
  return {
    disabled: true,
    readOnly: true,
    title: LOCK_TITLE,
    style: { opacity: 0.55, cursor: 'not-allowed' },
  };
}

export function TabBar({
  tabs,
  activeTab,
  setActiveTab,
  wrap = false,
}: {
  tabs: string[];
  activeTab: number;
  setActiveTab: (tab: number) => void;
  wrap?: boolean;
}) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${colors.panelBorder}`, flexWrap: wrap ? 'wrap' : 'nowrap' }}>
      {tabs.map((tab, index) => (
        <button key={tab} style={tabStyle(activeTab === index)} onClick={() => setActiveTab(index)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

export function SectionBody({ children }: { children: ReactNode }) {
  return <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>;
}

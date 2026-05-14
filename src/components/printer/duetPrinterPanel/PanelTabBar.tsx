/**
 * PanelTabBar — desktop horizontal tab strip across the top of the
 * printer panel. Tabs are filtered by board type (e.g. Klipper-only
 * tabs hide on a Duet board).
 */
import { colors as COLORS } from '../../../utils/theme';
import type { PrinterBoardType } from '../../../types/duet';
import type { TabKey } from './config';
import { movePrinterTabFocus, visiblePrinterTabs } from './tabHelpers';

export interface PanelTabBarProps {
  activeTab: string;
  boardType: PrinterBoardType;
  onTabChange: (tab: TabKey) => void;
}

export function PanelTabBar({ activeTab, boardType, onTabChange }: PanelTabBarProps) {
  const visibleTabs = visiblePrinterTabs(boardType);

  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        background: COLORS.panel,
        borderBottom: `1px solid ${COLORS.panelBorder}`,
        flexShrink: 0,
        overflowX: 'auto',
      }}
      role="tablist"
      aria-label="Printer sections"
    >
      {visibleTabs.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '8px 12px',
            background: 'none',
            border: 'none',
            borderBottomWidth: 2,
            borderBottomStyle: 'solid',
            borderBottomColor: activeTab === key ? COLORS.accent : 'transparent',
            color: activeTab === key ? COLORS.accent : COLORS.textDim,
            cursor: 'pointer',
            fontSize: 12,
            whiteSpace: 'nowrap',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onClick={() => onTabChange(key)}
          onKeyDown={(event) => movePrinterTabFocus(event, visibleTabs, key, onTabChange)}
          title={label}
          role="tab"
          aria-selected={activeTab === key}
          tabIndex={activeTab === key ? 0 : -1}
          data-printer-tab={key}
        >
          <Icon size={14} />
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

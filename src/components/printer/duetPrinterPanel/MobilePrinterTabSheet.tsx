/**
 * MobilePrinterTabSheet — bottom sheet variant of the panel tab strip
 * for narrow viewports. Shares the visible-tabs filter + keyboard
 * navigation with the desktop PanelTabBar.
 */
import type { PrinterBoardType } from '../../../types/duet';
import type { TabKey } from './config';
import { movePrinterTabFocus, visiblePrinterTabs } from './tabHelpers';

export interface MobilePrinterTabSheetProps {
  activeTab: string;
  boardType: PrinterBoardType;
  onTabChange: (tab: TabKey) => void;
}

export function MobilePrinterTabSheet({ activeTab, boardType, onTabChange }: MobilePrinterTabSheetProps) {
  const visibleTabs = visiblePrinterTabs(boardType);

  return (
    <nav className="printer-mobile-tabs" aria-label="Printer sections">
      {visibleTabs.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`printer-mobile-tabs__item${activeTab === key ? ' is-active' : ''}`}
          onClick={() => onTabChange(key)}
          onKeyDown={(event) => movePrinterTabFocus(event, visibleTabs, key, onTabChange)}
          title={label}
          aria-current={activeTab === key ? 'page' : undefined}
          data-printer-tab={key}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

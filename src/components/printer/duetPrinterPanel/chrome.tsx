import React from 'react';
import {
  Activity,
  Clock,
  Cpu,
  Home,
  Loader2,
  Moon,
  OctagonAlert,
  Pause,
  Play,
  Power,
  Search,
  Settings,
  Square,
  Sun,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { formatUptime } from '../dashboard/helpers';
import { colors as COLORS } from '../../../utils/theme';
import { TABS, KLIPPER_ONLY_TABS, DUET_ONLY_TABS, type TabKey } from './config';
import type { PrinterBoardType } from '../../../types/duet';

const BOARD_LABELS: Record<PrinterBoardType, string> = {
  duet: 'Duet3D Control',
  klipper: 'Klipper Control',
  marlin: 'Marlin Control',
  smoothie: 'Smoothieware Control',
  grbl: 'grbl Control',
  repetier: 'Repetier Control',
  other: 'Printer Control',
};

type SearchResult = {
  label: string;
  tab: TabKey;
  type: string;
};

type HeaderProps = {
  boardType: PrinterBoardType;
  connected: boolean;
  hostname?: string;
  theme: string;
  globalSearch: string;
  showSearchResults: boolean;
  searchResults: SearchResult[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onResultSelect: (tab: TabKey) => void;
  onToggleTheme: () => void;
  onEmergencyStop: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

export function PanelHeader({
  boardType,
  connected,
  hostname,
  theme,
  globalSearch,
  showSearchResults,
  searchResults,
  searchInputRef,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onResultSelect,
  onToggleTheme,
  onEmergencyStop,
  onOpenSettings,
  onClose,
}: HeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: COLORS.panel,
        borderBottom: `1px solid ${COLORS.panelBorder}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          background: connected ? COLORS.success : COLORS.danger,
        }}
        title={connected ? 'Connected' : 'Disconnected'}
      />
      {!connected && (
        <button
          style={{
            background: 'none',
            border: `1px solid ${COLORS.success}`,
            color: COLORS.success,
            cursor: 'pointer',
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 600,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 6,
          }}
          onClick={onOpenSettings}
          title="Connect to printer"
        >
          <Wifi size={12} /> Connect
        </button>
      )}
      <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', marginRight: 4 }}>{BOARD_LABELS[boardType]}</span>
      {connected && hostname && (
        <span
          style={{
            color: COLORS.textDim,
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }}
          title={hostname}
        >
          {hostname}
        </span>
      )}
      <div style={{ flex: 1 }} />

      <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: COLORS.inputBg,
            border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: 4,
            padding: '2px 6px',
          }}
        >
          <Search size={12} style={{ color: COLORS.textDim, flexShrink: 0 }} />
          <input
            ref={searchInputRef}
            type="text"
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
            placeholder="Search..."
            style={{
              border: 'none',
              background: 'transparent',
              color: COLORS.text,
              fontSize: 11,
              outline: 'none',
              width: 100,
              padding: '2px 0',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {showSearchResults && searchResults.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: COLORS.panel,
              border: `1px solid ${COLORS.panelBorder}`,
              borderRadius: 4,
              maxHeight: 240,
              overflowY: 'auto',
              zIndex: 1100,
              minWidth: 220,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            {searchResults.map((r, i) => (
              <div
                key={`${r.tab}-${r.label}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  borderBottom: `1px solid ${COLORS.panelBorder}`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onResultSelect(r.tab);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = COLORS.inputBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ color: COLORS.accent, fontWeight: 600, fontSize: 10, minWidth: 50 }}>{r.type}</span>
                <span style={{ color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        style={headerIconButton}
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <button
        style={{
          background: COLORS.danger,
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: '4px 10px',
          borderRadius: 4,
          fontWeight: 700,
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          letterSpacing: 0.5,
        }}
        onClick={onEmergencyStop}
        title="Emergency Stop (M112)"
      >
        <OctagonAlert size={14} /> E-STOP
      </button>

      <button style={headerIconButton} onClick={onOpenSettings} title="Settings">
        <Settings size={16} />
      </button>

      <button style={headerIconButton} onClick={onClose} title="Close panel">
        <X size={16} />
      </button>
    </div>
  );
}

export function PanelTabBar({
  activeTab,
  boardType,
  onTabChange,
}: {
  activeTab: string;
  boardType: PrinterBoardType;
  onTabChange: (tab: TabKey) => void;
}) {
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

function visiblePrinterTabs(boardType: PrinterBoardType) {
  return TABS.filter(({ key }) => {
    if (KLIPPER_ONLY_TABS.has(key) && boardType !== 'klipper') return false;
    if (DUET_ONLY_TABS.has(key) && boardType === 'klipper') return false;
    return true;
  });
}

function movePrinterTabFocus(
  event: React.KeyboardEvent<HTMLButtonElement>,
  visibleTabs: ReturnType<typeof visiblePrinterTabs>,
  activeKey: TabKey,
  onTabChange: (tab: TabKey) => void,
): void {
  const index = visibleTabs.findIndex(({ key }) => key === activeKey);
  if (index < 0) return;
  let nextIndex = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % visibleTabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = visibleTabs.length - 1;
  else return;

  event.preventDefault();
  const nextTab = visibleTabs[nextIndex];
  onTabChange(nextTab.key);
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-printer-tab="${nextTab.key}"]`)?.focus();
  });
}

export function MobilePrinterTabSheet({
  activeTab,
  boardType,
  onTabChange,
}: {
  activeTab: string;
  boardType: PrinterBoardType;
  onTabChange: (tab: TabKey) => void;
}) {
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

export function PanelBanners({
  boardType,
  error,
  connected,
  reconnecting,
  hasStaleModel,
  lastUpdatedText,
  onOpenSettings,
}: {
  boardType: PrinterBoardType;
  error: string | null;
  connected: boolean;
  reconnecting: boolean;
  hasStaleModel: boolean;
  lastUpdatedText: string | null;
  onOpenSettings: () => void;
}) {
  return (
    <>
      {error && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(239,68,68,0.15)',
            color: COLORS.danger,
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.panelBorder}`,
          }}
        >
          {error}
        </div>
      )}

      {!connected && reconnecting && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            background: 'rgba(234,179,8,0.12)',
            borderBottom: `1px solid ${COLORS.panelBorder}`,
            color: COLORS.warning,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <Loader2 size={14} className="spin" />
          <span>Reconnecting to printer...</span>
        </div>
      )}

      {!connected && !reconnecting && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: 'rgba(239,68,68,0.08)',
            borderBottom: `1px solid ${COLORS.panelBorder}`,
            color: COLORS.textDim,
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <WifiOff size={14} color={COLORS.danger} />
          <span>
            {hasStaleModel
              ? `Disconnected - showing last known values (updated ${lastUpdatedText}).`
              : `Not connected to ${boardType === 'duet' ? 'a Duet3D board' : 'printer'}.`}
          </span>
          <div style={{ flex: 1 }} />
          <button
            style={{
              background: COLORS.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 12px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            onClick={onOpenSettings}
          >
            <Wifi size={12} /> Connect
          </button>
        </div>
      )}
    </>
  );
}

export function PanelFooter({
  connected,
  machineStatus,
  currentTool,
  upTime,
  board,
  onResetHalt,
  onHome,
  onMotorsOff,
  onPause,
  onResume,
  onCancel,
  isPrinting,
  isPaused,
  printProgress,
}: {
  connected: boolean;
  machineStatus: string;
  currentTool: string;
  upTime: number;
  board?: {
    firmwareName?: string;
    firmwareVersion?: string;
    name?: string;
    shortName?: string;
  };
  onResetHalt: () => void;
  onHome: () => void;
  onMotorsOff: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  isPrinting: boolean;
  isPaused: boolean;
  printProgress: number | null;
}) {
  const isActivePrint = isPrinting || isPaused
    || machineStatus === 'pausing' || machineStatus === 'resuming' || machineStatus === 'cancelling';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: COLORS.panel,
        borderTop: `1px solid ${COLORS.panelBorder}`,
        fontSize: 11,
        color: COLORS.textDim,
        flexShrink: 0,
      }}
    >
      {/* ── Left: status + meta ── */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Activity size={11} style={{ color: machineStatus === 'halted' ? COLORS.danger : connected ? COLORS.success : COLORS.textDim }} />
        <span style={{ fontWeight: 600, textTransform: 'capitalize', color: machineStatus === 'halted' ? COLORS.danger : connected ? COLORS.success : COLORS.textDim }}>
          {machineStatus}
        </span>
        {machineStatus === 'halted' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onResetHalt(); }}
            title="Send M999 to clear halt and resume"
            className="printer-reset-halt"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 20,
              padding: '0 8px',
              border: `1px solid ${COLORS.danger}`,
              borderRadius: 4,
              background: 'transparent',
              color: COLORS.danger,
              font: 'inherit',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            Reset (M999)
          </button>
        )}
      </span>
      <span style={{ color: COLORS.panelBorder }}>|</span>
      <span>Tool: {currentTool}</span>
      {upTime > 0 && (
        <>
          <span style={{ color: COLORS.panelBorder }}>|</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} /> {formatUptime(upTime)}
          </span>
        </>
      )}
      {board && (
        <>
          <span style={{ color: COLORS.panelBorder }}>|</span>
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            title={`${board.firmwareName ?? ''} ${board.firmwareVersion ?? ''}`.trim()}
          >
            <Cpu size={10} />
            <span>{board.name || board.shortName}</span>
            {board.firmwareVersion && (
              <span style={{ color: COLORS.textDim }}>· {board.firmwareVersion}</span>
            )}
          </span>
        </>
      )}

      {/* ── Right: quick actions + progress ── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {connected && !isActivePrint && (
          <>
            <button
              type="button"
              className="printer-footer-btn"
              onClick={onHome}
              title="Home all axes (G28)"
            >
              <Home size={11} />
              Home
            </button>
            <button
              type="button"
              className="printer-footer-btn"
              onClick={onMotorsOff}
              title="Disable stepper motors (M84)"
            >
              <Power size={11} />
              Motors Off
            </button>
          </>
        )}

        {connected && isActivePrint && (
          <>
            <button
              type="button"
              className={`printer-footer-btn printer-footer-btn--pause${isPaused ? ' is-active' : ''}`}
              onClick={isPaused ? onResume : onPause}
              disabled={machineStatus === 'pausing' || machineStatus === 'resuming'}
              title={isPaused ? 'Resume print' : 'Pause print'}
            >
              {isPaused ? <Play size={11} /> : <Pause size={11} />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="printer-footer-btn printer-footer-btn--cancel"
              onClick={onCancel}
              disabled={machineStatus === 'cancelling'}
              title="Cancel current print"
            >
              <Square size={11} />
              Cancel
            </button>
          </>
        )}

        {printProgress !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 80,
                height: 6,
                background: COLORS.inputBg,
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: COLORS.accent,
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                  width: `${printProgress.toFixed(1)}%`,
                }}
              />
            </div>
            <span>{printProgress.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

const headerIconButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: COLORS.textDim,
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

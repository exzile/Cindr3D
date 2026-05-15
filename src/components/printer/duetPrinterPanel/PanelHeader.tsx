/**
 * PanelHeader — top strip of the printer panel: connection dot + connect
 * button, board label + hostname, global search field with results
 * dropdown, theme toggle, emergency-stop, settings, and close icons.
 */
import React from 'react';
import {
  Moon, OctagonAlert, Search, Settings, Sun, Wifi, X,
} from 'lucide-react';
import { colors as COLORS } from '../../../utils/theme';
import type { PrinterBoardType } from '../../../types/duet';
import type { TabKey } from './config';

const BOARD_LABELS: Record<PrinterBoardType, string> = {
  duet: 'Duet3D Control',
  klipper: 'Klipper Control',
  marlin: 'Marlin Control',
  smoothie: 'Smoothieware Control',
  grbl: 'grbl Control',
  repetier: 'Repetier Control',
  other: 'Printer Control',
};

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

export type PanelHeaderSearchResult = {
  label: string;
  tab: TabKey;
  type: string;
};

export interface PanelHeaderProps {
  boardType: PrinterBoardType;
  connected: boolean;
  hostname?: string;
  theme: string;
  globalSearch: string;
  showSearchResults: boolean;
  searchResults: PanelHeaderSearchResult[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onResultSelect: (tab: TabKey) => void;
  onToggleTheme: () => void;
  onEmergencyStop: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function PanelHeader({
  boardType, connected, hostname, theme,
  globalSearch, showSearchResults, searchResults, searchInputRef,
  onSearchChange, onSearchFocus, onSearchBlur, onResultSelect,
  onToggleTheme, onEmergencyStop, onOpenSettings, onClose,
}: PanelHeaderProps) {
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

/**
 * PanelBanners — stacked status banners between the tab bar and the
 * active tab content: error message, reconnect spinner, and the
 * disconnected-with-stale-data warning + connect button.
 */
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { colors as COLORS } from '../../../utils/theme';
import type { PrinterBoardType } from '../../../types/duet';

export interface PanelBannersProps {
  boardType: PrinterBoardType;
  error: string | null;
  connected: boolean;
  reconnecting: boolean;
  hasStaleModel: boolean;
  lastUpdatedText: string | null;
  onOpenSettings: () => void;
}

export function PanelBanners({
  boardType, error, connected, reconnecting,
  hasStaleModel, lastUpdatedText, onOpenSettings,
}: PanelBannersProps) {
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

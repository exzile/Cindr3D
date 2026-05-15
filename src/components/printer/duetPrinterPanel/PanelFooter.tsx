/**
 * PanelFooter — status strip across the bottom of the panel: machine
 * status + reset-halt button (when halted), current tool, uptime,
 * board chip/firmware, plus right-side quick-action buttons (Home /
 * Motors-off when idle, Pause/Resume + Cancel when a print is active)
 * and the print-progress bar.
 */
import { Activity, Clock, Cpu, Home, Pause, Play, Power, Square } from 'lucide-react';
import { formatUptime } from '../dashboard/helpers';
import { colors as COLORS } from '../../../utils/theme';

export interface PanelFooterProps {
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
}

export function PanelFooter({
  connected, machineStatus, currentTool, upTime, board,
  onResetHalt, onHome, onMotorsOff, onPause, onResume, onCancel,
  isPrinting, isPaused, printProgress,
}: PanelFooterProps) {
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

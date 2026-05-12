import { ArrowUpToLine, Copy, Loader2, MessageSquare, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { QUICK_COMMANDS } from './config';

export function ConsoleToolbar({
  autoFollowTop,
  connected,
  liveLogPaused,
  loadingPrinterLog,
  verbose,
  onClear,
  onCopyAll,
  onLoadPrinterLog,
  onQuickCommand,
  onToggleAutoFollowTop,
  onToggleLiveLog,
  onToggleVerbose,
}: {
  autoFollowTop: boolean;
  connected: boolean;
  liveLogPaused: boolean;
  loadingPrinterLog: boolean;
  verbose: boolean;
  onClear: () => void;
  onCopyAll: () => void;
  onLoadPrinterLog: () => void;
  onQuickCommand: (gcode: string) => void;
  onToggleAutoFollowTop: () => void;
  onToggleLiveLog: () => void;
  onToggleVerbose: () => void;
}) {
  return (
    <div className="duet-console__toolbar">
      <div className="duet-console__quick-buttons">
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd.gcode}
            className={`duet-console__quick-btn${cmd.variant === 'danger' ? ' duet-console__quick-btn--danger' : ''}`}
            onClick={() => onQuickCommand(cmd.gcode)}
            disabled={!connected}
            title={cmd.label}
          >
            {cmd.icon}
            <span className="duet-console__quick-btn-label">{cmd.gcode}</span>
          </button>
        ))}
      </div>
      <div className="duet-console__toolbar-right">
        <button
          className={`duet-console__filter-toggle${verbose ? ' is-active' : ''}`}
          onClick={onToggleVerbose}
          disabled={!connected}
          title={verbose ? 'Verbose mode ON - click to send M111 S0' : 'Verbose mode OFF - click to send M111 S1'}
        >
          <MessageSquare size={12} />
          <span>{verbose ? 'Verbose' : 'Quiet'}</span>
        </button>
        <button
          className="duet-console__clear-btn"
          onClick={onLoadPrinterLog}
          disabled={!connected || loadingPrinterLog}
          title="Pull printer log file"
        >
          {loadingPrinterLog ? <Loader2 size={14} className="duet-console__spin" /> : <RefreshCw size={14} />}
          <span>Pull Log</span>
        </button>
        <button
          className={`duet-console__clear-btn${liveLogPaused ? ' is-paused' : ' is-live'}`}
          onClick={onToggleLiveLog}
          disabled={!connected}
          title={liveLogPaused ? 'Resume live log polling' : 'Pause live log polling'}
        >
          {liveLogPaused ? <Play size={14} /> : <Pause size={14} />}
          <span>{liveLogPaused ? 'Resume' : 'Pause'}</span>
        </button>
        <button
          className={`duet-console__clear-btn${autoFollowTop ? ' is-following' : ''}`}
          onClick={onToggleAutoFollowTop}
          title={autoFollowTop ? 'Auto-scroll to newest logs is on' : 'Auto-scroll to newest logs is off'}
        >
          <ArrowUpToLine size={14} />
          <span>{autoFollowTop ? 'Top On' : 'Top Off'}</span>
        </button>
        <button
          className="duet-console__clear-btn"
          onClick={onCopyAll}
          title="Copy All to Clipboard"
        >
          <Copy size={14} />
          <span>Copy</span>
        </button>
        <button
          className="duet-console__clear-btn"
          onClick={onClear}
          title="Clear Console"
        >
          <Trash2 size={14} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
}

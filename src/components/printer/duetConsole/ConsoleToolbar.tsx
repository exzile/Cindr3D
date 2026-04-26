import { Copy, MessageSquare, Trash2 } from 'lucide-react';
import { QUICK_COMMANDS } from './config';

export function ConsoleToolbar({
  connected,
  verbose,
  onClear,
  onCopyAll,
  onQuickCommand,
  onToggleVerbose,
}: {
  connected: boolean;
  verbose: boolean;
  onClear: () => void;
  onCopyAll: () => void;
  onQuickCommand: (gcode: string) => void;
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

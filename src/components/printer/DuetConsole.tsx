import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './DuetConsole.css';
import {
  Send,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Home,
  Crosshair,
  Settings,
  Cpu,
  Info,
  Copy,
  ArrowDown,
  Filter,
  Search,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { formatTimeOfDay } from '../../utils/printerFormat';

const QUICK_COMMANDS: {
  label: string;
  gcode: string;
  icon: React.ReactNode;
  variant?: 'danger';
}[] = [
  { label: 'M112 Emergency Stop', gcode: 'M112', icon: <AlertTriangle size={14} />, variant: 'danger' },
  { label: 'M999 Reset', gcode: 'M999', icon: <RotateCcw size={14} /> },
  { label: 'G28 Home All', gcode: 'G28', icon: <Home size={14} /> },
  { label: 'M114 Position', gcode: 'M114', icon: <Crosshair size={14} /> },
  { label: 'M503 Settings', gcode: 'M503', icon: <Settings size={14} /> },
  { label: 'M122 Diagnostics', gcode: 'M122', icon: <Cpu size={14} /> },
  { label: 'M115 Firmware', gcode: 'M115', icon: <Info size={14} /> },
];

const TYPE_COLORS: Record<string, string> = {
  command: '#22d3ee',
  response: '#d4d4d8',
  warning: '#facc15',
  error: '#f87171',
};

// --- G-code autocomplete data ---
const GCODE_SUGGESTIONS: { code: string; description: string }[] = [
  { code: 'G0', description: 'Rapid move' },
  { code: 'G1', description: 'Linear move' },
  { code: 'G28', description: 'Home all axes' },
  { code: 'G29', description: 'Probe bed' },
  { code: 'G10', description: 'Set offsets / retract' },
  { code: 'G32', description: 'Probe Z / bed leveling' },
  { code: 'G90', description: 'Absolute positioning' },
  { code: 'G91', description: 'Relative positioning' },
  { code: 'M0', description: 'Stop and wait' },
  { code: 'M24', description: 'Resume print' },
  { code: 'M25', description: 'Pause print' },
  { code: 'M80', description: 'ATX power on' },
  { code: 'M81', description: 'ATX power off' },
  { code: 'M104', description: 'Set hotend temp' },
  { code: 'M106', description: 'Set fan speed' },
  { code: 'M112', description: 'Emergency stop' },
  { code: 'M114', description: 'Report position' },
  { code: 'M115', description: 'Firmware info' },
  { code: 'M119', description: 'Endstop status' },
  { code: 'M122', description: 'Diagnostics' },
  { code: 'M140', description: 'Set bed temp' },
  { code: 'M141', description: 'Set chamber temp' },
  { code: 'M220', description: 'Set speed factor' },
  { code: 'M221', description: 'Set flow factor' },
  { code: 'M290', description: 'Baby stepping' },
  { code: 'M291', description: 'Display message' },
  { code: 'M292', description: 'Acknowledge message' },
  { code: 'M486', description: 'Object cancel' },
  { code: 'M500', description: 'Save settings' },
  { code: 'M503', description: 'Report settings' },
  { code: 'M552', description: 'Network config' },
  { code: 'M997', description: 'Update firmware' },
  { code: 'M999', description: 'Reset controller' },
];

type FilterType = 'all' | 'command' | 'response' | 'warning' | 'error';

const TEMP_REPORT_PATTERN = /\b(ok\s+)?(T\d*:\s*[\d.]+|B:\s*[\d.]+)/i;

function formatTime(date: Date): string {
  return formatTimeOfDay(date);
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  // Match digits against code numbers: "28" matches "G28"
  const digits = q.replace(/[^0-9]/g, '');
  if (digits && t.replace(/[^0-9]/g, '').includes(digits)) return true;
  return false;
}

function highlightText(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="duet-console__search-highlight">
        {text.slice(idx, idx + search.length)}
      </span>
      {text.slice(idx + search.length)}
    </>
  );
}

export default function DuetConsole() {
  const consoleHistory = usePrinterStore((s) => s.consoleHistory);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);

  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Filter state
  const [hideTemps, setHideTemps] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');

  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // Scroll state
  const [isAtBottom, setIsAtBottom] = useState(true);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Filtered console entries
  const filteredEntries = useMemo(() => {
    return consoleHistory.filter((entry) => {
      if (hideTemps && TEMP_REPORT_PATTERN.test(entry.content)) return false;
      if (filterType !== 'all' && entry.type !== filterType) return false;
      if (searchText && !entry.content.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [consoleHistory, hideTemps, searchText, filterType]);

  // Autocomplete suggestions
  const suggestions = useMemo(() => {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed || trimmed.includes(' ')) return [];
    return GCODE_SUGGESTIONS.filter(
      (s) => fuzzyMatch(trimmed, s.code) || fuzzyMatch(trimmed, s.description),
    ).slice(0, 8);
  }, [input]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setIsAtBottom(atBottom);
  }, []);

  // Auto-scroll to bottom when new entries arrive (only if already at bottom)
  useEffect(() => {
    const el = outputRef.current;
    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [consoleHistory.length, isAtBottom]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Show/hide suggestions when input changes
  useEffect(() => {
    if (suggestions.length > 0 && input.trim().length > 0) {
      setShowSuggestions(true);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
    }
  }, [suggestions, input]);

  const scrollToBottom = useCallback(() => {
    const el = outputRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setIsAtBottom(true);
    }
  }, []);

  const handleSend = useCallback(() => {
    const cmd = input.trim();
    if (!cmd) return;

    sendGCode(cmd);
    setCommandHistory((prev) => {
      const filtered = prev.filter((c) => c !== cmd);
      return [...filtered, cmd];
    });
    setHistoryIndex(-1);
    setInput('');
    setShowSuggestions(false);
  }, [input, sendGCode]);

  const selectSuggestion = useCallback(
    (code: string) => {
      setInput(code + ' ');
      setShowSuggestions(false);
      inputRef.current?.focus();
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Autocomplete navigation
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0)) {
          e.preventDefault();
          selectSuggestion(suggestions[selectedSuggestion].code);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSuggestions(false);
          return;
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length === 0) return;
        const nextIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex === -1) return;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(nextIndex);
          setInput(commandHistory[nextIndex]);
        }
      }
    },
    [handleSend, commandHistory, historyIndex, showSuggestions, suggestions, selectedSuggestion, selectSuggestion],
  );

  const handleClear = useCallback(() => {
    usePrinterStore.setState({ consoleHistory: [] });
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = filteredEntries
      .map(
        (entry, i) =>
          `${String(i + 1).padStart(4, ' ')} [${formatTime(entry.timestamp)}] ${entry.type === 'command' ? '> ' : ''}${entry.content}`,
      )
      .join('\n');
    navigator.clipboard.writeText(text);
  }, [filteredEntries]);

  const handleQuickCommand = useCallback(
    (gcode: string) => {
      sendGCode(gcode);
    },
    [sendGCode],
  );

  return (
    <div className="duet-console">
      {/* Quick command buttons */}
      <div className="duet-console__toolbar">
        <div className="duet-console__quick-buttons">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd.gcode}
              className={`duet-console__quick-btn${cmd.variant === 'danger' ? ' duet-console__quick-btn--danger' : ''}`}
              onClick={() => handleQuickCommand(cmd.gcode)}
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
            className="duet-console__clear-btn"
            onClick={handleCopyAll}
            title="Copy All to Clipboard"
          >
            <Copy size={14} />
            <span>Copy</span>
          </button>
          <button
            className="duet-console__clear-btn"
            onClick={handleClear}
            title="Clear Console"
          >
            <Trash2 size={14} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="duet-console__filter-bar">
        <button
          className={`duet-console__filter-toggle${hideTemps ? ' is-active' : ''}`}
          onClick={() => setHideTemps((v) => !v)}
          title="Hide temperature reports (T:, B:, ok T:)"
        >
          <Filter size={12} />
          <span>Hide Temps</span>
        </button>

        <div className="duet-console__filter-select-wrap">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            className="duet-console__filter-select"
          >
            <option value="all">All</option>
            <option value="command">Commands Only</option>
            <option value="response">Responses Only</option>
            <option value="warning">Warnings</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <div className="duet-console__filter-search-wrap">
          <Search size={12} className="duet-console__filter-search-icon" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search output..."
            className="duet-console__filter-search-input"
            spellCheck={false}
          />
          {searchText && (
            <button
              className="duet-console__filter-search-clear"
              onClick={() => setSearchText('')}
              title="Clear search"
            >
              x
            </button>
          )}
        </div>

        <span className="duet-console__filter-count">
          Showing {filteredEntries.length} of {consoleHistory.length} entries
        </span>
      </div>

      {/* Console output */}
      <div ref={outputRef} className="duet-console__output" onScroll={handleScroll}>
        {filteredEntries.length === 0 && consoleHistory.length === 0 && (
          <div className="duet-console__placeholder">
            Console output will appear here. Type a G-code command below or use
            the quick buttons above.
          </div>
        )}
        {filteredEntries.length === 0 && consoleHistory.length > 0 && (
          <div className="duet-console__placeholder">
            No entries match the current filter.
          </div>
        )}
        {filteredEntries.map((entry, i) => (
          <div key={i} className="duet-console__entry">
            <span className="duet-console__line-number">{String(i + 1).padStart(4, '\u00A0')}</span>
            <span className="duet-console__timestamp">{formatTime(entry.timestamp)}</span>
            <span
              className="duet-console__entry-content"
              style={{ color: TYPE_COLORS[entry.type] ?? '#d4d4d8' }}
            >
              {entry.type === 'command' && (
                <span className="duet-console__cmd-prefix">{'> '}</span>
              )}
              {searchText ? highlightText(entry.content, searchText) : entry.content}
            </span>
          </div>
        ))}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          className="duet-console__scroll-bottom-btn"
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          <ArrowDown size={14} />
          <span>Scroll to Bottom</span>
        </button>
      )}

      {/* Command input with autocomplete */}
      <div className="duet-console__input-area">
        {/* Autocomplete dropdown (rendered above input) */}
        {showSuggestions && suggestions.length > 0 && (
          <div ref={suggestionsRef} className="duet-console__suggestions-dropdown">
            {suggestions.map((s, i) => (
              <div
                key={s.code}
                className={`duet-console__suggestion-item${i === selectedSuggestion ? ' is-selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(s.code);
                }}
                onMouseEnter={() => setSelectedSuggestion(i)}
              >
                <span className="duet-console__suggestion-code">{s.code}</span>
                <span className="duet-console__suggestion-desc">{s.description}</span>
              </div>
            ))}
          </div>
        )}

        <div className="duet-console__input-row">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay hiding so mouseDown on suggestion can fire
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onFocus={() => {
              if (suggestions.length > 0 && input.trim().length > 0) {
                setShowSuggestions(true);
              }
            }}
            placeholder={connected ? 'Type G-code command...' : 'Not connected'}
            disabled={!connected}
            className="duet-console__input"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className={`duet-console__send-btn${!connected || !input.trim() ? ' is-disabled' : ''}`}
            onClick={handleSend}
            disabled={!connected || !input.trim()}
            title="Send command"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

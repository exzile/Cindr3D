import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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

const COMMAND_PREFIX_COLOR = '#3b82f6';

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
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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
      <span style={{ background: '#854d0e', color: '#fef08a', borderRadius: 2, padding: '0 1px' }}>
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
    <div style={styles.container}>
      {/* Quick command buttons */}
      <div style={styles.toolbar}>
        <div style={styles.quickButtons}>
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd.gcode}
              style={{
                ...styles.quickBtn,
                ...(cmd.variant === 'danger' ? styles.quickBtnDanger : {}),
              }}
              onClick={() => handleQuickCommand(cmd.gcode)}
              disabled={!connected}
              title={cmd.label}
            >
              {cmd.icon}
              <span style={styles.quickBtnLabel}>{cmd.gcode}</span>
            </button>
          ))}
        </div>
        <div style={styles.toolbarRight}>
          <button
            style={styles.clearBtn}
            onClick={handleCopyAll}
            title="Copy All to Clipboard"
          >
            <Copy size={14} />
            <span>Copy</span>
          </button>
          <button
            style={styles.clearBtn}
            onClick={handleClear}
            title="Clear Console"
          >
            <Trash2 size={14} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div style={styles.filterBar}>
        <button
          style={{
            ...styles.filterToggle,
            ...(hideTemps ? styles.filterToggleActive : {}),
          }}
          onClick={() => setHideTemps((v) => !v)}
          title="Hide temperature reports (T:, B:, ok T:)"
        >
          <Filter size={12} />
          <span>Hide Temps</span>
        </button>

        <div style={styles.filterSelectWrap}>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            style={styles.filterSelect}
          >
            <option value="all">All</option>
            <option value="command">Commands Only</option>
            <option value="response">Responses Only</option>
            <option value="warning">Warnings</option>
            <option value="error">Errors</option>
          </select>
        </div>

        <div style={styles.filterSearchWrap}>
          <Search size={12} style={{ color: '#52525b', flexShrink: 0 }} />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search output..."
            style={styles.filterSearchInput}
            spellCheck={false}
          />
          {searchText && (
            <button
              style={styles.filterSearchClear}
              onClick={() => setSearchText('')}
              title="Clear search"
            >
              x
            </button>
          )}
        </div>

        <span style={styles.filterCount}>
          Showing {filteredEntries.length} of {consoleHistory.length} entries
        </span>
      </div>

      {/* Console output */}
      <div ref={outputRef} style={styles.output} onScroll={handleScroll}>
        {filteredEntries.length === 0 && consoleHistory.length === 0 && (
          <div style={styles.placeholder}>
            Console output will appear here. Type a G-code command below or use
            the quick buttons above.
          </div>
        )}
        {filteredEntries.length === 0 && consoleHistory.length > 0 && (
          <div style={styles.placeholder}>
            No entries match the current filter.
          </div>
        )}
        {filteredEntries.map((entry, i) => (
          <div key={i} style={styles.entry}>
            <span style={styles.lineNumber}>{String(i + 1).padStart(4, '\u00A0')}</span>
            <span style={styles.timestamp}>{formatTime(entry.timestamp)}</span>
            <span
              style={{
                ...styles.entryContent,
                color: TYPE_COLORS[entry.type] ?? '#d4d4d8',
              }}
            >
              {entry.type === 'command' && (
                <span style={{ color: COMMAND_PREFIX_COLOR, fontWeight: 700 }}>{'> '}</span>
              )}
              {searchText ? highlightText(entry.content, searchText) : entry.content}
            </span>
          </div>
        ))}
      </div>

      {/* Scroll to bottom button */}
      {!isAtBottom && (
        <button
          style={styles.scrollBottomBtn}
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          <ArrowDown size={14} />
          <span>Scroll to Bottom</span>
        </button>
      )}

      {/* Command input with autocomplete */}
      <div style={styles.inputArea}>
        {/* Autocomplete dropdown (rendered above input) */}
        {showSuggestions && suggestions.length > 0 && (
          <div ref={suggestionsRef} style={styles.suggestionsDropdown}>
            {suggestions.map((s, i) => (
              <div
                key={s.code}
                style={{
                  ...styles.suggestionItem,
                  ...(i === selectedSuggestion ? styles.suggestionItemSelected : {}),
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(s.code);
                }}
                onMouseEnter={() => setSelectedSuggestion(i)}
              >
                <span style={styles.suggestionCode}>{s.code}</span>
                <span style={styles.suggestionDesc}>{s.description}</span>
              </div>
            ))}
          </div>
        )}

        <div style={styles.inputRow}>
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
            style={styles.input}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            style={{
              ...styles.sendBtn,
              opacity: !connected || !input.trim() ? 0.4 : 1,
            }}
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#18181b',
    color: '#d4d4d8',
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 13,
    position: 'relative',
  },

  // Toolbar
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 8px',
    borderBottom: '1px solid #27272a',
    background: '#1c1c1f',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  toolbarRight: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  quickButtons: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  quickBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#27272a',
    color: '#a1a1aa',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    transition: 'background 0.15s, color 0.15s',
  },
  quickBtnDanger: {
    border: '1px solid #7f1d1d',
    background: '#450a0a',
    color: '#fca5a5',
  },
  quickBtnLabel: {
    fontWeight: 600,
  },
  clearBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#27272a',
    color: '#a1a1aa',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    flexShrink: 0,
  },

  // Filter bar
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    borderBottom: '1px solid #27272a',
    background: '#1a1a1d',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
    fontSize: 12,
  },
  filterToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#27272a',
    color: '#71717a',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  filterToggleActive: {
    border: '1px solid #854d0e',
    background: '#422006',
    color: '#facc15',
  },
  filterSelectWrap: {
    flexShrink: 0,
  },
  filterSelect: {
    padding: '3px 6px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#27272a',
    color: '#a1a1aa',
    fontSize: 11,
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  filterSearchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 120,
    padding: '2px 6px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#09090b',
  },
  filterSearchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: '#e4e4e7',
    fontSize: 11,
    fontFamily: 'inherit',
    outline: 'none',
    padding: '2px 0',
    minWidth: 0,
  },
  filterSearchClear: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    padding: '0 2px',
    lineHeight: 1,
  },
  filterCount: {
    color: '#52525b',
    fontSize: 11,
    whiteSpace: 'nowrap' as const,
    marginLeft: 'auto',
    flexShrink: 0,
  },

  // Output
  output: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 10px',
    lineHeight: 1.6,
  },
  placeholder: {
    color: '#52525b',
    fontStyle: 'italic',
    padding: '16px 0',
    textAlign: 'center' as const,
  },
  entry: {
    display: 'flex',
    gap: 10,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  lineNumber: {
    color: '#3f3f46',
    flexShrink: 0,
    userSelect: 'none' as const,
    minWidth: 32,
    textAlign: 'right' as const,
  },
  timestamp: {
    color: '#52525b',
    flexShrink: 0,
    userSelect: 'none' as const,
  },
  entryContent: {
    flex: 1,
  },

  // Scroll to bottom
  scrollBottomBtn: {
    position: 'absolute' as const,
    bottom: 54,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 12px',
    border: '1px solid #3f3f46',
    borderRadius: 16,
    background: '#27272aee',
    color: '#a1a1aa',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
    zIndex: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(4px)',
  },

  // Input area (wraps suggestions + input row)
  inputArea: {
    position: 'relative' as const,
    flexShrink: 0,
  },

  // Autocomplete
  suggestionsDropdown: {
    position: 'absolute' as const,
    bottom: '100%',
    left: 8,
    right: 50,
    background: '#27272a',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    maxHeight: 240,
    overflowY: 'auto' as const,
    zIndex: 20,
    boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
  },
  suggestionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    transition: 'background 0.1s',
  },
  suggestionItemSelected: {
    background: '#3f3f46',
  },
  suggestionCode: {
    color: '#22d3ee',
    fontWeight: 700,
    minWidth: 40,
    flexShrink: 0,
  },
  suggestionDesc: {
    color: '#a1a1aa',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // Input
  inputRow: {
    display: 'flex',
    gap: 6,
    padding: '6px 8px',
    borderTop: '1px solid #27272a',
    background: '#1c1c1f',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: '6px 10px',
    border: '1px solid #3f3f46',
    borderRadius: 4,
    background: '#09090b',
    color: '#e4e4e7',
    fontFamily: 'inherit',
    fontSize: 13,
    outline: 'none',
  },
  sendBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: '1px solid #3b82f6',
    borderRadius: 4,
    background: '#1e3a5f',
    color: '#60a5fa',
    cursor: 'pointer',
    flexShrink: 0,
  },
};

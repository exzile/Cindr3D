import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import './DuetConsole.css';
import {
  Send,
  Trash2,
  Copy,
  MessageSquare,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { formatTimeOfDay } from '../../utils/printerFormat';
import { ConsoleFilters } from './duetConsole/ConsoleFilters';
import type { FilterType } from './duetConsole/ConsoleFilters';
import { ConsoleHistory } from './duetConsole/ConsoleHistory';
import {
  COMMAND_HISTORY_KEY,
  GCODE_SUGGESTIONS,
  highlightGCode,
  fuzzyMatch,
  MAX_HISTORY,
  QUICK_COMMANDS,
  TEMP_REPORT_PATTERN,
} from './duetConsole/config';

function formatTime(date: Date): string {
  return formatTimeOfDay(date);
}

export default function DuetConsole() {
  const consoleHistory = usePrinterStore((s) => s.consoleHistory);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);

  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(COMMAND_HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.slice(-MAX_HISTORY);
      }
    } catch {
      // ignore corrupt data
    }
    return [];
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Verbose mode toggle
  const [verbose, setVerbose] = useState(false);

  // Holds the in-progress typed text so we can restore it after history navigation
  const draftInputRef = useRef('');

  // Filter state
  const [hideTemps, setHideTemps] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');

  // Autocomplete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  // Scroll state
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Multi-line mode
  const isMultiLine = input.includes('\n');

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const highlightBackdropRef = useRef<HTMLDivElement>(null);

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

  // Update highlight backdrop whenever the input text changes (multi-line mode)
  useLayoutEffect(() => {
    const backdrop = highlightBackdropRef.current;
    if (!backdrop) return;
    backdrop.innerHTML = highlightGCode(input) + '\n'; // trailing newline preserves last-line height
  }, [input]);

  // Show/hide suggestions when input changes
  useEffect(() => {
    if (suggestions.length > 0 && input.trim().length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

    // Split by newlines and send each line sequentially
    const lines = cmd.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      sendGCode(line);
    }

    // Store the full block as a single history entry
    setCommandHistory((prev) => {
      const filtered = prev.filter((c) => c !== cmd);
      const updated = [...filtered, cmd].slice(-MAX_HISTORY);
      try {
        localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(updated));
      } catch {
        // localStorage full or unavailable — ignore
      }
      return updated;
    });
    setHistoryIndex(-1);
    draftInputRef.current = '';
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
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
        if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0 && !e.shiftKey && !e.ctrlKey)) {
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

      // Shift+Enter: insert newline (switch to multi-line mode)
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        setInput((prev) => prev + '\n');
        return;
      }

      // Ctrl+Enter: send multi-line block (or single line)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Plain Enter: send (only in single-line mode)
      if (e.key === 'Enter' && !isMultiLine) {
        e.preventDefault();
        handleSend();
        return;
      }

      if (e.key === 'ArrowUp' && !isMultiLine) {
        e.preventDefault();
        if (commandHistory.length === 0) return;
        // Save current typed text when first entering history navigation
        if (historyIndex === -1) {
          draftInputRef.current = input;
        }
        const nextIndex =
          historyIndex === -1
            ? commandHistory.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
        return;
      }

      if (e.key === 'ArrowDown' && !isMultiLine) {
        e.preventDefault();
        if (historyIndex === -1) return;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInput(draftInputRef.current);
        } else {
          setHistoryIndex(nextIndex);
          setInput(commandHistory[nextIndex]);
        }
      }
    },
    [handleSend, commandHistory, historyIndex, showSuggestions, suggestions, selectedSuggestion, selectSuggestion, input, isMultiLine],
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

  const handleToggleVerbose = useCallback(() => {
    const nextVerbose = !verbose;
    sendGCode(nextVerbose ? 'M111 S1' : 'M111 S0');
    setVerbose(nextVerbose);
  }, [verbose, sendGCode]);

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
            className={`duet-console__filter-toggle${verbose ? ' is-active' : ''}`}
            onClick={handleToggleVerbose}
            disabled={!connected}
            title={verbose ? 'Verbose mode ON — click to send M111 S0' : 'Verbose mode OFF — click to send M111 S1'}
          >
            <MessageSquare size={12} />
            <span>{verbose ? 'Verbose' : 'Quiet'}</span>
          </button>
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

      <ConsoleFilters
        consoleCount={consoleHistory.length}
        filteredCount={filteredEntries.length}
        filterType={filterType}
        hideTemps={hideTemps}
        searchText={searchText}
        setFilterType={setFilterType}
        setHideTemps={setHideTemps}
        setSearchText={setSearchText}
      />

      <ConsoleHistory
        filteredEntries={filteredEntries}
        formatTime={formatTime}
        isAtBottom={isAtBottom}
        outputRef={outputRef}
        searchText={searchText}
        totalEntries={consoleHistory.length}
        onScroll={handleScroll}
        onScrollToBottom={scrollToBottom}
      />

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
          {isMultiLine ? (
            <div className="duet-console__input-highlight-wrap">
              {/* Backdrop layer for syntax highlighting */}
              <div
                ref={highlightBackdropRef}
                className="duet-console__input-highlight-backdrop"
                aria-hidden="true"
              />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setHistoryIndex(-1);
                }}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 150);
                }}
                onScroll={() => {
                  // Keep backdrop scroll in sync with textarea
                  const ta = textareaRef.current;
                  const bd = highlightBackdropRef.current;
                  if (ta && bd) {
                    bd.scrollTop = ta.scrollTop;
                    bd.scrollLeft = ta.scrollLeft;
                  }
                }}
                placeholder={connected ? 'Multi-line G-code (Ctrl+Enter to send)' : 'Not connected'}
                disabled={!connected}
                className="duet-console__input duet-console__input--multiline duet-console__input--highlighted"
                spellCheck={false}
                autoComplete="off"
                rows={3}
              />
            </div>
          ) : (
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
              placeholder={connected ? 'Type G-code... (Shift+Enter for multi-line)' : 'Not connected'}
              disabled={!connected}
              className="duet-console__input"
              spellCheck={false}
              autoComplete="off"
            />
          )}
          <button
            className={`duet-console__send-btn${!connected || !input.trim() ? ' is-disabled' : ''}`}
            onClick={handleSend}
            disabled={!connected || !input.trim()}
            title={isMultiLine ? 'Send all lines (Ctrl+Enter)' : 'Send command'}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import './DuetConsole.css';
import { usePrinterStore } from '../../store/printerStore';
import { formatTimeOfDay } from '../../utils/printerFormat';
import { ConsoleFilters } from './duetConsole/ConsoleFilters';
import type { FilterType } from './duetConsole/ConsoleFilters';
import { ConsoleHistory } from './duetConsole/ConsoleHistory';
import { ConsoleInput } from './duetConsole/ConsoleInput';
import { ConsoleToolbar } from './duetConsole/ConsoleToolbar';
import {
  COMMAND_HISTORY_KEY,
  GCODE_SUGGESTIONS,
  MAX_HISTORY,
  TEMP_REPORT_PATTERN,
  fuzzyMatch,
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
  const [verbose, setVerbose] = useState(false);
  const [hideTemps, setHideTemps] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef('');

  const isMultiLine = input.includes('\n');

  const filteredEntries = useMemo(() => {
    return consoleHistory.filter((entry) => {
      if (hideTemps && TEMP_REPORT_PATTERN.test(entry.content)) return false;
      if (filterType !== 'all' && entry.type !== filterType) return false;
      if (searchText && !entry.content.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [consoleHistory, filterType, hideTemps, searchText]);

  const suggestions = useMemo(() => {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed || trimmed.includes(' ')) return [];
    return GCODE_SUGGESTIONS.filter(
      (suggestion) => fuzzyMatch(trimmed, suggestion.code) || fuzzyMatch(trimmed, suggestion.description),
    ).slice(0, 8);
  }, [input]);

  useEffect(() => {
    const el = outputRef.current;
    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [consoleHistory.length, isAtBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (suggestions.length > 0 && input.trim().length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSuggestions(true);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
    }
  }, [input, suggestions]);

  const handleScroll = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
  }, []);

  const handleSend = useCallback(() => {
    const cmd = input.trim();
    if (!cmd) return;

    const lines = cmd.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      sendGCode(line);
    }

    setCommandHistory((prev) => {
      const filtered = prev.filter((command) => command !== cmd);
      const updated = [...filtered, cmd].slice(-MAX_HISTORY);
      try {
        localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(updated));
      } catch {
        // localStorage full or unavailable: ignore
      }
      return updated;
    });
    setHistoryIndex(-1);
    draftInputRef.current = '';
    setInput('');
    setShowSuggestions(false);
  }, [input, sendGCode]);

  const selectSuggestion = useCallback((code: string) => {
    setInput(`${code} `);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setHistoryIndex(-1);
  }, []);

  const handleShowSuggestions = useCallback(() => {
    setShowSuggestions(true);
  }, []);

  const handleHideSuggestions = useCallback(() => {
    setShowSuggestions(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (showSuggestions && suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSelectedSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSelectedSuggestion((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey)) {
          event.preventDefault();
          selectSuggestion(suggestions[selectedSuggestion].code);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowSuggestions(false);
          return;
        }
      }

      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        setInput((prev) => `${prev}\n`);
        return;
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSend();
        return;
      }

      if (event.key === 'Enter' && !isMultiLine) {
        event.preventDefault();
        handleSend();
        return;
      }

      if (event.key === 'ArrowUp' && !isMultiLine) {
        event.preventDefault();
        if (commandHistory.length === 0) return;
        if (historyIndex === -1) {
          draftInputRef.current = input;
        }
        const nextIndex = historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
        return;
      }

      if (event.key === 'ArrowDown' && !isMultiLine) {
        event.preventDefault();
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
    [commandHistory, handleSend, historyIndex, input, isMultiLine, selectSuggestion, selectedSuggestion, showSuggestions, suggestions],
  );

  const handleClear = useCallback(() => {
    usePrinterStore.setState({ consoleHistory: [] });
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = filteredEntries
      .map(
        (entry, index) =>
          `${String(index + 1).padStart(4, ' ')} [${formatTime(entry.timestamp)}] ${entry.type === 'command' ? '> ' : ''}${entry.content}`,
      )
      .join('\n');
    navigator.clipboard.writeText(text);
  }, [filteredEntries]);

  const handleQuickCommand = useCallback((gcode: string) => {
    sendGCode(gcode);
  }, [sendGCode]);

  const handleToggleVerbose = useCallback(() => {
    const nextVerbose = !verbose;
    sendGCode(nextVerbose ? 'M111 S1' : 'M111 S0');
    setVerbose(nextVerbose);
  }, [sendGCode, verbose]);

  return (
    <div className="duet-console">
      <ConsoleToolbar
        connected={connected}
        verbose={verbose}
        onClear={handleClear}
        onCopyAll={handleCopyAll}
        onQuickCommand={handleQuickCommand}
        onToggleVerbose={handleToggleVerbose}
      />

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

      <ConsoleInput
        connected={connected}
        input={input}
        inputRef={inputRef}
        isMultiLine={isMultiLine}
        onHideSuggestions={handleHideSuggestions}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        onShowSuggestions={handleShowSuggestions}
        selectSuggestion={selectSuggestion}
        selectedSuggestion={selectedSuggestion}
        setSelectedSuggestion={setSelectedSuggestion}
        showSuggestions={showSuggestions}
        suggestions={suggestions}
        suggestionsRef={suggestionsRef}
        textareaRef={textareaRef}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import './DuetConsole.css';
import { usePrinterStore } from '../../store/printerStore';
import { formatTimeOfDay } from '../../utils/printerFormat';
import { ConsoleFilters } from './duetConsole/ConsoleFilters';
import type { ConsoleFilterState } from './duetConsole/ConsoleFilters';
import { ConsoleHistory } from './duetConsole/ConsoleHistory';
import { ConsoleInput } from './duetConsole/ConsoleInput';
import { ConsoleToolbar } from './duetConsole/ConsoleToolbar';
import {
  isPrinterLogFile,
  normalizePrinterLogPath,
  parsePrinterLogLineDetails,
} from '../../utils/printerConsole';
import {
  COMMAND_HISTORY_KEY,
  GCODE_SUGGESTIONS,
  MAX_HISTORY,
  TEMP_REPORT_PATTERN,
  fuzzyMatch,
} from './duetConsole/config';

const MAX_IMPORTED_LOG_LINES = 1500;

function isDebugConsoleEntry(entry: { content: string }): boolean {
  return entry.content.trim().toLowerCase().startsWith('[debug]');
}

export default function DuetConsole() {
  const consoleHistory = usePrinterStore((s) => s.consoleHistory);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const clearConsoleHistory = usePrinterStore((s) => s.clearConsoleHistory);
  const importConsoleEntries = usePrinterStore((s) => s.importConsoleEntries);
  const connected = usePrinterStore((s) => s.connected);
  const service = usePrinterStore((s) => s.service);
  const logFile = usePrinterStore((s) => s.model?.state?.logFile);

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
  const [showDebug, setShowDebug] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState<ConsoleFilterState>({
    command: true,
    response: true,
    warning: true,
    error: true,
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [autoFollowTop, setAutoFollowTop] = useState(true);
  const [loadingPrinterLog, setLoadingPrinterLog] = useState(false);
  const [liveLogPaused, setLiveLogPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState<Date | null>(null);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef('');
  const autoLoadedLogRef = useRef<string | null>(null);
  const loadingPrinterLogRef = useRef(false);

  const isMultiLine = input.includes('\n');

  const filteredEntries = useMemo(() => {
    return consoleHistory
      .filter((entry) => {
        if (clearedAt && entry.timestamp <= clearedAt) return false;
        if (hideTemps && TEMP_REPORT_PATTERN.test(entry.content)) return false;
        if (!visibleTypes[entry.type]) return false;
        if (!showDebug && isDebugConsoleEntry(entry)) return false;
        if (searchText && !entry.content.toLowerCase().includes(searchText.toLowerCase())) return false;
        return true;
      })
      .slice()
      .reverse();
  }, [clearedAt, consoleHistory, hideTemps, searchText, showDebug, visibleTypes]);

  const suggestions = useMemo(() => {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed || trimmed.includes(' ')) return [];
    return GCODE_SUGGESTIONS.filter(
      (suggestion) => fuzzyMatch(trimmed, suggestion.code) || fuzzyMatch(trimmed, suggestion.description),
    ).slice(0, 8);
  }, [input]);

  useEffect(() => {
    const el = outputRef.current;
    if (el && autoFollowTop) {
      el.scrollTop = 0;
    }
  }, [autoFollowTop, filteredEntries.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (suggestions.length > 0 && input.trim().length > 0) {
      setShowSuggestions(true);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
    }
  }, [input, suggestions]);

  const scrollToTop = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = 0;
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
    setClearedAt(new Date());
    clearConsoleHistory();
  }, [clearConsoleHistory]);

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

  const handleLoadPrinterLog = useCallback(async (showMissingLogWarning = true) => {
    if (!service || loadingPrinterLogRef.current) return;
    loadingPrinterLogRef.current = true;
    setLoadingPrinterLog(true);
    if (showMissingLogWarning) {
      setClearedAt(null);
    }

    try {
      const sysFiles = await service.listFiles('0:/sys').catch(() => []);
      const discoveredLogPaths = sysFiles
        .filter((file) => file.type === 'f' && isPrinterLogFile(file.name))
        .map((file) => `0:/sys/${file.name}`);
      const candidatePaths = Array.from(new Set([
        ...normalizePrinterLogPath(logFile),
        ...discoveredLogPaths,
      ]));

      if (candidatePaths.length === 0) {
        if (showMissingLogWarning) {
          importConsoleEntries([{
            timestamp: new Date(),
            type: 'warning',
            content: 'No printer log file found. Enable RepRapFirmware event logging with M929 P"eventlog.txt" S3, then pull logs again.',
          }]);
        }
        return;
      }

      const chunks: string[] = [];
      for (const path of candidatePaths) {
        try {
          const blob = await service.downloadFile(path);
          const text = await blob.text();
          if (text.trim()) chunks.push(text);
        } catch {
          // The file may have rotated or disappeared after listing; continue with the rest.
        }
      }
      const text = chunks.join('\n');
      if (!text.trim()) return;

      const clearCutoff = showMissingLogWarning ? null : clearedAt;
      const importedEntries = text
        .split(/\r?\n/)
        .slice(-MAX_IMPORTED_LOG_LINES)
        .map((line) => parsePrinterLogLineDetails(line))
        .filter((parsed) => parsed !== null)
        .filter((parsed) => !clearCutoff || (parsed.hasTimestamp && parsed.entry.timestamp > clearCutoff))
        .map((parsed) => parsed.entry);

      importConsoleEntries(importedEntries);
    } finally {
      loadingPrinterLogRef.current = false;
      setLoadingPrinterLog(false);
    }
  }, [clearedAt, importConsoleEntries, logFile, service]);

  useEffect(() => {
    if (!connected || !service) {
      autoLoadedLogRef.current = null;
      return;
    }
    const key = `${service.getConfig().hostname}|${logFile ?? 'eventlog.txt'}`;
    if (autoLoadedLogRef.current !== key) {
      autoLoadedLogRef.current = key;
      void handleLoadPrinterLog(false);
    }
    if (liveLogPaused) return;
    const interval = window.setInterval(() => {
      void handleLoadPrinterLog(false);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [connected, handleLoadPrinterLog, liveLogPaused, logFile, service]);

  const handleToggleLiveLog = useCallback(() => {
    setLiveLogPaused((paused) => !paused);
  }, []);

  const handleToggleAutoFollowTop = useCallback(() => {
    setAutoFollowTop((enabled) => {
      const next = !enabled;
      if (next) requestAnimationFrame(scrollToTop);
      return next;
    });
  }, [scrollToTop]);

  const handleToggleVerbose = useCallback(() => {
    const nextVerbose = !verbose;
    sendGCode(nextVerbose ? 'M111 S1' : 'M111 S0');
    setVerbose(nextVerbose);
  }, [sendGCode, verbose]);

  return (
    <div className="duet-console">
      <ConsoleToolbar
        autoFollowTop={autoFollowTop}
        connected={connected}
        liveLogPaused={liveLogPaused}
        loadingPrinterLog={loadingPrinterLog}
        verbose={verbose}
        onClear={handleClear}
        onCopyAll={handleCopyAll}
        onLoadPrinterLog={() => void handleLoadPrinterLog(true)}
        onQuickCommand={handleQuickCommand}
        onToggleAutoFollowTop={handleToggleAutoFollowTop}
        onToggleLiveLog={handleToggleLiveLog}
        onToggleVerbose={handleToggleVerbose}
      />

      <ConsoleFilters
        consoleCount={consoleHistory.length}
        filteredCount={filteredEntries.length}
        hideTemps={hideTemps}
        searchText={searchText}
        showDebug={showDebug}
        visibleTypes={visibleTypes}
        setHideTemps={setHideTemps}
        setSearchText={setSearchText}
        setShowDebug={setShowDebug}
        setVisibleTypes={setVisibleTypes}
      />

      <ConsoleHistory
        filteredEntries={filteredEntries}
        formatTime={formatTimeOfDay}
        outputRef={outputRef}
        searchText={searchText}
        totalEntries={consoleHistory.length}
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

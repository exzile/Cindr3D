import type { RefObject } from 'react';
import { ArrowDown } from 'lucide-react';
import { TYPE_COLORS, highlightText } from './config';

interface ConsoleEntry {
  content: string;
  timestamp: Date;
  type: 'command' | 'response' | 'warning' | 'error';
}

interface ConsoleHistoryProps {
  filteredEntries: ConsoleEntry[];
  isAtBottom: boolean;
  outputRef: RefObject<HTMLDivElement | null>;
  searchText: string;
  totalEntries: number;
  onScroll: () => void;
  onScrollToBottom: () => void;
  formatTime: (date: Date) => string;
}

export function ConsoleHistory({
  filteredEntries,
  formatTime,
  isAtBottom,
  outputRef,
  searchText,
  totalEntries,
  onScroll,
  onScrollToBottom,
}: ConsoleHistoryProps) {
  return (
    <>
      <div ref={outputRef} className="duet-console__output" onScroll={onScroll}>
        {filteredEntries.length === 0 && totalEntries === 0 && (
          <div className="duet-console__placeholder">
            Console output will appear here. Type a G-code command below or use
            the quick buttons above.
          </div>
        )}
        {filteredEntries.length === 0 && totalEntries > 0 && (
          <div className="duet-console__placeholder">No entries match the current filter.</div>
        )}
        {filteredEntries.map((entry, index) => (
          <div key={index} className="duet-console__entry">
            <span className="duet-console__line-number">{String(index + 1).padStart(4, '\u00A0')}</span>
            <span className="duet-console__timestamp">{formatTime(entry.timestamp)}</span>
            <span
              className="duet-console__entry-content"
              style={{ color: TYPE_COLORS[entry.type] ?? '#d4d4d8' }}
            >
              {entry.type === 'command' && <span className="duet-console__cmd-prefix">{'> '}</span>}
              {searchText ? highlightText(entry.content, searchText) : entry.content}
            </span>
          </div>
        ))}
      </div>

      {!isAtBottom && (
        <button
          className="duet-console__scroll-bottom-btn"
          onClick={onScrollToBottom}
          title="Scroll to bottom"
        >
          <ArrowDown size={14} />
          <span>Scroll to Bottom</span>
        </button>
      )}
    </>
  );
}

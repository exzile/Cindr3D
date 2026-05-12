import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { Send } from 'lucide-react';
import { highlightGCode } from './config';

type Suggestion = {
  code: string;
  description: string;
};

export function ConsoleInput({
  connected,
  input,
  inputRef,
  isMultiLine,
  onInputChange,
  onShowSuggestions,
  onHideSuggestions,
  onKeyDown,
  onSend,
  selectSuggestion,
  selectedSuggestion,
  setSelectedSuggestion,
  showSuggestions,
  suggestions,
  suggestionsRef,
  textareaRef,
}: {
  connected: boolean;
  input: string;
  inputRef: RefObject<HTMLInputElement | null>;
  isMultiLine: boolean;
  onInputChange: (value: string) => void;
  onShowSuggestions: () => void;
  onHideSuggestions: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSend: () => void;
  selectSuggestion: (code: string) => void;
  selectedSuggestion: number;
  setSelectedSuggestion: (index: number) => void;
  showSuggestions: boolean;
  suggestions: Suggestion[];
  suggestionsRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const highlightBackdropRef = useRef<HTMLDivElement | null>(null);
  // 150ms blur-then-hide lets a click on a suggestion fire before the
  // suggestion list unmounts. Stash the timer so we can clear it on unmount.
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);
  const scheduleHide = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(onHideSuggestions, 150);
  };

  useLayoutEffect(() => {
    const backdrop = highlightBackdropRef.current;
    if (!backdrop) return;
    backdrop.innerHTML = `${highlightGCode(input)}\n`;
  }, [input]);

  return (
    <div className="duet-console__input-area">
      {showSuggestions && suggestions.length > 0 && (
        <div ref={suggestionsRef} className="duet-console__suggestions-dropdown">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.code}
              className={`duet-console__suggestion-item${index === selectedSuggestion ? ' is-selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                selectSuggestion(suggestion.code);
              }}
              onMouseEnter={() => setSelectedSuggestion(index)}
            >
              <span className="duet-console__suggestion-code">{suggestion.code}</span>
              <span className="duet-console__suggestion-desc">{suggestion.description}</span>
            </div>
          ))}
        </div>
      )}

      <div className="duet-console__input-row">
        {isMultiLine ? (
          <div className="duet-console__input-highlight-wrap">
            <div
              ref={highlightBackdropRef}
              className="duet-console__input-highlight-backdrop"
              aria-hidden="true"
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={onKeyDown}
              onBlur={scheduleHide}
              onScroll={() => {
                const textarea = textareaRef.current;
                const backdrop = highlightBackdropRef.current;
                if (textarea && backdrop) {
                  backdrop.scrollTop = textarea.scrollTop;
                  backdrop.scrollLeft = textarea.scrollLeft;
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
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={scheduleHide}
            onFocus={() => {
              if (suggestions.length > 0 && input.trim().length > 0) {
                onShowSuggestions();
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
          onClick={onSend}
          disabled={!connected || !input.trim()}
          title={isMultiLine ? 'Send all lines (Ctrl+Enter)' : 'Send command'}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

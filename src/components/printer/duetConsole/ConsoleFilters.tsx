import { Filter, Search } from 'lucide-react';

type ConsoleFilterKey = 'command' | 'response' | 'warning' | 'error';
type ConsoleFilterState = Record<ConsoleFilterKey, boolean>;

const FILTER_OPTIONS: Array<{ key: ConsoleFilterKey; label: string }> = [
  { key: 'command', label: 'Commands' },
  { key: 'response', label: 'Responses' },
  { key: 'warning', label: 'Warnings' },
  { key: 'error', label: 'Errors' },
];

interface ConsoleFiltersProps {
  consoleCount: number;
  filteredCount: number;
  hideTemps: boolean;
  searchText: string;
  showDebug: boolean;
  visibleTypes: ConsoleFilterState;
  setHideTemps: (updater: (value: boolean) => boolean) => void;
  setSearchText: (value: string) => void;
  setShowDebug: (updater: (value: boolean) => boolean) => void;
  setVisibleTypes: (updater: (value: ConsoleFilterState) => ConsoleFilterState) => void;
}

export function ConsoleFilters({
  consoleCount,
  filteredCount,
  hideTemps,
  searchText,
  showDebug,
  visibleTypes,
  setHideTemps,
  setSearchText,
  setShowDebug,
  setVisibleTypes,
}: ConsoleFiltersProps) {
  return (
    <div className="duet-console__filter-bar">
      <button
        className={`duet-console__filter-toggle${hideTemps ? ' is-active' : ''}`}
        onClick={() => setHideTemps((value) => !value)}
        title="Hide temperature reports (T:, B:, ok T:)"
      >
        <Filter size={12} />
        <span>Hide Temps</span>
      </button>

      <div className="duet-console__filter-checks" aria-label="Console entry filters">
        {FILTER_OPTIONS.map((option) => (
          <label key={option.key} className="duet-console__filter-check">
            <input
              type="checkbox"
              checked={visibleTypes[option.key]}
              onChange={() => {
                setVisibleTypes((current) => ({
                  ...current,
                  [option.key]: !current[option.key],
                }));
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        <label className="duet-console__filter-check">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={() => setShowDebug((value) => !value)}
          />
          <span>[debug]</span>
        </label>
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
        Showing {filteredCount} of {consoleCount} entries
      </span>
    </div>
  );
}

export type { ConsoleFilterKey, ConsoleFilterState };

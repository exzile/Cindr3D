import { Filter, Search } from 'lucide-react';

type FilterType = 'all' | 'command' | 'response' | 'warning' | 'error';

interface ConsoleFiltersProps {
  consoleCount: number;
  filteredCount: number;
  filterType: FilterType;
  hideTemps: boolean;
  searchText: string;
  setFilterType: (value: FilterType) => void;
  setHideTemps: (updater: (value: boolean) => boolean) => void;
  setSearchText: (value: string) => void;
}

export function ConsoleFilters({
  consoleCount,
  filteredCount,
  filterType,
  hideTemps,
  searchText,
  setFilterType,
  setHideTemps,
  setSearchText,
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
        Showing {filteredCount} of {consoleCount} entries
      </span>
    </div>
  );
}

export type { FilterType };

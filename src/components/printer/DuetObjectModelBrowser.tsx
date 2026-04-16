import { useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Search, Braces, X } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';
import './DuetObjectModelBrowser.css';

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | undefined | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[];

function isObject(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeLabel(v: JsonValue): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') return `Object(${Object.keys(v).length})`;
  return typeof v;
}

function valueColor(v: JsonValue): string {
  if (v === null || v === undefined) return COLORS.textDim;
  if (typeof v === 'string') return COLORS.success;
  if (typeof v === 'number') return COLORS.accent;
  if (typeof v === 'boolean') return COLORS.warning;
  return COLORS.text;
}

function formatPrimitive(v: JsonValue): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

interface NodeProps {
  path: string;
  nodeKey: string;
  value: JsonValue;
  depth: number;
  search: string;
  expandedByDefault: boolean;
}

function Node({ path, nodeKey, value, depth, search, expandedByDefault }: NodeProps) {
  const [open, setOpen] = useState(expandedByDefault || depth < 1);

  const isContainer = isObject(value) || Array.isArray(value);
  const matchesSearch = search.length > 0 && path.toLowerCase().includes(search.toLowerCase());

  if (!isContainer) {
    return (
      <div
        className={`duet-obj-browser__node-leaf${matchesSearch ? ' is-match' : ''}`}
        style={{ paddingLeft: depth * 14 }}
      >
        <span className="duet-obj-browser__node-spacer" />
        <span style={{ color: COLORS.text }}>{nodeKey}</span>
        <span className="duet-obj-browser__node-sep">:</span>
        <span style={{ color: valueColor(value), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatPrimitive(value)}
        </span>
      </div>
    );
  }

  const entries = isObject(value)
    ? Object.entries(value)
    : (value as JsonArray).map((v, i) => [String(i), v] as [string, JsonValue]);

  return (
    <div>
      <div
        className={`duet-obj-browser__node-container-row${matchesSearch ? ' is-match' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{nodeKey}</span>
        <span className="duet-obj-browser__node-type">{typeLabel(value)}</span>
      </div>
      {open && entries.map(([k, v]) => (
        <Node
          key={k}
          path={path === '' ? k : `${path}.${k}`}
          nodeKey={k}
          value={v}
          depth={depth + 1}
          search={search}
          expandedByDefault={expandedByDefault}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search-aware filtering — prune branches that contain no matches
// ---------------------------------------------------------------------------
function filterTree(value: JsonValue, search: string, path = ''): JsonValue | undefined {
  if (search.length === 0) return value;

  const lowerSearch = search.toLowerCase();
  if (path.toLowerCase().includes(lowerSearch)) return value;

  if (isObject(value)) {
    const out: JsonObject = {};
    let anyMatch = false;
    for (const [k, v] of Object.entries(value)) {
      const sub = filterTree(v, search, path === '' ? k : `${path}.${k}`);
      if (sub !== undefined) {
        out[k] = sub;
        anyMatch = true;
      }
    }
    return anyMatch ? out : undefined;
  }

  if (Array.isArray(value)) {
    const out: JsonArray = [];
    let anyMatch = false;
    for (let i = 0; i < value.length; i++) {
      const sub = filterTree(value[i], search, `${path}.${i}`);
      if (sub !== undefined) {
        out.push(sub);
        anyMatch = true;
      }
    }
    return anyMatch ? out : undefined;
  }

  // Primitive — match on stringified value as well
  if (String(value).toLowerCase().includes(lowerSearch)) return value;
  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetObjectModelBrowser() {
  const model = usePrinterStore((s) => s.model);

  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => filterTree(model as JsonObject, search),
    [model, search],
  );

  const handleClear = useCallback(() => setSearch(''), []);

  return (
    <div className="duet-obj-browser">
      <div className="duet-obj-browser__panel">
        <div className="duet-obj-browser__header">
          <Braces size={14} color={COLORS.textDim} />
          <span className="duet-obj-browser__header-label">
            Object Model (read-only)
          </span>
        </div>

        <div className="duet-obj-browser__search-wrap">
          <Search
            size={14}
            className="duet-obj-browser__search-icon"
          />
          <input
            className="duet-obj-browser__search-input"
            type="text"
            placeholder="Search keys and values…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="duet-obj-browser__search-clear"
              onClick={handleClear}
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="duet-obj-browser__tree">
          {filtered === undefined || (isObject(filtered) && Object.keys(filtered).length === 0) ? (
            <div className="duet-obj-browser__empty">
              No matches for "{search}".
            </div>
          ) : (
            <Node
              path=""
              nodeKey="model"
              value={filtered}
              depth={0}
              search={search}
              expandedByDefault={search.length > 0}
            />
          )}
        </div>
      </div>
    </div>
  );
}

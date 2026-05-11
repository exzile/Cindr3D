import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Search, Braces, X, Check } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { colors as COLORS } from '../../utils/theme';
import './DuetObjectModelBrowser.css';
import { errorMessage } from '../../utils/errorHandling';

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
  onEdit?: (path: string, newValue: string) => void;
}

function Node({ path, nodeKey, value, depth, search, expandedByDefault, onEdit }: NodeProps) {
  const [open, setOpen] = useState(expandedByDefault || depth < 1);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const isContainer = isObject(value) || Array.isArray(value);
  const matchesSearch = search.length > 0 && path.toLowerCase().includes(search.toLowerCase());

  const handleDoubleClick = useCallback(() => {
    if (!onEdit) return;
    const raw = value === null ? 'null' : value === undefined ? '' : String(value);
    setEditValue(raw);
    setEditing(true);
  }, [onEdit, value]);

  const handleConfirm = useCallback(() => {
    if (onEdit && editValue !== formatPrimitive(value)) {
      onEdit(path, editValue);
    }
    setEditing(false);
  }, [onEdit, editValue, value, path]);

  const handleCancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (!isContainer) {
    return (
      <div
        className={`duet-obj-browser__node-leaf${matchesSearch ? ' is-match' : ''}`}
        style={{ paddingLeft: depth * 14 }}
      >
        <span className="duet-obj-browser__node-spacer" />
        <span style={{ color: COLORS.text }}>{nodeKey}</span>
        <span className="duet-obj-browser__node-sep">:</span>
        {editing ? (
          <span className="duet-obj-browser__edit-wrap">
            <input
              ref={inputRef}
              className="duet-obj-browser__edit-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
              }}
              onBlur={handleCancel}
            />
            <button
              className="duet-obj-browser__edit-confirm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleConfirm}
              title="Confirm edit"
            >
              <Check size={10} />
            </button>
            <button
              className="duet-obj-browser__edit-cancel"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
              title="Cancel"
            >
              <X size={10} />
            </button>
          </span>
        ) : (
          <span
            style={{ color: valueColor(value), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: onEdit ? 'pointer' : undefined }}
            onDoubleClick={handleDoubleClick}
            title={onEdit ? 'Double-click to edit' : undefined}
          >
            {formatPrimitive(value)}
          </span>
        )}
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
          onEdit={onEdit}
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
// Path-to-G-code mapping for known writable paths
// ---------------------------------------------------------------------------
function finiteNumber(input: string): number | null {
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function gcodeForPath(path: string, newValue: string): string | null {
  // move.speedFactor -> M220 S<percent>
  if (path === 'move.speedFactor') {
    const value = finiteNumber(newValue);
    if (value == null) return null;
    const pct = Math.round(clamp(value, 0, 3) * 100);
    return `M220 S${pct}`;
  }
  // move.extruders[n].factor -> M221 D<n> S<percent>
  const extFactorMatch = path.match(/^move\.extruders\.(\d+)\.factor$/);
  if (extFactorMatch) {
    const value = finiteNumber(newValue);
    if (value == null) return null;
    const pct = Math.round(clamp(value, 0, 3) * 100);
    return `M221 D${extFactorMatch[1]} S${pct}`;
  }
  // fans[n].requestedValue -> M106 P<n> S<0-255>
  const fanMatch = path.match(/^fans\.(\d+)\.requestedValue$/);
  if (fanMatch) {
    const value = finiteNumber(newValue);
    if (value == null) return null;
    const v = Math.round(clamp(value, 0, 1) * 255);
    return `M106 P${fanMatch[1]} S${v}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DuetObjectModelBrowser() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const connected = usePrinterStore((s) => s.connected);

  const [search, setSearch] = useState('');
  const [editStatus, setEditStatus] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterTree(model as JsonObject, search),
    [model, search],
  );

  const handleClear = useCallback(() => setSearch(''), []);

  const handleEdit = useCallback(async (path: string, newValue: string) => {
    if (!connected) {
      setEditStatus('Not connected');
      return;
    }
    const gcode = gcodeForPath(path, newValue);
    if (!gcode) {
      setEditStatus(`Unsupported edit path: ${path}`);
      setTimeout(() => setEditStatus(null), 3000);
      return;
    }
    try {
      setEditStatus(`Sending: ${gcode}`);
      await sendGCode(gcode);
      setEditStatus(`Sent: ${gcode}`);
      setTimeout(() => setEditStatus(null), 3000);
    } catch (err) {
      setEditStatus(`Error: ${errorMessage(err, 'Unknown error')}`);
      setTimeout(() => setEditStatus(null), 5000);
    }
  }, [connected, sendGCode]);

  return (
    <div className="duet-obj-browser">
      <div className="duet-obj-browser__panel">
        <div className="duet-obj-browser__header">
          <Braces size={14} color={COLORS.textDim} />
          <span className="duet-obj-browser__header-label">
            Object Model {connected ? '(double-click values to edit)' : '(read-only)'}
          </span>
        </div>

        {editStatus && (
          <div className="duet-obj-browser__edit-status">{editStatus}</div>
        )}

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
              No matches for &quot;{search}&quot;.
            </div>
          ) : (
            <Node
              path=""
              nodeKey="model"
              value={filtered}
              depth={0}
              search={search}
              expandedByDefault={search.length > 0}
              onEdit={connected ? handleEdit : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { highlightText } from './config';
import type { ConsoleEntry } from '../../../types/duet';
import { getStructuredPayload, type StructuredPayload } from '../../../utils/consoleStructuredPayload';

type StructuredViewer = StructuredPayload & {
  title: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getJsonSummary(value: unknown): string {
  if (Array.isArray(value)) return `Array (${value.length})`;
  if (isRecord(value)) return `Object (${Object.keys(value).length})`;
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  return String(value);
}

function renderPrimitiveValue(value: unknown): ReactNode {
  const type = value === null ? 'null' : typeof value;
  return <span className={`duet-console__json-value duet-console__json-value--${type}`}>{getJsonSummary(value)}</span>;
}

function JsonTree({
  label,
  path,
  value,
}: {
  label?: string;
  path: string;
  value: unknown;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const isContainer = Array.isArray(value) || isRecord(value);

  if (!isContainer) {
    return (
      <div className="duet-console__json-row">
        {label && <span className="duet-console__json-key">{label}:</span>}
        {renderPrimitiveValue(value)}
      </div>
    );
  }

  const isCollapsed = collapsed.has(path);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`[${index}]`, item] as const)
    : Object.entries(value);

  return (
    <div className="duet-console__json-group">
      <button
        type="button"
        className="duet-console__json-toggle"
        onClick={() => {
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          });
        }}
      >
        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {label && <span className="duet-console__json-key">{label}:</span>}
        <span className="duet-console__json-summary">{getJsonSummary(value)}</span>
      </button>
      {!isCollapsed && (
        <div className="duet-console__json-children">
          {entries.map(([key, item]) => (
            <JsonTree key={`${path}.${key}`} label={key} path={`${path}.${key}`} value={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function renderXmlLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(<\/?[\w:-]+)|([\w:-]+)(=)|("(?:\\.|[^"\\])*")|(\/?>)/g;
  let cursor = 0;

  for (const match of line.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(line.slice(cursor, index));

    const className = match[1] ? 'tag'
        : match[2] ? 'attribute'
          : match[4] ? 'string'
            : 'punctuation';

    nodes.push(
      <span key={`${index}-${token}`} className={`duet-console__token duet-console__token--${className}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

function renderStructuredLine(kind: StructuredPayload['kind'], line: string): ReactNode[] {
  if (kind === 'xml') return renderXmlLine(line);
  return [line];
}

interface ConsoleHistoryProps {
  filteredEntries: ConsoleEntry[];
  outputRef: RefObject<HTMLDivElement | null>;
  searchText: string;
  totalEntries: number;
  formatTime: (date: Date) => string;
}

export function ConsoleHistory({
  filteredEntries,
  formatTime,
  outputRef,
  searchText,
  totalEntries,
}: ConsoleHistoryProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set());
  const [structuredViewer, setStructuredViewer] = useState<StructuredViewer | null>(null);

  const rows = useMemo(() => filteredEntries.map((entry, index) => {
    const id = `${entry.timestamp.getTime()}-${entry.type}-${index}-${entry.content}`;
    return { entry, id, payload: getStructuredPayload(entry.content) };
  }), [filteredEntries]);

  const toggleExpanded = (id: string): void => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEscapeKey(() => setStructuredViewer(null), !!structuredViewer);

  return (
    <>
      <div ref={outputRef} className="duet-console__output">
        {filteredEntries.length === 0 && totalEntries === 0 && (
          <div className="duet-console__placeholder">
            Console output will appear here. Type a G-code command below or use
            the quick buttons above.
          </div>
        )}
        {filteredEntries.length === 0 && totalEntries > 0 && (
          <div className="duet-console__placeholder">No entries match the current filter.</div>
        )}
        {rows.map(({ entry, id, payload }, index) => {
          const isExpanded = expandedEntries.has(id);
          return (
          <div
            key={id}
            className={`duet-console__entry duet-console__entry--${entry.type}${isExpanded ? ' is-expanded' : ''}`}
            title={isExpanded ? 'Double-click to collapse' : 'Double-click to expand'}
            onDoubleClick={() => toggleExpanded(id)}
          >
            <span className="duet-console__line-number">{String(index + 1).padStart(4, '\u00A0')}</span>
            <span className="duet-console__timestamp">{formatTime(entry.timestamp)}</span>
            <span className="duet-console__entry-type">{entry.type}</span>
            <span className="duet-console__entry-main">
              <span className="duet-console__entry-content">
                {entry.type === 'command' && <span className="duet-console__cmd-prefix">{'> '}</span>}
                {searchText ? highlightText(entry.content, searchText) : entry.content}
              </span>
              {payload && (
                <button
                  type="button"
                  className={`duet-console__payload-pill duet-console__payload-pill--${payload.kind}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setStructuredViewer({
                      ...payload,
                      title: `${payload.kind.toUpperCase()} response ${index + 1}`,
                    });
                  }}
                  title={`Open formatted ${payload.kind.toUpperCase()} viewer`}
                >
                  {payload.kind.toUpperCase()}
                </button>
              )}
            </span>
          </div>
          );
        })}
      </div>

      {structuredViewer && createPortal(
        <div className="duet-console__viewer-overlay" onClick={() => setStructuredViewer(null)}>
          <div
            className="duet-console__viewer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duet-console-viewer-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="duet-console__viewer-header">
              <div>
                <span className={`duet-console__viewer-kind duet-console__viewer-kind--${structuredViewer.kind}`}>
                  {structuredViewer.kind.toUpperCase()}
                </span>
                <span id="duet-console-viewer-title" className="duet-console__viewer-title">
                  {structuredViewer.title}
                </span>
              </div>
              <button
                type="button"
                className="duet-console__viewer-close"
                onClick={() => setStructuredViewer(null)}
                title="Close viewer"
              >
                <X size={15} />
              </button>
            </div>
            {structuredViewer.kind === 'json' ? (
              <div className="duet-console__json-viewer">
                <JsonTree path="root" value={structuredViewer.value} />
              </div>
            ) : (
              <pre className="duet-console__viewer-body duet-console__viewer-body--xml">
                <code>
                  {structuredViewer.formatted.split('\n').map((line, lineIndex) => (
                    <span key={`${lineIndex}-${line}`} className="duet-console__viewer-line">
                      {renderStructuredLine(structuredViewer.kind, line)}
                    </span>
                  ))}
                </code>
              </pre>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

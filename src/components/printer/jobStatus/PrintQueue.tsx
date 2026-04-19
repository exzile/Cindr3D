import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown, ListOrdered } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import { loadQueue, saveQueue } from './printQueueUtils';

export function PrintQueue() {
  const [collapsed, setCollapsed] = useState(false);
  const [queue, setQueue] = useState<string[]>(loadQueue);
  const startPrint = usePrinterStore((s) => s.startPrint);
  const model = usePrinterStore((s) => s.model);

  useEffect(() => {
    const handler = () => setQueue(loadQueue());
    window.addEventListener('print-queue-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('print-queue-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const syncQueue = useCallback((next: string[]) => {
    setQueue(next);
    saveQueue(next);
  }, []);

  // Auto-start next file when print status transitions to idle
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = model.state?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prev === undefined) return;
    const wasActive = prev === 'processing' || prev === 'simulating'
      || prev === 'pausing' || prev === 'paused' || prev === 'resuming'
      || prev === 'cancelling';
    if (!wasActive || status !== 'idle') return;

    const current = loadQueue();
    if (current.length === 0) return;

    const next = current[0];
    const remaining = current.slice(1);
    saveQueue(remaining);
    setQueue(remaining); // eslint-disable-line react-hooks/set-state-in-effect -- kick off next queued print
    void startPrint(next);
  }, [model.state?.status, startPrint]);

  const handleRemove = useCallback((index: number) => {
    const next = [...queue];
    next.splice(index, 1);
    syncQueue(next);
  }, [queue, syncQueue]);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    const next = [...queue];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    syncQueue(next);
  }, [queue, syncQueue]);

  const handleMoveDown = useCallback((index: number) => {
    if (index >= queue.length - 1) return;
    const next = [...queue];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    syncQueue(next);
  }, [queue, syncQueue]);

  const handleClearAll = useCallback(() => {
    syncQueue([]);
  }, [syncQueue]);

  return (
    <div style={{
      margin: '0 14px 12px', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden', background: 'var(--bg-panel)',
    }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', padding: '8px 12px', border: 'none',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          cursor: 'pointer', fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', textAlign: 'left',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <ListOrdered size={14} />
        Print Queue ({queue.length})
        {queue.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); handleClearAll(); }}
            style={{
              marginLeft: 'auto', fontSize: 11, color: 'var(--error)',
              cursor: 'pointer', fontWeight: 400,
            }}
          >
            Clear All
          </span>
        )}
      </button>

      {!collapsed && (
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          {queue.length === 0 ? (
            <div style={{
              padding: '16px 12px', color: 'var(--text-muted)',
              fontSize: 12, textAlign: 'center',
            }}>
              Queue is empty. Add files from the Files tab.
            </div>
          ) : (
            queue.map((filePath, i) => {
              const name = filePath.split('/').pop() || filePath;
              return (
                <div
                  key={`${filePath}-${i}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', fontSize: 12,
                    borderBottom: i < queue.length - 1 ? '1px solid var(--border)' : 'none',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span style={{
                    color: 'var(--text-muted)', fontSize: 11,
                    fontFamily: 'monospace', minWidth: 18, textAlign: 'right',
                  }}>
                    {i + 1}.
                  </span>
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }} title={filePath}>
                    {name}
                  </span>
                  <button
                    onClick={() => handleMoveUp(i)}
                    disabled={i === 0}
                    title="Move up"
                    style={{
                      background: 'none', border: 'none', cursor: i > 0 ? 'pointer' : 'default',
                      color: i > 0 ? 'var(--text-muted)' : 'var(--border)',
                      padding: 2, display: 'flex',
                    }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    onClick={() => handleMoveDown(i)}
                    disabled={i === queue.length - 1}
                    title="Move down"
                    style={{
                      background: 'none', border: 'none',
                      cursor: i < queue.length - 1 ? 'pointer' : 'default',
                      color: i < queue.length - 1 ? 'var(--text-muted)' : 'var(--border)',
                      padding: 2, display: 'flex',
                    }}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    onClick={() => handleRemove(i)}
                    title="Remove from queue"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--error)', padding: 2, display: 'flex',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

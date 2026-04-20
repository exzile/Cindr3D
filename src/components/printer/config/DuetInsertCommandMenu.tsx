import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, ChevronDown } from 'lucide-react';
import {
  detectFileKind,
  getCommandsForKind,
  FILE_KIND_LABEL,
  type CommandTemplate,
} from './duetConfigCommands';

interface Props {
  filePath: string;
  onInsert: (snippet: string) => void;
}

export function DuetInsertCommandMenu({ filePath, onInsert }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 320 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const kind = useMemo(() => detectFileKind(filePath), [filePath]);
  const commands = useMemo(() => getCommandsForKind(kind), [kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.snippet.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Group by category for nicer UX.
  const grouped = useMemo(() => {
    const m = new Map<string, CommandTemplate[]>();
    for (const c of filtered) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    return m;
  }, [filtered]);

  // Position the popover beneath the button.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.max(340, Math.min(420, window.innerWidth - 40));
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 4, left, width });
  }, [open]);

  // Close on outside-click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handlePick = (c: CommandTemplate) => {
    onInsert(c.snippet);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`duet-insert-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Insert a command relevant to ${FILE_KIND_LABEL[kind]} files`}
      >
        <Plus size={13} /> Insert <ChevronDown size={12} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="duet-insert-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="duet-insert-menu__header">
            <div className="duet-insert-menu__title">
              {FILE_KIND_LABEL[kind]} commands
            </div>
            <div className="duet-insert-menu__count">
              {filtered.length}/{commands.length}
            </div>
          </div>
          <div className="duet-insert-menu__search">
            <Search size={12} />
            <input
              type="text"
              placeholder="Search commands…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="duet-insert-menu__body">
            {filtered.length === 0 && (
              <div className="duet-insert-menu__empty">
                No commands match “{query}”.
              </div>
            )}
            {[...grouped.entries()].map(([cat, list]) => (
              <div key={cat} className="duet-insert-menu__group">
                <div className="duet-insert-menu__group-title">{cat}</div>
                {list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="duet-insert-menu__item"
                    onClick={() => handlePick(c)}
                    title={c.description || c.label}
                  >
                    <div className="duet-insert-menu__item-label">{c.label}</div>
                    {c.description && (
                      <div className="duet-insert-menu__item-desc">{c.description}</div>
                    )}
                    <pre className="duet-insert-menu__item-snippet">{c.snippet}</pre>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

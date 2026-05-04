import { useMemo, useState } from 'react';
import { X, RotateCcw, Check, Square, Search } from 'lucide-react';
import {
  SETTINGS_SECTIONS,
  useSlicerVisibilityStore,
} from '../../../../store/slicerVisibilityStore';
import { useEscapeKey } from '../../../../hooks/useEscapeKey';
import './SlicerSettingsVisibilityModal.css';

interface Props {
  onClose: () => void;
}

export function SlicerSettingsVisibilityModal({ onClose }: Props) {
  const visible = useSlicerVisibilityStore((s) => s.visible);
  const setVisible = useSlicerVisibilityStore((s) => s.setVisible);
  const setAll = useSlicerVisibilityStore((s) => s.setAll);
  const resetDefaults = useSlicerVisibilityStore((s) => s.resetDefaults);
  const [query, setQuery] = useState('');

  useEscapeKey(onClose);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, typeof SETTINGS_SECTIONS[number][]>();
    for (const s of SETTINGS_SECTIONS) {
      if (q && !s.label.toLowerCase().includes(q) && !s.group.toLowerCase().includes(q)) continue;
      const arr = out.get(s.group) ?? [];
      arr.push(s);
      out.set(s.group, arr);
    }
    return out;
  }, [query]);

  const totalVisible = SETTINGS_SECTIONS.reduce((n, s) => n + ((visible[s.id] ?? s.defaultOn) ? 1 : 0), 0);

  return (
    <div className="ssv-modal__overlay" onClick={onClose}>
      <div className="ssv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ssv-modal__header">
          <div className="ssv-modal__title">Customize Settings Panel</div>
          <button className="ssv-modal__close" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        <div className="ssv-modal__toolbar">
          <div className="ssv-modal__search">
            <Search size={12} className="ssv-modal__search-icon" />
            <input
              type="text"
              placeholder="Search sections…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="ssv-modal__actions">
            <button onClick={() => setAll(true)} title="Show all">
              <Check size={12} /> All
            </button>
            <button onClick={() => setAll(false)} title="Hide all">
              <Square size={12} /> None
            </button>
            <button onClick={resetDefaults} title="Restore defaults">
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>

        <div className="ssv-modal__body">
          {grouped.size === 0 && (
            <div className="ssv-modal__empty">No sections match “{query}”.</div>
          )}
          {[...grouped.entries()].map(([group, items]) => (
            <div key={group} className="ssv-modal__group">
              <div className="ssv-modal__group-title">{group}</div>
              <div className="ssv-modal__group-grid">
                {items.map((s) => {
                  const on = visible[s.id] ?? s.defaultOn;
                  return (
                    <label key={s.id} className={`ssv-modal__item${on ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setVisible(s.id, e.target.checked)}
                      />
                      <span className="ssv-modal__item-indicator" aria-hidden="true">
                        {on && <Check size={11} />}
                      </span>
                      <span className="ssv-modal__item-label">{s.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="ssv-modal__footer">
          <span className="ssv-modal__counter">
            {totalVisible} of {SETTINGS_SECTIONS.length} sections visible
          </span>
          <button className="ssv-modal__primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

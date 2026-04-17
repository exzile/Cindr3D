import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * Collapsible tool-panel section. Header is a small uppercase title with a
 * rotating chevron; body collapses on toggle. Drop into a `tool-panel`.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tp-section">
      <button
        type="button"
        className="tp-collapse"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight
          size={11}
          className={`tp-collapse__chevron${open ? ' open' : ''}`}
        />
        <span>{title}</span>
      </button>
      {open && children}
    </div>
  );
}

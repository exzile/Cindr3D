import { useRef, useState, useEffect, useCallback, Children } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Check, MoreHorizontal } from 'lucide-react';
import type { MenuItem } from '../../types/toolbar.types';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// ─── Flyout Sub-Menu Item ─────────────────────────────────────────────────

export function FlyoutMenuItem({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submenuPos, setSubmenuPos] = useState({ top: 0, left: 0 });

  const handleClick = () => {
    if (item.disabled) return;
    if (item.onClick) {
      item.onClick();
      onClose();
      return;
    }
    if (item.submenu) {
      setSubmenuOpen(!submenuOpen);
    }
  };

  const openSubmenu = () => {
    if (!item.submenu) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setSubmenuPos({ top: rect.top, left: rect.right });
    }
    setSubmenuOpen(true);
  };

  const scheduleClose = () => {
    closeTimerRef.current = setTimeout(() => setSubmenuOpen(false), 120);
  };

  return (
    <div
      ref={wrapperRef}
      className="flyout-menu-item-wrapper"
      onMouseEnter={openSubmenu}
      onMouseLeave={scheduleClose}
    >
      <button
        className={`flyout-menu-item ${item.disabled ? 'disabled' : ''} ${item.checked ? 'checked' : ''}`}
        onClick={handleClick}
      >
        <span className="flyout-menu-item-icon">
          {item.icon || <span className="flyout-icon-placeholder" />}
        </span>
        <span className="flyout-menu-item-label">{item.label}</span>
        {item.shortcut && <span className="flyout-menu-item-shortcut">{item.shortcut}</span>}
        {item.submenu && <ChevronRight size={12} className="flyout-menu-item-arrow" />}
        {item.checked && <Check size={12} className="flyout-menu-item-check" />}
      </button>
      {item.submenu && submenuOpen && createPortal(
        <div
          className="flyout-submenu"
          style={{ position: 'fixed', top: submenuPos.top, left: submenuPos.left }}
          onMouseEnter={() => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }}
          onMouseLeave={scheduleClose}
        >
          {item.submenu.map((sub, i) => (
            <div key={i}>
              {sub.separator && <div className="flyout-menu-separator" />}
              <FlyoutMenuItem item={sub} onClose={onClose} />
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Ribbon Section (labeled group with optional flyout dropdown) ─────────

export function RibbonSection({ title, children, menuItems, accentColor, maxVisible }: {
  title: string;
  children: React.ReactNode;
  menuItems?: MenuItem[];
  accentColor?: string;
  /** When provided, limits visible inline buttons; extras accessible via overflow button. */
  maxVisible?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const hasFlyout = !!menuItems && menuItems.length > 0;
  const childArray = Children.toArray(children);

  const visibleCount = maxVisible !== undefined ? Math.min(maxVisible, childArray.length) : childArray.length;
  const hasOverflow = hasFlyout && visibleCount < childArray.length;
  const visibleChildren = hasOverflow ? childArray.slice(0, visibleCount) : childArray;

  // Position the flyout portal below whichever trigger was clicked
  const openMenu = (triggerEl: HTMLElement) => {
    const rect = triggerEl.getBoundingClientRect();
    setMenuPos({ top: rect.bottom, left: rect.left });
    setMenuOpen(true);
  };

  // Close on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        sectionRef.current && !sectionRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleEscape = useCallback(() => setMenuOpen(false), []);
  useEscapeKey(handleEscape, menuOpen);

  return (
    <div className="ribbon-section" ref={sectionRef}>
      <div className="ribbon-section-content">
        {visibleChildren}
        {hasOverflow && (
          <button
            ref={overflowBtnRef}
            type="button"
            className={`ribbon-overflow-btn ${menuOpen ? 'active' : ''}`}
            title="More tools"
            onClick={() => overflowBtnRef.current && openMenu(overflowBtnRef.current)}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
      <div
        ref={labelRef}
        className={`ribbon-section-label ${hasFlyout ? 'flyout-trigger' : ''} ${menuOpen ? 'flyout-open' : ''}`}
        style={menuOpen && accentColor ? { background: accentColor, color: '#fff' } as React.CSSProperties : undefined}
        onClick={() => hasFlyout && labelRef.current && openMenu(labelRef.current)}
      >
        {title}
        {hasFlyout && <ChevronDown size={8} className="ribbon-section-chevron" />}
      </div>
      {hasFlyout && menuOpen && createPortal(
        <div
          ref={menuRef}
          className="flyout-menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          {menuItems!.map((item, i) => (
            <div key={i}>
              {item.separator && <div className="flyout-menu-separator" />}
              <FlyoutMenuItem item={item} onClose={() => setMenuOpen(false)} />
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

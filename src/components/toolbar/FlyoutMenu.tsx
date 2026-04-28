import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { MenuItem } from '../../types/toolbar.types';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// ─── Flyout Sub-Menu Item ─────────────────────────────────────────────────

export function FlyoutMenuItem({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [submenuOpen, setSubmenuOpen] = useState(false);

  const handleClick = () => {
    if (item.disabled) return;
    if (item.submenu) {
      setSubmenuOpen(!submenuOpen);
      return;
    }
    if (item.onClick) item.onClick();
    onClose();
  };

  return (
    <div
      className="flyout-menu-item-wrapper"
      onMouseEnter={() => item.submenu && setSubmenuOpen(true)}
      onMouseLeave={() => item.submenu && setSubmenuOpen(false)}
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
      {item.submenu && submenuOpen && (
        <div className="flyout-submenu">
          {item.submenu.map((sub, i) => (
            <div key={i}>
              {sub.separator && <div className="flyout-menu-separator" />}
              <FlyoutMenuItem item={sub} onClose={onClose} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ribbon Section (labeled group with optional flyout dropdown) ─────────

export function RibbonSection({ title, children, menuItems, accentColor }: {
  title: string;
  children: React.ReactNode;
  menuItems?: MenuItem[];
  accentColor?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const hasFlyout = !!menuItems && menuItems.length > 0;

  // Position the portal menu below the label
  useEffect(() => {
    if (menuOpen && labelRef.current) {
      const rect = labelRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom, left: rect.left });
    }
  }, [menuOpen]);

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
      <div className="ribbon-section-content">{children}</div>
      <div
        ref={labelRef}
        className={`ribbon-section-label ${hasFlyout ? 'flyout-trigger' : ''} ${menuOpen ? 'flyout-open' : ''}`}
        style={menuOpen && accentColor ? { background: accentColor, color: '#fff' } as React.CSSProperties : undefined}
        onClick={() => hasFlyout && setMenuOpen(!menuOpen)}
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

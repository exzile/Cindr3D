import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { ToolButtonProps } from '../../types/toolbar.types';
import { useMenuClose } from './useMenuClose';

export function ToolButton({ icon, label, tool, active, onClick, disabled, large, colorClass, dropdown }: ToolButtonProps) {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { closing, startClose } = useMenuClose();
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const isActive = active ?? (tool ? activeTool === tool : false);
  const hasDropdown = !!dropdown;

  const closeDropdown = useCallback(() => {
    startClose(() => setDropdownOpen(false));
  }, [startClose]);

  const handleClick = () => {
    if (disabled) return;
    if (onClick) onClick();
    else if (tool) setActiveTool(tool);
  };

  const openDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dropdownOpen) {
      closeDropdown();
      return;
    }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left });
    }
    setDropdownOpen(true);
  };

  // Close on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target) &&
          dropdownRef.current && !dropdownRef.current.contains(target)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen, closeDropdown]);

  return (
    <div className="ribbon-button-wrapper">
      <button
        type="button"
        ref={btnRef}
        className={`ribbon-button ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''} ${large ? 'large' : ''} ${hasDropdown ? 'has-dropdown' : ''} ${dropdownOpen ? 'dropdown-open' : ''}`}
        onClick={handleClick}
        title={hasDropdown ? `${label} tools` : label}
      >
        <div className={`ribbon-button-icon ${colorClass || ''}`}>{icon}</div>
        <span
          className={`ribbon-button-label-row ${hasDropdown ? 'dropdown-trigger' : ''}`}
          onClick={hasDropdown ? openDropdown : undefined}
        >
          <span className="ribbon-button-label">{label}</span>
          {hasDropdown && (
            <span className="ribbon-dropdown-affordance" aria-hidden="true">
              <ChevronDown size={10} className="ribbon-dropdown-arrow" />
            </span>
          )}
        </span>
      </button>
      {dropdownOpen && createPortal(
        <div
          ref={dropdownRef}
          className={`ribbon-dropdown-menu${closing ? ' closing' : ''}`}
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left }}
        >
          {dropdown!.map((item, i) => (
            <button
              type="button"
              key={i}
              className={`ribbon-dropdown-item${item.divider ? ' ribbon-dropdown-item--divider' : ''}`}
              onClick={() => { item.onClick(); closeDropdown(); }}
            >
              {item.icon && <span className="ribbon-dropdown-item-icon">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

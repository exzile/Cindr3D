import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { ToolButtonProps } from './toolbar.types';

export function ToolButton({ icon, label, tool, active, onClick, disabled, large, colorClass, dropdown }: ToolButtonProps) {
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const isActive = active ?? (tool ? activeTool === tool : false);

  const handleClick = () => {
    if (disabled) return;
    if (onClick) onClick();
    else if (tool) setActiveTool(tool);
  };

  const openDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left });
    }
    setDropdownOpen(!dropdownOpen);
  };

  // Close on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target) &&
          dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  return (
    <div className="ribbon-button-wrapper">
      <button
        ref={btnRef}
        className={`ribbon-button ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''} ${large ? 'large' : ''}`}
        onClick={handleClick}
        title={label}
      >
        <div className={`ribbon-button-icon ${colorClass || ''}`}>{icon}</div>
        <span className="ribbon-button-label">{label}</span>
        {dropdown && (
          <ChevronDown
            size={10}
            className="ribbon-dropdown-arrow"
            onClick={openDropdown}
          />
        )}
      </button>
      {dropdown && dropdownOpen && createPortal(
        <div
          ref={dropdownRef}
          className="ribbon-dropdown-menu"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left }}
          onMouseLeave={() => setDropdownOpen(false)}
        >
          {dropdown.map((item, i) => (
            <button
              key={i}
              className="ribbon-dropdown-item"
              onClick={() => { item.onClick(); setDropdownOpen(false); }}
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

/**
 * Shared shell for cursor-positioned context menus. Portals into document.body,
 * renders the backdrop (click + right-click both close), and positions the
 * menu container at the given cursor coordinates. Callers compose their own
 * items inside using the existing `sketch-ctx-item` / `sketch-ctx-sep` CSS
 * classes — this shell only owns the portal + backdrop + positioning so the
 * three callers (ViewportContextMenu, BodyContextMenu, SketchContextMenu)
 * stop re-implementing the same DOM.
 */

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuShellProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenuShell({ x, y, onClose, children }: ContextMenuShellProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState({ top: y, left: x });

  const closeWithAnimation = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 120);
  }, [closing, onClose]);

  useLayoutEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const margin = 8;
    const rect = menuEl.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, x - rect.width);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, y - rect.height);
    }
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
    setPosition({ top, left });

    const firstButton = menuEl.querySelector<HTMLButtonElement>(
      '.sketch-ctx-item:not(:disabled):not(.disabled)',
    );
    firstButton?.focus({ preventScroll: true });
  }, [x, y]);

  useLayoutEffect(() => {
    return () => {
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const focusMenuItem = (direction: 1 | -1) => {
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const items = Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>('.sketch-ctx-item:not(:disabled):not(.disabled)'),
    );
    if (items.length === 0) return;
    const activeIndex = items.findIndex((item) => item === document.activeElement);
    const nextIndex =
      activeIndex < 0
        ? 0
        : (activeIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWithAnimation();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusMenuItem(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const first = menuRef.current?.querySelector<HTMLButtonElement>(
        '.sketch-ctx-item:not(:disabled):not(.disabled)',
      );
      first?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '.sketch-ctx-item:not(:disabled):not(.disabled)',
      );
      items?.[items.length - 1]?.focus({ preventScroll: true });
    }
  };

  return createPortal(
    <>
      <div
        className="sketch-ctx-backdrop"
        onClick={closeWithAnimation}
        onContextMenu={(e) => {
          e.preventDefault();
          closeWithAnimation();
        }}
      />
      <div
        ref={menuRef}
        className={`sketch-ctx-menu${closing ? ' closing' : ''}`}
        style={position}
        role="menu"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

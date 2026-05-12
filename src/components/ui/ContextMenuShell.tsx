/**
 * Shared shell for cursor-positioned context menus. Portals into document.body,
 * renders the backdrop (click + right-click both close), and positions the
 * menu container at the given cursor coordinates. Callers compose their own
 * items inside using the existing `sketch-ctx-item` / `sketch-ctx-sep` CSS
 * classes — this shell only owns the portal + backdrop + positioning so the
 * three callers (ViewportContextMenu, BodyContextMenu, SketchContextMenu)
 * stop re-implementing the same DOM.
 */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuShellProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenuShell({ x, y, onClose, children }: ContextMenuShellProps) {
  return createPortal(
    <>
      <div
        className="sketch-ctx-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="sketch-ctx-menu" style={{ top: y, left: x }}>
        {children}
      </div>
    </>,
    document.body,
  );
}

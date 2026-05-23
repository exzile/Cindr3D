import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

export type DimensionContextMenuEvent =
  | ReactMouseEvent<HTMLDivElement>
  | { stopPropagation: () => void; nativeEvent: MouseEvent };

interface OpenDimensionDeleteMenuOptions {
  closeRef: MutableRefObject<(() => void) | null>;
  dimensionId: string;
  event: DimensionContextMenuEvent;
  onDelete: (dimensionId: string) => void;
}

export function openDimensionDeleteMenu({
  closeRef,
  dimensionId,
  event,
  onDelete,
}: OpenDimensionDeleteMenuOptions) {
  event.stopPropagation();
  const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
  nativeEvent.preventDefault();
  closeRef.current?.();

  const x = nativeEvent.clientX;
  const y = nativeEvent.clientY;

  const menu = document.createElement("div");
  menu.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;z-index:100000;
      min-width:140px;padding:4px;background:#fff;
      border:1px solid rgba(15,23,42,0.18);
      box-shadow:0 8px 24px rgba(15,23,42,0.18);border-radius:6px;
    `;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Delete Dimension";
  btn.style.cssText = `
      width:100%;border:0;background:transparent;color:#991b1b;
      cursor:pointer;font-size:12px;font-family:inherit;
      padding:6px 8px;text-align:left;
    `;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    menu.remove();
    window.removeEventListener("pointerdown", onOutside);
    window.removeEventListener("keydown", onEscape);
    if (closeRef.current === close) closeRef.current = null;
  };
  const onOutside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  btn.addEventListener("click", () => {
    onDelete(dimensionId);
    close();
  });
  btn.addEventListener("mouseover", () => {
    btn.style.background = "#fef2f2";
  });
  btn.addEventListener("mouseout", () => {
    btn.style.background = "transparent";
  });

  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  menu.appendChild(btn);
  document.body.appendChild(menu);
  closeRef.current = close;

  setTimeout(() => {
    if (closed) return;
    window.addEventListener("pointerdown", onOutside);
    window.addEventListener("keydown", onEscape);
  }, 0);
}

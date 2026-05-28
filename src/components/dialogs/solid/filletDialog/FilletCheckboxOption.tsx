import type { ReactNode } from "react";
import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface FilletCheckboxOptionProps {
  checked: boolean;
  children: ReactNode;
  description: string;
  onChange: (checked: boolean) => void;
}

const TOOLTIP_WIDTH = 280;
const VIEWPORT_MARGIN = 12;

export function FilletCheckboxOption({
  checked,
  children,
  description,
  onChange,
}: FilletCheckboxOptionProps) {
  const tooltipId = useId();
  const labelRef = useRef<HTMLLabelElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);

  const showTooltip = useCallback(() => {
    const rect = labelRef.current?.getBoundingClientRect();
    if (!rect) return;

    const halfWidth = TOOLTIP_WIDTH / 2;
    const minLeft = VIEWPORT_MARGIN + halfWidth;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - halfWidth;
    const centeredLeft = rect.left + rect.width / 2;
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const top = Math.max(VIEWPORT_MARGIN, rect.top - 10);
    setTooltipPosition({ left, top });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltipPosition(null);
  }, []);

  return (
    <>
      <label
        ref={labelRef}
        className="checkbox-label"
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{children}</span>
      </label>
      {tooltipPosition && typeof document !== "undefined" && createPortal(
        <span
          id={tooltipId}
          className="fillet-option-tooltip"
          role="tooltip"
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
        >
          {description}
        </span>,
        document.body,
      )}
    </>
  );
}

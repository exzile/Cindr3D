import type { ReactNode } from 'react';

export interface SegmentedIconOption<T extends string> {
  value: T;
  icon: ReactNode;
  title: string;
  disabled?: boolean;
}

/**
 * Row of icon buttons acting as a single-select segmented control.
 * Uses tool-panel (tp-*) classes from ToolPanel.css.
 */
export function SegmentedIconGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedIconOption<T>[];
  ariaLabel?: string;
}) {
  return (
    <div className="tp-seg-icons" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`tp-seg-icons__btn${value === opt.value ? ' active' : ''}`}
          title={opt.title}
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}

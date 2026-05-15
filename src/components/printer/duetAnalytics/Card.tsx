import type { ReactNode } from 'react';

/** KPI card used along the top of the analytics grid (icon + big value + label). */
export function Card({
  icon, value, label, color, hint,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="duet-analytics__card">
      <div className="duet-analytics__card-icon" style={color ? { color } : undefined}>{icon}</div>
      <div>
        <div className="duet-analytics__card-value">{value}</div>
        <div className="duet-analytics__card-label">
          {label}
          {hint && <span className="duet-analytics__card-hint"> · {hint}</span>}
        </div>
      </div>
    </div>
  );
}

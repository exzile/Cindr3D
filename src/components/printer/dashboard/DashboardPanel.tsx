import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
}

export function DashboardPanel({ icon: Icon, title, children, className }: Props) {
  return (
    <div className={`ds-panel${className ? ` ${className}` : ''}`}>
      <div className="ds-panel__head">
        <Icon size={14} /> {title}
      </div>
      <div className="ds-panel__body">
        {children}
      </div>
    </div>
  );
}
